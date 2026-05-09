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
    const candidates = await this.page.evaluate(() => {
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const cleanText = (value) => String(value || '')
        .replace(/\s+/g, ' ')
        .trim();

      const countMatches = (text, regex) => {
        const matches = String(text || '').match(regex);
        return matches ? matches.length : 0;
      };

      const out = [];
      const seen = new Set();

      const push = (rawText, cells = []) => {
        const raw = cleanText(rawText);

        if (!raw) return;
        if (raw.length > 250) return;

        const englishRankCount = countMatches(raw, /\b\d{1,6}(?:st|nd|rd|th)\b/gi);
        const japaneseRankCount = countMatches(raw, /\b\d{1,6}位\b/g);
        const pointCount = countMatches(raw, /[\d,]+\s*pt\b/gi);

        const rankCount = englishRankCount + japaneseRankCount;

        if (rankCount !== 1 || pointCount !== 1) return;

        const looksLikeJjprResult =
          /\b\d{1,6}(?:st|nd|rd|th)\b/i.test(raw) &&
          /[\d,]+\s*pt\b/i.test(raw);

        const looksLikeJapaneseRank =
          /\b\d{1,6}位\b/.test(raw) &&
          /[\d,]+\s*pt\b/i.test(raw);

        if (!looksLikeJjprResult && !looksLikeJapaneseRank) return;

        if (seen.has(raw)) return;
        seen.add(raw);

        out.push({
          rawText: raw,
          cells: cells.map(cleanText).filter(Boolean),
        });
      };

      document.querySelectorAll('table tr').forEach((tr) => {
        if (!isVisible(tr)) return;

        const cells = Array.from(tr.querySelectorAll('th,td'))
          .map((cell) => cleanText(cell.innerText || cell.textContent));

        push(cleanText(tr.innerText || tr.textContent), cells);
      });

      document.querySelectorAll('[role="row"]').forEach((row) => {
        if (!isVisible(row)) return;

        const cells = Array.from(row.querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"]'))
          .map((cell) => cleanText(cell.innerText || cell.textContent));

        push(cleanText(row.innerText || row.textContent), cells);
      });

      document.querySelectorAll('body *').forEach((el) => {
        if (!isVisible(el)) return;

        const raw = cleanText(el.innerText || el.textContent);

        push(raw, [raw]);
      });

      const lines = String(document.body?.innerText || '')
        .split('\n')
        .map(cleanText)
        .filter(Boolean);

      lines.forEach((line) => push(line, [line]));

      return out;
    });

    return candidates
      .map((candidate) => this.parseCandidateRow(candidate))
      .filter((row) => row.rawText)
      .filter((row) => Number.isFinite(row.rank))
      .filter((row) => row.playerName);
  }

  parseCandidateRow(row) {
    const cells = row.cells || [];
    const rawText = String(row.rawText || cells.join(' '))
      .replace(/\s+/g, ' ')
      .trim();

    let rank = null;
    let playerName = '';
    let points = null;

    let match = rawText.match(/^(\d{1,6})(?:st|nd|rd|th)\s+(.+?)\s+([\d,]+)\s*pt\b/i);

    if (match) {
      rank = Number(match[1]);
      playerName = String(match[2] || '').replace(/\s+/g, ' ').trim();
      points = Number(match[3].replace(/,/g, ''));

      return {
        rank,
        playerName,
        points,
        rawText,
        cells,
      };
    }

    match = rawText.match(/^(\d{1,6})位\s+(.+?)\s+([\d,]+)\s*pt\b/i);

    if (match) {
      rank = Number(match[1]);
      playerName = String(match[2] || '').replace(/\s+/g, ' ').trim();
      points = Number(match[3].replace(/,/g, ''));

      return {
        rank,
        playerName,
        points,
        rawText,
        cells,
      };
    }

    for (const cell of cells) {
      const rankMatch =
        String(cell).match(/^#?\s*(\d{1,6})(?:st|nd|rd|th|位)?$/i) ||
        String(cell).match(/(?:順位|Rank|#)\s*(\d{1,6})/i);

      if (rankMatch) {
        rank = Number(rankMatch[1]);
        break;
      }
    }

    if (rank === null) {
      const rankMatch =
        rawText.match(/^#?\s*(\d{1,6})(?:st|nd|rd|th|位)?\b/i) ||
        rawText.match(/(?:順位|Rank|#)\s*(\d{1,6})/i);

      if (rankMatch) {
        rank = Number(rankMatch[1]);
      }
    }

    const pointMatch = rawText.match(/([\d,]+)\s*pt\b/i);

    if (pointMatch) {
      points = Number(pointMatch[1].replace(/,/g, ''));
    }

    playerName = this.extractNameFromRaw(rawText);

    return {
      rank,
      playerName,
      points,
      rawText,
      cells,
    };
  }

  extractNameFromRaw(rawText) {
    const text = String(rawText || '')
      .replace(/\s+/g, ' ')
      .trim();

    let match = text.match(/^\d{1,6}(?:st|nd|rd|th)\s+(.+?)\s+[\d,]+\s*pt\b/i);

    if (match) {
      return String(match[1] || '').trim();
    }

    match = text.match(/^\d{1,6}位\s+(.+?)\s+[\d,]+\s*pt\b/i);

    if (match) {
      return String(match[1] || '').trim();
    }

    return text
      .replace(/^\d{1,6}(?:st|nd|rd|th|位)?\s*/i, '')
      .replace(/[\d,]+\s*pt$/i, '')
      .trim();
  }
}

module.exports = { JjprScraper, DEFAULT_JJPR_URL };