const express = require('express');
const multer = require('multer');
const { JjprScraper, DEFAULT_JJPR_URL } = require('./jjprScraper');
const { buildSeedRows, rowsToCsv, DEFAULT_TAG_COLUMN, DEFAULT_VENUE_TYPE_COLUMN, DEFAULT_INCLUDED_VENUE_TYPES } = require('./csvSeeder');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const port = process.env.PORT || 3000;

app.use(express.static('public'));

app.post('/api/seed', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'CSVファイルを選択してください。' });
  }

  const outputFormat = req.body.format || 'json';
  const tagColumn = req.body.tagColumn || DEFAULT_TAG_COLUMN;
  const venueTypeColumn = req.body.venueTypeColumn || DEFAULT_VENUE_TYPE_COLUMN;
  const includedVenueTypes = String(req.body.includedVenueTypes || DEFAULT_INCLUDED_VENUE_TYPES.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const url = req.body.url || DEFAULT_JJPR_URL;
  const csvText = req.file.buffer.toString('utf8');
  const scraper = new JjprScraper({ url, headless: true });

  try {
    const rows = await buildSeedRows({ csvText, scraper, tagColumn, venueTypeColumn, includedVenueTypes });
    if (outputFormat === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="seeded.csv"');
      return res.send(rowsToCsv(rows));
    }
    return res.json({ rows });
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  } finally {
    await scraper.close().catch(() => {});
  }
});

app.listen(port, () => {
  console.log(`JJPR auto seeder running on http://localhost:${port}`);
});
