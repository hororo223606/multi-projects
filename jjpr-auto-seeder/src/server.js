const path = require('path');
const express = require('express');
const multer = require('multer');

const {
  DEFAULT_JJPR_URL,
  getJjprRankingRows,
} = require('./jjprCsvLoader');

const {
  buildSeedRows,
  rowsToCsv,
  DEFAULT_TAG_COLUMN,
  DEFAULT_EXACT_MATCH_COLUMN,
  DEFAULT_VENUE_TYPE_COLUMN,
  DEFAULT_INCLUDED_VENUE_TYPES,
  normalizeName,
} = require('./csvSeeder');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/debug-ranking', async (req, res) => {
  const url = req.query.url || DEFAULT_JJPR_URL;
  const name = String(req.query.name || '').trim();
  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

  try {
    const ranking = await getJjprRankingRows({
      url,
      forceRefresh,
    });

    const rows = ranking.rows || [];

    const matches = name
      ? rows.filter((row) => normalizeName(row.name || row.playerName || '') === normalizeName(name))
      : [];

    return res.json({
      fromCache: ranking.fromCache,
      fetchedAt: new Date(ranking.fetchedAt).toISOString(),
      totalRows: rows.length,
      sampleRows: rows.slice(0, 20),
      queryName: name,
      matches,
    });
  } catch (error) {
    console.error('[api/debug-ranking] failed:', error);

    return res.status(500).json({
      error: error.message || String(error),
    });
  }
});

app.post('/api/seed', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'CSVファイルを選択してください。',
    });
  }

  const outputFormat = req.body.format || 'json';

  const tagColumn = req.body.tagColumn || DEFAULT_TAG_COLUMN;

  // index.html側にまだ入力欄がなくても、デフォルトでGamerTagを使う
  const exactMatchColumn = req.body.exactMatchColumn || DEFAULT_EXACT_MATCH_COLUMN;

  const venueTypeColumn = req.body.venueTypeColumn || DEFAULT_VENUE_TYPE_COLUMN;

  const includedVenueTypes = String(
    req.body.includedVenueTypes || DEFAULT_INCLUDED_VENUE_TYPES.join(','),
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const url = req.body.url || DEFAULT_JJPR_URL;
  const forceRefresh = req.body.refresh === '1' || req.body.refresh === 'true';

  const csvText = req.file.buffer.toString('utf8');

  try {
    const ranking = await getJjprRankingRows({
      url,
      forceRefresh,
    });

    console.log('[api/seed] JJPR ranking loaded:', {
      rows: ranking.rows.length,
      fromCache: ranking.fromCache,
      fetchedAt: new Date(ranking.fetchedAt).toISOString(),
    });

    const rows = await buildSeedRows({
      csvText,
      rankingRows: ranking.rows,
      tagColumn,
      exactMatchColumn,
      venueTypeColumn,
      includedVenueTypes,
    });

    if (outputFormat === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="seeded.csv"');
      return res.send(rowsToCsv(rows));
    }

    return res.json({
      rows,
      meta: {
        jjprRows: ranking.rows.length,
        jjprFromCache: ranking.fromCache,
        jjprFetchedAt: new Date(ranking.fetchedAt).toISOString(),
      },
    });
  } catch (error) {
    console.error('[api/seed] failed:', error);

    return res.status(500).json({
      error: error.message || String(error),
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`JJPR auto seeder running on port ${port}`);
});