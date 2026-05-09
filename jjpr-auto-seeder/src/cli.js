#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const { JjprScraper, DEFAULT_JJPR_URL } = require('./jjprScraper');
const { buildSeedRows, rowsToCsv, DEFAULT_VENUE_TYPE_COLUMN, DEFAULT_INCLUDED_VENUE_TYPES } = require('./csvSeeder');

async function main() {
  const [, , inputPath, outputPath = 'output/seeded.csv', url = DEFAULT_JJPR_URL] = process.argv;
  if (!inputPath) {
    console.error('Usage: node src/cli.js <input.csv> [output.csv] [jjprUrl]');
    process.exit(1);
  }

  const csvText = await fs.readFile(inputPath, 'utf8');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const scraper = new JjprScraper({ url, headless: true });

  try {
    const rows = await buildSeedRows({
      csvText,
      scraper,
      onProgress: ({ index, total, tag, skipped, venueTypeColumn }) => {
        if (index === 0 && venueTypeColumn) {
          console.error(`Using only ${DEFAULT_VENUE_TYPE_COLUMN}=${DEFAULT_INCLUDED_VENUE_TYPES.join('/')} rows. Skipped ${skipped} non-competitor rows.`);
          return;
        }
        if (index > 0) console.error(`[${index}/${total}] ${tag}`);
      },
    });
    await fs.writeFile(outputPath, rowsToCsv(rows), 'utf8');
    console.error(`Wrote ${rows.length} seed rows to ${outputPath}`);
  } finally {
    await scraper.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
