const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const DEFAULT_TAG_COLUMN = 'Short GamerTag';
const DEFAULT_VENUE_TYPE_COLUMN = 'Venue Type';
const DEFAULT_INCLUDED_VENUE_TYPES = ['competitor'];

function parseAttendees(csvText) {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  return rows;
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

function buildSearchTerms(tag) {
  const raw = String(tag || '').trim();
  if (!raw) return [];
  const terms = new Set([raw]);

  // Common start.gg naming patterns: "Team | Name", "Name / Japanese", "Name｜JP".
  for (const sep of ['|', '｜', '/', '／', '・']) {
    if (raw.includes(sep)) {
      raw.split(sep).map((s) => s.trim()).filter(Boolean).forEach((s) => terms.add(s));
    }
  }
  return Array.from(terms).filter((s) => s.length > 0);
}

function scoreCandidate(tag, candidate) {
  const tagNorm = normalizeName(tag);
  const nameNorm = normalizeName(candidate.playerName || candidate.rawText || '');
  if (!tagNorm || !nameNorm) return 0;
  if (tagNorm === nameNorm) return 100;
  if (nameNorm.includes(tagNorm)) return 80;
  if (tagNorm.includes(nameNorm)) return 70;
  return 30;
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const key = `${c.rank || ''}::${normalizeName(c.playerName || '')}::${c.rawText || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

function filterAttendeesByVenueType(attendees, venueTypeColumn = DEFAULT_VENUE_TYPE_COLUMN, includedVenueTypes = DEFAULT_INCLUDED_VENUE_TYPES) {
  if (attendees.length === 0 || !venueTypeColumn) {
    return { attendees, skipped: 0, venueTypeColumnKey: null };
  }

  const venueTypeColumnKey = findColumnKey(attendees[0], venueTypeColumn);
  if (!venueTypeColumnKey) {
    return { attendees, skipped: 0, venueTypeColumnKey: null };
  }

  const allowed = new Set(includedVenueTypes.map(normalizeVenueType));
  const filtered = attendees.filter((attendee) => allowed.has(normalizeVenueType(attendee[venueTypeColumnKey])));

  return {
    attendees: filtered,
    skipped: attendees.length - filtered.length,
    venueTypeColumnKey,
  };
}

async function buildSeedRows({
  csvText,
  scraper,
  tagColumn = DEFAULT_TAG_COLUMN,
  venueTypeColumn = DEFAULT_VENUE_TYPE_COLUMN,
  includedVenueTypes = DEFAULT_INCLUDED_VENUE_TYPES,
  maxCandidates = 8,
  onProgress = () => {},
}) {
  const allAttendees = parseAttendees(csvText);
  if (allAttendees.length === 0) {
    throw new Error('CSVに参加者行がありません。');
  }

  const tagColumnKey = findColumnKey(allAttendees[0], tagColumn);
  if (!tagColumnKey) {
    const columns = Object.keys(allAttendees[0]).join(', ');
    throw new Error(`CSVに "${tagColumn}" 列がありません。見つかった列: ${columns}`);
  }

  const { attendees, skipped, venueTypeColumnKey } = filterAttendeesByVenueType(allAttendees, venueTypeColumn, includedVenueTypes);
  if (attendees.length === 0) {
    const allowed = includedVenueTypes.join(', ');
    throw new Error(`"${venueTypeColumn}" が ${allowed} の参加者が見つかりませんでした。`);
  }

  const cache = new Map();
  const expandedRows = [];

  onProgress({ index: 0, total: attendees.length, tag: '', skipped, venueTypeColumn: venueTypeColumnKey });

  for (let i = 0; i < attendees.length; i++) {
    const attendee = attendees[i];
    const tag = String(attendee[tagColumnKey] || '').trim();
    onProgress({ index: i + 1, total: attendees.length, tag, skipped, venueTypeColumn: venueTypeColumnKey });

    const terms = buildSearchTerms(tag);
    let candidates = [];

    for (const term of terms) {
      const cacheKey = normalizeName(term);
      let termMatches;
      if (cache.has(cacheKey)) {
        termMatches = cache.get(cacheKey);
      } else {
        termMatches = await scraper.search(term);
        cache.set(cacheKey, termMatches);
      }
      candidates.push(...termMatches);
    }

    candidates = uniqueCandidates(candidates)
      .map((candidate) => ({ ...candidate, matchScore: scoreCandidate(tag, candidate) }))
      .filter((candidate) => candidate.matchScore > 0)
      .sort((a, b) => {
        const rankA = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
        const rankB = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        return (b.matchScore || 0) - (a.matchScore || 0);
      })
      .slice(0, maxCandidates);

    if (candidates.length === 0) {
      expandedRows.push({
        originalOrder: i + 1,
        sourceRowNumber: allAttendees.indexOf(attendee) + 1,
        originalTag: tag,
        status: 'not_found',
        candidateIndex: '',
        jjprRank: '',
        jjprName: '',
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
        originalTag: tag,
        status: candidates.length > 1 ? 'multiple_candidates' : 'matched',
        candidateIndex: idx + 1,
        jjprRank: candidate.rank || '',
        jjprName: candidate.playerName || '',
        matchScore: candidate.matchScore || '',
        jjprRawRow: candidate.rawText || '',
        attendee,
      });
    });
  }

  expandedRows.sort((a, b) => {
    const rankA = Number.isFinite(Number(a.jjprRank)) && a.jjprRank !== '' ? Number(a.jjprRank) : Number.MAX_SAFE_INTEGER;
    const rankB = Number.isFinite(Number(b.jjprRank)) && b.jjprRank !== '' ? Number(b.jjprRank) : Number.MAX_SAFE_INTEGER;
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
    jjpr_rank: row.jjprRank,
    jjpr_name: row.jjprName,
    match_score: row.matchScore,
    jjpr_raw_row: row.jjprRawRow,
    ...row.attendee,
  }));
}

function rowsToCsv(rows) {
  return stringify(rows, { header: true, quoted_string: true });
}

module.exports = {
  DEFAULT_TAG_COLUMN,
  DEFAULT_VENUE_TYPE_COLUMN,
  DEFAULT_INCLUDED_VENUE_TYPES,
  parseAttendees,
  normalizeName,
  normalizeVenueType,
  findColumnKey,
  filterAttendeesByVenueType,
  buildSearchTerms,
  buildSeedRows,
  rowsToCsv,
};
