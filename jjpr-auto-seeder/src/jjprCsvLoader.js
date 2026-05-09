const fs = require('fs/promises');
const { parse } = require('csv-parse/sync');
const { chromium } = require('playwright');

const DEFAULT_JJPR_URL = 'https://smashrating.web.app/pr/jpr';
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map();

function normalizeCell(value) {
  const text = String(value ?? '').trim();
  return text === 'null' ? '' : text;
}

function toNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim();
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

async function findCsvExportControl(page, timeoutMs = 60000) {
  // JJPRの集計完了後に「CSV出力」が表示されるまで待つ
  await page.waitForFunction(() => {
    const text = document.body?.innerText || '';
    return /CSV出力|CSV/i.test(text);
  }, null, {
    timeout: timeoutMs,
  }).catch(() => {});

  const candidates = [
    page.getByRole('button', { name: /CSV出力|CSV/i }).first(),
    page.getByRole('link', { name: /CSV出力|CSV/i }).first(),
    page.locator('button').filter({ hasText: /CSV出力|CSV/i }).first(),
    page.locator('a').filter({ hasText: /CSV出力|CSV/i }).first(),
    page.locator('[role="button"]').filter({ hasText: /CSV出力|CSV/i }).first(),
    page.getByText(/CSV出力/i).first(),
    page.getByText(/CSV/i).first(),
  ];

  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    const visible = await locator.isVisible().catch(() => false);
    if (visible) {
      return locator;
    }
  }

  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

  throw new Error(
    `JJPRページ上でCSV出力ボタンが見つかりませんでした。ページ本文の先頭: ${String(bodyText)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000)}`,
  );
}

async function downloadJjprCsv({
  url = DEFAULT_JJPR_URL,
  headless = true,
  timeoutMs = 90000,
} = {}) {
  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
    ],
  });

  try {
    const context = await browser.newContext({
      locale: 'ja-JP',
      acceptDownloads: true,
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    await page.waitForLoadState('networkidle', {
      timeout: timeoutMs,
    }).catch(() => {});

    const csvButton = await findCsvExportControl(page, timeoutMs);

    await csvButton.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: timeoutMs }),
      csvButton.click({ timeout: 10000 }),
    ]);

    const downloadedPath = await download.path();

    if (!downloadedPath) {
      throw new Error('JJPR CSVのダウンロードパスを取得できませんでした。');
    }

    return await fs.readFile(downloadedPath, 'utf8');
  } finally {
    await browser.close();
  }
}

function parseJjprCsv(csvText) {
  const records = parse(csvText, {
    bom: true,
    columns: false,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  const rows = [];

  for (const record of records) {
    if (!Array.isArray(record) || record.length < 4) continue;

    const first = String(record[0] ?? '').trim();

    // header skip
    if (!/^\d+$/.test(first)) continue;

    const placement = toNumber(record[0]);
    const id = normalizeCell(record[1]);
    const point = toNumber(record[record.length - 1]);

    if (!Number.isFinite(placement)) continue;

    // 実体は:
    // placement,id,name,prefix,shortName,point
    //
    // ただし name や shortName にカンマが含まれる場合、
    // CSVが正しくquoteされていないため列数が増える。
    // 例:
    // 2741,3257121,見知らぬ,天丼,,見知らぬ,天丼,7896
    //
    // そのため middle の中央を prefix とみなして、
    // 左側を name、右側を shortName として復元する。
    const middle = record.slice(2, -1).map(normalizeCell);

    let name = '';
    let prefix = '';
    let shortName = '';

    if (middle.length >= 3) {
      const prefixIndex = Math.floor(middle.length / 2);

      name = middle.slice(0, prefixIndex).join(',').trim();
      prefix = middle[prefixIndex] || '';
      shortName = middle.slice(prefixIndex + 1).join(',').trim();
    } else if (middle.length === 2) {
      name = middle[0] || '';
      shortName = middle[1] || '';
    } else if (middle.length === 1) {
      name = middle[0] || '';
      shortName = middle[0] || '';
    }

    if (!name) continue;

    rows.push({
      rank: placement,
      placement,
      id,
      name,
      playerName: name,
      prefix,
      shortName,
      point,
      rawText: `${placement} ${name} ${point ?? ''}`.trim(),
    });
  }

  return rows;
}

async function getJjprRankingRows({
  url = DEFAULT_JJPR_URL,
  forceRefresh = false,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
} = {}) {
  const key = url;
  const cached = cache.get(key);

  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.fetchedAt < cacheTtlMs
  ) {
    return {
      rows: cached.rows,
      csvText: cached.csvText,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
    };
  }

  const csvText = await downloadJjprCsv({ url });
  const rows = parseJjprCsv(csvText);

  if (rows.length === 0) {
    throw new Error('JJPR CSVを取得しましたが、ランキング行を読み取れませんでした。');
  }

  cache.set(key, {
    rows,
    csvText,
    fetchedAt: Date.now(),
  });

  return {
    rows,
    csvText,
    fromCache: false,
    fetchedAt: Date.now(),
  };
}

module.exports = {
  DEFAULT_JJPR_URL,
  DEFAULT_CACHE_TTL_MS,
  downloadJjprCsv,
  parseJjprCsv,
  getJjprRankingRows,
  findCsvExportControl,
};