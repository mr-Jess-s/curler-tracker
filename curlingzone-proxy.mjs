import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const USER_AGENT = process.env.CURLER_TRACKER_UA || 'CurlerTracker/1.0 (+https://example.local)';
const BASES = [
  'https://www.curlingzone.com/scoreboard.php',
  'https://home.curlingzone.com/'
];

function normalizeName(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();
}

function decodeEntities(text = '') {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[ ]{2,}/g, ' ')
  );
}

function computeNameMatchScore(candidateName, playerNorm) {
  const norm = normalizeName(candidateName);
  if (!norm || !playerNorm) return 0;
  if (norm === playerNorm) return 100;
  if (norm.includes(playerNorm) || playerNorm.includes(norm)) return 75;
  const normParts = new Set(norm.split(' ').filter(Boolean));
  const overlap = playerNorm.split(' ').filter(Boolean).filter(part => normParts.has(part));
  if (overlap.length >= 2) return 50;
  if (overlap.length === 1) return 25;
  return 0;
}

function extractSurnameTeamName(line = '') {
  const clean = line.replace(/\s+/g, ' ').trim();
  const match = clean.match(/(.+?)\s*\(([^()]+)\)\s*$/);
  if (!match) return { teamName: clean, matchedCurler: clean };
  return { teamName: match[1].trim() + ' (' + match[2].trim() + ')', matchedCurler: match[2].trim() };
}

function findContext(lines, index, predicate, step, limit = 10) {
  for (let i = 1; i <= limit; i++) {
    const value = lines[index + i * step];
    if (!value) continue;
    if (predicate(value)) return value;
  }
  return '';
}

function parseDateish(value = '') {
  const text = value.replace(/^Draw:\s*/i, '').trim();
  const dt = Date.parse(text);
  return Number.isNaN(dt) ? null : dt;
}

function parseRowsFromText(text, player) {
  const lines = stripHtml(text)
    .split('\n')
    .map(v => v.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const playerNorm = normalizeName(player);
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNorm = normalizeName(lines[i]);
    if (!lineNorm) continue;
    if (!(lineNorm.includes(playerNorm) || playerNorm.split(' ').some(part => part && lineNorm.includes(part)))) continue;

    const eventName = findContext(lines, i, v => /teams\s*\|\s*scores\s*\|\s*standings\s*\|\s*playoffs/i.test(v), -1, 6) || findContext(lines, i, v => /draw\s*:/i.test(v), -1, 8);
    const drawLine = findContext(lines, i, v => /draw\s*:/i.test(v), -1, 8);
    const timeLine = drawLine || findContext(lines, i, v => /\b(?:mon|tue|wed|thu|fri|sat|sun)\b/i.test(v), -1, 8);
    const finalLine = findContext(lines, i, v => /^(final|live|scheduled|complete)/i.test(v), 1, 8);
    const scoreLine = findContext(lines, i, v => /^\d+$/.test(v) || /^\d+\s+final/i.test(v), 1, 6);
    const opponentLine = findContext(lines, i, v => normalizeName(v) !== lineNorm && /\(|[A-Za-z]/.test(v), 2, 6) || findContext(lines, i, v => normalizeName(v) !== lineNorm && /\(|[A-Za-z]/.test(v), -2, 6);

    const teamInfo = extractSurnameTeamName(lines[i]);
    const oppInfo = extractSurnameTeamName(opponentLine || 'TBD');
    const matchScore = Math.max(
      computeNameMatchScore(teamInfo.matchedCurler, playerNorm),
      computeNameMatchScore(teamInfo.teamName, playerNorm)
    );
    if (!matchScore) continue;

    rows.push({
      eventId: normalizeName(eventName || 'curlingzone').replace(/\s+/g, '-'),
      eventName: eventName || 'CurlingZone Event',
      matchedCurler: teamInfo.matchedCurler,
      matchedTeam: teamInfo.teamName,
      teamName: teamInfo.teamName,
      opponentName: oppInfo.teamName,
      drawLabel: drawLine.replace(/^Draw:\s*/i, '').split('--')[0]?.trim() || null,
      startsAt: timeLine || null,
      epochMs: parseDateish(timeLine || ''),
      gameTitle: '',
      state: finalLine || 'Complete',
      stateLabel: finalLine || 'Complete',
      teamScore: /^\d+$/.test(scoreLine) ? Number(scoreLine) : 0,
      opponentScore: 0,
      result: '',
      matchScore,
      sourceUrl: 'https://www.curlingzone.com/scoreboard.php'
    });
  }
  return dedupeRows(rows);
}

function dedupeRows(rows) {
  const out = new Map();
  for (const row of rows) {
    const key = [row.eventId, normalizeName(row.matchedTeam), normalizeName(row.opponentName), row.drawLabel || '', row.startsAt || ''].join('|');
    if (!out.has(key)) out.set(key, row);
  }
  return [...out.values()];
}

async function scrapeCurlingZone(player) {
  const rows = [];
  for (const url of BASES) {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' } });
    if (!res.ok) throw new Error(`CurlingZone HTTP ${res.status} for ${url}`);
    const html = await res.text();
    rows.push(...parseRowsFromText(html, player));
  }
  return { rows: dedupeRows(rows), scrapedAt: new Date().toISOString() };
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(JSON.stringify(body, null, 2));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/api/curlingzone/search') return json(res, 404, { error: 'Not found' });
  const player = url.searchParams.get('player')?.trim() || '';
  if (!player) return json(res, 400, { error: 'Missing player parameter' });
  try {
    const payload = await scrapeCurlingZone(player);
    return json(res, 200, payload);
  } catch (error) {
    return json(res, 502, { error: error.message, rows: [] });
  }
});

server.listen(PORT, () => {
  console.log(`CurlingZone adapter listening on http://localhost:${PORT}/api/curlingzone/search`);
});
