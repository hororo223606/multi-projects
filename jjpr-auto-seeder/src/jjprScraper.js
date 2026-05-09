const { chromium } = require('playwright');
const { normalizeName } = require('./csvSeeder');

const DEFAULT_JJPR_URL = 'https://smashrating.web.app/pr/jpr';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class JjprScraper {
  constructor({ url = DEFAULT_JJPR_URL, headless = true, timeoutMs = 90000 } = {}) {
    this.url = url;
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.browser = null;
    this.page = null;
    this.loadedAllRows = null;
  }

  async init() {
    if (this.page) return;

    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
    });

    const context = await this.browser.newContext({ locale: 'ja-JP' });

    await context.route('**/*', async (route) => {
      const type = route.request().resourceType();

      if (['image', 'font', 'media'].includes(type)) {
        return route.abort();
      }

      return route.continue();
    });

    this.page = await context.newPage();

    await this.page.goto(this.url, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeoutMs,
    });

    await this.page.waitForLoadState('networkidle', {
      timeout: this.timeoutMs,
    }).catch(() => {});

    await this.waitUntilUsable();

    this.loadedAllRows = await this.captureRows();
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }

    this.browser = null;
    this.page = null;
    this.loadedAllRows = null;
  }

  async waitUntilUsable() {
    const page = this.page;

    await page.waitForFunction(() => {
      const text = document.body?.innerText || '';

      if (text.length < 50) return false;

      return !/集計中です|しばらく経っても|Loading|読み込み中/i.test(text);
    }, null, {
      timeout: this.timeoutMs,
    }).catch(() => {});

    await sleep(1000);
  }

  async findSearchInput() {
    const selectors = [
      'input[type="search"]',
      'input[placeholder*="検索"]',
      'input[aria-label*="検索"]',
      'input[placeholder*="Search" i]',
      'input[aria-label*="Search" i]',
      'input[type="text"]',
      'input:not([type])',
    ];

    for (const selector of selectors) {
      const inputs = this.page.locator(selector);
      const count = await inputs.count().catch(() => 0);

      for (let i = count - 1; i >= 0; i--) {
        const input = inputs.nth(i);
        const visible = await input.isVisible().catch(() => false);
        const enabled = await input.isEnabled().catch(() => false);

        if (visible && enabled) {
          return input;
        }
      }
    }

    throw new Error('JJPRの検索入力欄が見つかりませんでした。');
  }

  async findSearchButton() {
    const roleButton = this.page.getByRole('button', { name: /検索/ }).first();

    if (await roleButton.isVisible().catch(() => false)) {
      return roleButton;
    }

    const textButton = this.page.locator('button').filter({ hasText: '検索' }).first();

    if (await textButton.isVisible().catch(() => false)) {
      return textButton;
    }

    throw new Error('JJPRの検索ボタンが見つかりませんでした。');
  }

  async search(term, exactName = term) {
    await this.init();

    const cleanTerm = String(term || '').trim();
    const cleanExactName = String(exactName || term || '').trim();

    if (!cleanTerm || !cleanExactName) {
      return [];
    }

    try {
      const input = await this.findSearchInput();
      const button = await this.findSearchButton();

      await input.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await input.click({ timeout: 10000 });

      await input.fill('', { timeout: 10000 });
      await input.fill(cleanTerm, { timeout: 10000 });

      await button.click({ timeout: 10000 });

      await this.waitForSearchResult(cleanTerm);

      const rows = await this.captureRows();
      const filtered = this.filterRowsForExactName(rows, cleanExactName);

      if (filtered.length > 0) {
        return filtered;
      }
    } catch (error) {
      console.warn(`[JJPR] search failed for "${cleanTerm}":`, error.message || error);
    }

    return this.filterRowsForExactName(this.loadedAllRows || [], cleanExactName);
  }

  async waitForSearchResult(term) {
    await this.page.waitForFunction((keyword) => {
      const normalize = (value) => String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s　_\-・.]+/g, '')
        .trim();

      const text = document.body?.innerText || '';
      const normalizedText = normalize(text);
      const normalizedKeyword = normalize(keyword);

      const hasKeyword = normalizedText.includes(normalizedKeyword);
      const hasRankLikeText =
        /\b\d{1,6}(?:st|nd|rd|th)\b/i.test(text) ||
        /\b\d{1,6}位\b/.test(text);
      const hasPointLikeText = /[\d,]+\s*pt\b/i.test(text);

      return hasKeyword && hasRankLikeText && hasPointLikeText;
    }, term, {
      timeout: 15000,
    }).catch(() => {});

    await sleep(800);
  }

  filterRowsForExactName(rows, exactName) {
    const expectedNorm = normalizeName(exactName);

    if (!expectedNorm) {
      return [];
    }

    return rows
      .filter((row) => {
        const actualNorm = normalizeName(row.playerName || '');

        return actualNorm === expectedNorm;
      })
      .sort((a, b) => {
        const rankA = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
        const rankB = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;

        return rankA - rankB;
      });
  }

  async captureRows() {
    const rawBodyText = await this.page.locator('body').innerText({ timeout: 10000 }).catch(() => '');

    const normalizedText = String(rawBodyText || '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();

    const rows = [];

    // 例:
    // 355th UTeS | ほろろ 91,492pt
    // 638th ハル 46,052pt
    //
    // 改行をまたぐ場合:
    // 638th ハル
    // 46,052pt
    const regex = /(\d{1,6})(?:st|nd|rd|th|位)\s+([\s\S]*?)\s+([\d,]+)\s*pt\b/gi;

    let match;

    while ((match = regex.exec(normalizedText)) !== null) {
      const rank = Number(match[1]);
      let playerName = String(match[2] || '')
        .replace(/\s+/g, ' ')
        .trim();

      const points = Number(String(match[3] || '').replace(/,/g, ''));

      // 余計なUI文言が混ざった場合の保険
      playerName = this.cleanPlayerName(playerName);

      if (!Number.isFinite(rank)) continue;
      if (!playerName) continue;

      const rawText = `${rank}th ${playerName} ${String(match[3] || '').trim()}pt`;

      rows.push({
        rank,
        playerName,
        points,
        rawText,
        cells: [rawText],
      });
    }

    return this.uniqueRows(rows);
  }

  parseCandidateRow(row) {
    return row;
  }

  cleanPlayerName(value) {
    let name = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    // 検索欄やボタン文言が混ざった場合の保険
    name = name
      .replace(/^検索\s*/g, '')
      .replace(/^クリア\s*/g, '')
      .replace(/^csv出力\s*/gi, '')
      .trim();

    // 前後に余計な改行由来の文言が入った場合、最後の短い塊を優先する
    const badMarkers = [
      '計算ルール',
      '対象大会条件',
      '対象大会一覧',
      '対象予定大会一覧',
      '算出日時',
    ];

    for (const marker of badMarkers) {
      if (name.includes(marker)) {
        const parts = name
          .split(marker)
          .map((part) => part.trim())
          .filter(Boolean);

        if (parts.length > 0) {
          name = parts[parts.length - 1];
        }
      }
    }

    return name.trim();
  }

  uniqueRows(rows) {
    const seen = new Set();
    const out = [];

    for (const row of rows) {
      const key = `${row.rank || ''}::${normalizeName(row.playerName || '')}`;

      if (seen.has(key)) continue;

      seen.add(key);
      out.push(row);
    }

    return out.sort((a, b) => {
      const rankA = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
      const rankB = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;

      return rankA - rankB;
    });
  }
}

module.exports = { JjprScraper, DEFAULT_JJPR_URL };