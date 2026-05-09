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
    this.searchInputSelector = null;
  }

  async init() {
    if (this.page) return;
    this.browser = await chromium.launch({ headless: this.headless });
    this.page = await this.browser.newPage({ locale: 'ja-JP' });
    await this.page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
    await this.page.waitForLoadState('networkidle', { timeout: this.timeoutMs }).catch(() => {});
    await this.waitUntilUsable();
    this.searchInputSelector = await this.findSearchInputSelector();
    this.loadedAllRows = await this.captureRows();
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.page = null;
  }

  async waitUntilUsable() {
    const page = this.page;
    await page.waitForFunction(() => {
      const text = document.body?.innerText || '';
      if (text.length < 50) return false;
      return !/集計中です|しばらく経っても|Loading|読み込み中/i.test(text);
    }, null, { timeout: this.timeoutMs }).catch(() => {});
    await sleep(1000);
  }

  async findSearchInputSelector() {
    const candidates = [
      'input[type="search"]',
      'input[placeholder*="検索"]',
      'input[aria-label*="検索"]',
      'input[placeholder*="Search" i]',
      'input[aria-label*="Search" i]',
      'input[type="text"]',
      'input:not([type])',
      'textarea',
      '[contenteditable="true"]',
    ];

    for (const selector of candidates) {
      const count = await this.page.locator(selector).count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const locator = this.page.locator(selector).nth(i);
        const visible = await locator.isVisible().catch(() => false);
        const enabled = await locator.isEnabled().catch(() => false);
        if (visible && enabled) {
          // nth selectors are not stable across evaluate, so mark the node.
          await locator.evaluate((el) => el.setAttribute('data-jjpr-seeder-search', 'true')).catch(() => {});
          return '[data-jjpr-seeder-search="true"]';
        }
      }
    }
    return null;
  }

  async search(term) {
    await this.init();

    if (this.searchInputSelector) {
      const input = this.page.locator(this.searchInputSelector).first();
      await input.fill('').catch(() => {});
      await input.fill(term).catch(async () => {
        await input.click();
        await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await this.page.keyboard.type(term);
      });
      await this.page.keyboard.press('Enter').catch(() => {});
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await sleep(600);
      const rows = await this.captureRows();
      const filtered = this.filterRowsForTerm(rows, term);
      if (filtered.length > 0) return filtered;
    }

    // Fallback: search whatever rows were visible on first load.
    return this.filterRowsForTerm(this.loadedAllRows || [], term);
  }

  filterRowsForTerm(rows, term) {
    const norm = normalizeName(term);
    return rows
      .filter((row) => {
        const nameNorm = normalizeName(row.playerName || '');
        const rawNorm = normalizeName(row.rawText || '');
        return nameNorm.includes(norm) || rawNorm.includes(norm) || norm.includes(nameNorm);
      })
      .sort((a, b) => {
        const aExact = normalizeName(a.playerName || '') === norm ? 1 : 0;
        const bExact = normalizeName(b.playerName || '') === norm ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        const rankA = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
        const rankB = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
        return rankA - rankB;
      });
  }

  async captureRows() {
    const rows = await this.page.evaluate(() => {
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const candidates = [];

      const pushCells = (cells, rawText) => {
        const cleanCells = cells.map((c) => String(c || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        const raw = rawText || cleanCells.join(' ');
        if (!raw || cleanCells.length === 0) return;
        candidates.push({ cells: cleanCells, rawText: raw });
      };

      document.querySelectorAll('table tr').forEach((tr) => {
        if (!isVisible(tr)) return;
        const cells = Array.from(tr.querySelectorAll('th,td')).map(text);
        pushCells(cells, text(tr));
      });

      document.querySelectorAll('[role="row"]').forEach((row) => {
        if (!isVisible(row)) return;
        const cells = Array.from(row.querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"]')).map(text);
        pushCells(cells.length ? cells : [text(row)], text(row));
      });

      // Last resort: parse visible lines. This helps on list layouts without table semantics.
      const lines = (document.body?.innerText || '')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      lines.forEach((line) => {
        if (/^(JJPR|Home|ランキング一覧|シード作成|制作|Tweets by)/i.test(line)) return;
        if (/\d/.test(line) && line.length < 200) pushCells([line], line);
      });

      return candidates;
    });

    return rows
      .map((row) => this.parseCandidateRow(row))
      .filter((row) => row.rawText && !/^順位|^Rank/i.test(row.rawText));
  }

  parseCandidateRow(row) {
    const cells = row.cells || [];
    const rawText = row.rawText || cells.join(' ');
    let rank = null;

    for (const cell of cells) {
      const m = String(cell).match(/^#?\s*(\d{1,6})(?:位)?$/) || String(cell).match(/(?:順位|Rank|#)\s*(\d{1,6})/i);
      if (m) {
        rank = Number(m[1]);
        break;
      }
    }
    if (rank === null) {
      const m = rawText.match(/^#?\s*(\d{1,6})(?:位)?\b/) || rawText.match(/(?:順位|Rank|#)\s*(\d{1,6})/i);
      if (m) rank = Number(m[1]);
    }

    let playerName = '';
    const nonNumeric = cells.filter((cell) => !/^#?\s*\d+(?:\.\d+)?(?:位)?$/.test(cell));
    // Heuristic: player name is usually the first non-numeric cell and not a region/date/score-only column.
    playerName = nonNumeric.find((cell) => /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Latin}]/u.test(cell)) || nonNumeric[0] || '';

    // If the first non-numeric cell looks like a long whole row, try to extract the segment after rank.
    if (playerName.length > 60 && rank !== null) {
      const afterRank = rawText.replace(/^#?\s*\d{1,6}(?:位)?\s*/, '');
      playerName = afterRank.split(/\s{2,}|\t|,/)[0] || playerName;
    }

    return { rank, playerName, rawText, cells };
  }
}

module.exports = { JjprScraper, DEFAULT_JJPR_URL };
