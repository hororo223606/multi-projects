const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const DEFAULT_TAG_COLUMN = 'Short GamerTag';
const DEFAULT_EXACT_MATCH_COLUMN = 'GamerTag';
const DEFAULT_VENUE_TYPE_COLUMN = 'Venue Type';
const DEFAULT_INCLUDED_VENUE_TYPES = ['competitor', 'competiter'];

function parseAttendees(csvText) {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
  });
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　_\-・.]+/g, '')
    .trim();
}

function normalizeColumnName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');
}

function normalizeVenueType(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim();
}

function findColumnKey(row, wantedColumn) {
  if (!row || !wantedColumn) return null;
  if (wantedColumn in row) return wantedColumn;

  const wanted = normalizeColumnName(wantedColumn);

  return Object.keys(row).find((key) => normalizeColumnName(key) === wanted) || null;
}

function filterAttendeesByVenueType(
  attendees,
  venueTypeColumn = DEFAULT_VENUE_TYPE_COLUMN,
  includedVenueTypes = DEFAULT_INCLUDED_VENUE_TYPES,
) {
  if (attendees.length === 0 || !venueTypeColumn) {
    return {
      attendees,
      skipped: 0,
      venueTypeColumnKey: null,
    };
  }

  const venueTypeColumnKey = findColumnKey(attendees[0], venueTypeColumn);

  if (!venueTypeColumnKey) {
    return {
      attendees,
      skipped: 0,
      venueTypeColumnKey: null,
    };
  }

  const allowed = new Set(includedVenueTypes.map(normalizeVenueType));

  const filtered = attendees.filter((attendee) => (
    allowed.has(normalizeVenueType(attendee[venueTypeColumnKey]))
  ));

  return {
    attendees: filtered,
    skipped: attendees.length - filtered.length,
    venueTypeColumnKey,
  };
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  const out = [];

  for (const candidate of candidates) {
    const key = `${candidate.rank || ''}::${normalizeName(candidate.name || candidate.playerName || '')}::${candidate.id || ''}`;

    if (seen.has(key)) continue;

    seen.add(key);
    out.push(candidate);
  }

  return out;
}

function findExactJjprCandidates(rankingRows, exactName) {
  const expectedNorm = normalizeName(exactName);

  if (!expectedNorm) return [];

  return uniqueCandidates(
    rankingRows.filter((row) => {
      const jjprNameNorm = normalizeName(row.name || row.playerName || '');

      // includesは禁止。
      // ハル は一致、ハルナコ は不一致。
      return jjprNameNorm === expectedNorm;
    }),
  ).sort((a, b) => {
    const rankA = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;

    return rankA - rankB;
  });
}

async function buildSeedRows({
  csvText,
  rankingRows,
  tagColumn = DEFAULT_TAG_COLUMN,
  exactMatchColumn = DEFAULT_EXACT_MATCH_COLUMN,
  venueTypeColumn = DEFAULT_VENUE_TYPE_COLUMN,
  includedVenueTypes = DEFAULT_INCLUDED_VENUE_TYPES,
  maxCandidates = 20,
  onProgress = () => {},
}) {
  if (!Array.isArray(rankingRows) || rankingRows.length === 0) {
    throw new Error('JJPRランキングデータが空です。');
  }

  const allAttendees = parseAttendees(csvText);

  if (allAttendees.length === 0) {
    throw new Error('CSVに参加者行がありません。');
  }

  const tagColumnKey = findColumnKey(allAttendees[0], tagColumn);

  if (!tagColumnKey) {
    const columns = Object.keys(allAttendees[0]).join(', ');
    throw new Error(`CSVに "${tagColumn}" 列がありません。見つかった列: ${columns}`);
  }

  const exactMatchColumnKey = findColumnKey(allAttendees[0], exactMatchColumn) || tagColumnKey;

  const {
    attendees,
    skipped,
    venueTypeColumnKey,
  } = filterAttendeesByVenueType(allAttendees, venueTypeColumn, includedVenueTypes);

  if (attendees.length === 0) {
    const allowed = includedVenueTypes.join(', ');
    throw new Error(`"${venueTypeColumn}" が ${allowed} の参加者が見つかりませんでした。`);
  }

  const expandedRows = [];

  onProgress({
    index: 0,
    total: attendees.length,
    tag: '',
    skipped,
    venueTypeColumn: venueTypeColumnKey,
  });

  for (let i = 0; i < attendees.length; i++) {
    const attendee = attendees[i];
    const shortTag = String(attendee[tagColumnKey] || '').trim();
    const exactName = String(attendee[exactMatchColumnKey] || shortTag).trim();

    onProgress({
      index: i + 1,
      total: attendees.length,
      tag: shortTag,
      exactName,
      skipped,
      venueTypeColumn: venueTypeColumnKey,
    });

    const candidates = findExactJjprCandidates(rankingRows, exactName)
      .slice(0, maxCandidates);

    if (candidates.length === 0) {
      expandedRows.push({
        originalOrder: i + 1,
        sourceRowNumber: allAttendees.indexOf(attendee) + 1,
        originalTag: shortTag,
        exactName,
        status: 'not_found',
        candidateIndex: '',
        jjprRank: '',
        jjprId: '',
        jjprName: '',
        jjprShortName: '',
        jjprPoint: '',
        matchScore: '',
        jjprRawRow: '',
        attendee,
      });

      continue;
    }

    candidates.forEach((candidate, idx) => {
      expandedRows.push({
        originalOrder: i + 1,
        sourceRowNumber: allAttendees.indexOf(attendee) + 1,
        originalTag: shortTag,
        exactName,
        status: candidates.length > 1 ? 'multiple_candidates' : 'matched',
        candidateIndex: idx + 1,
        jjprRank: candidate.rank || '',
        jjprId: candidate.id || '',
        jjprName: candidate.name || candidate.playerName || '',
        jjprShortName: candidate.shortName || '',
        jjprPoint: candidate.point || '',
        matchScore: 100,
        jjprRawRow: candidate.rawText || '',
        attendee,
      });
    });
  }

  expandedRows.sort((a, b) => {
    const rankA = Number.isFinite(Number(a.jjprRank)) && a.jjprRank !== ''
      ? Number(a.jjprRank)
      : Number.MAX_SAFE_INTEGER;

    const rankB = Number.isFinite(Number(b.jjprRank)) && b.jjprRank !== ''
      ? Number(b.jjprRank)
      : Number.MAX_SAFE_INTEGER;

    if (rankA !== rankB) return rankA - rankB;

    return a.originalOrder - b.originalOrder;
  });

  return expandedRows.map((row, idx) => ({
    seed: idx + 1,
    status: row.status,
    candidate_index: row.candidateIndex,
    competitor_order: row.originalOrder,
    original_order: row.sourceRowNumber,
    short_gamer_tag: row.originalTag,
    gamer_tag: row.exactName,
    jjpr_rank: row.jjprRank,
    jjpr_id: row.jjprId,
    jjpr_name: row.jjprName,
    jjpr_short_name: row.jjprShortName,
    jjpr_point: row.jjprPoint,
    match_score: row.matchScore,
    jjpr_raw_row: row.jjprRawRow,
    ...row.attendee,
  }));
}

function rowsToCsv(rows) {
  return stringify(rows, {
    header: true,
    quoted_string: true,
  });
}

module.exports = {
  DEFAULT_TAG_COLUMN,
  DEFAULT_EXACT_MATCH_COLUMN,
  DEFAULT_VENUE_TYPE_COLUMN,
  DEFAULT_INCLUDED_VENUE_TYPES,
  parseAttendees,
  normalizeName,
  normalizeVenueType,
  findColumnKey,
  filterAttendeesByVenueType,
  findExactJjprCandidates,
  buildSeedRows,
  rowsToCsv,
};