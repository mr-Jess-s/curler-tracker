const APP_VERSION = 'v30';
const CONFIG = window.CURLER_TRACKER_CONFIG || {};
const APP = {
  clubSubdomains: ['ab','canada','bc','mb','nb','nl','ns','nt','nu','on','pe','qc','sk','yt'],
  language: 'en',
  lookaheadSeasons: [0],
  idleScanMs: 72 * 60 * 60 * 1000,
  preGameWindowMs: 5 * 60 * 1000,
  postGameWindowMs: 3 * 60 * 60 * 1000,
  activePostScorePauseMs: 7 * 60 * 1000,
  activeBetweenChecksMs: 2 * 60 * 1000,
  upcomingRefreshMs: 2 * 60 * 1000,
  errorRetryMs: 30 * 60 * 1000,
  openRescanFloorMs: 15 * 1000,
  visibleRescanFloorMs: 60 * 1000,
  historyRetentionSeasons: 2,
  rosterRefreshMs: 14 * 24 * 60 * 60 * 1000,
  localKeys: {
    player: 'curler-tracker-player-v30',
    snapshot: 'curler-tracker-snapshot-v30',
    trackingHint: 'curler-tracker-hint-v30',
    seasonRoster: 'curler-tracker-season-roster-v30',
    seasonHistory: 'curler-tracker-season-history-v30',
    eventCache: 'curler-tracker-event-cache-v30'
  },
  curlingZone: {
    enabled: true,
    adapterUrl: CONFIG?.curlingZone?.adapterUrl || '',
    timeoutMs: CONFIG?.curlingZone?.timeoutMs || 15000
  }
};

const els = {
  form: document.getElementById('playerForm'),
  playerInput: document.getElementById('playerInput'),
  shareBtn: document.getElementById('shareBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  diagnosticsToggle: document.getElementById('diagnosticsToggle'),
  diagnosticsPanel: document.getElementById('diagnosticsPanel'),
  diagnosticsOutput: document.getElementById('diagnosticsOutput'),
  statusLine: document.getElementById('statusLine'),
  trackedPlayer: document.getElementById('trackedPlayer'),
  liveBadge: document.getElementById('liveBadge'),
  headlineBlock: document.getElementById('headlineBlock'),
  eventValue: document.getElementById('eventValue'),
  nextCheckValue: document.getElementById('nextCheckValue'),
  updatedValue: document.getElementById('updatedValue'),
  endsList: document.getElementById('endsList'),
  timelineHint: document.getElementById('timelineHint'),
  scheduleList: document.getElementById('scheduleList'),
  scheduleHint: document.getElementById('scheduleHint'),
  seasonHistoryList: document.getElementById('seasonHistoryList'),
  seasonHistoryHint: document.getElementById('seasonHistoryHint'),
  installBtn: document.getElementById('installBtn')
};

const state = {
  playerName: '',
  timerId: null,
  deferredPrompt: null,
  snapshot: null,
  diagnostics: { appVersion: APP_VERSION, phase: 'idle' },
  lastRunAt: 0,
  lastVisibilityScanAt: 0
};

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function shortenTeamName(name, { keepCC = false } = {}) {
  let out = String(name || '').trim();
  if (!out) return 'TBD';
  if (!keepCC) out = out.replace(/\s*C\.?C\.?$/i, '').trim();
  return out.replace(/\s+/g, ' ');
}

function formatScoreTitle(teamA, scoreA, teamB, scoreB) {
  return `${teamA} - ${scoreA} vs ${teamB} - ${scoreB}`;
}

function resolveGameTitle(row) {
  const title = String(row?.gameName || row?.game?.name || '').trim();
  return /\sv\s/i.test(title) ? '' : title;
}

function ordinalSuffix(n) {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

function formatEpochMs(epochMs) {
  if (!epochMs) return '—';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(new Date(epochMs));
}

function formatClock(value) {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? String(value || '—') : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
}

function formatDateOnly(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', year:'numeric' }).format(d);
}

function setStatus(text) { els.statusLine.textContent = text; }
function setDiagnostics(obj) { state.diagnostics = obj; els.diagnosticsOutput.textContent = JSON.stringify(obj, null, 2); }
function buildDiagnostics(base) { return { appVersion: APP_VERSION, timestamp: new Date().toISOString(), ...base }; }
function parsePlayerFromUrl() { return new URLSearchParams(window.location.search).get('player')?.trim() || ''; }
function updateUrlPlayer(player) {
  const url = new URL(window.location.href);
  if (player) url.searchParams.set('player', player); else url.searchParams.delete('player');
  history.replaceState({}, '', url.toString());
}

function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  if (value == null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}
function savePlayer(player) { localStorage.setItem(APP.localKeys.player, player); }
function saveSnapshot(snapshot) { writeJson(APP.localKeys.snapshot, snapshot); }
function loadSnapshot() { return readJson(APP.localKeys.snapshot, null); }
function saveTrackingHint(hint) { writeJson(APP.localKeys.trackingHint, hint); }
function loadTrackingHint() { return readJson(APP.localKeys.trackingHint, null); }
function clearTrackingHint() { localStorage.removeItem(APP.localKeys.trackingHint); }
function loadSeasonRosterStore() { return readJson(APP.localKeys.seasonRoster, {}); }
function saveSeasonRosterStore(store) { writeJson(APP.localKeys.seasonRoster, store); }
function loadSeasonHistoryStore() { return readJson(APP.localKeys.seasonHistory, {}); }
function saveSeasonHistoryStore(store) { writeJson(APP.localKeys.seasonHistory, store); }
function loadEventCacheStore() { return readJson(APP.localKeys.eventCache, {}); }
function saveEventCacheStore(store) { writeJson(APP.localKeys.eventCache, store); }

function currentSeasonId(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function playerKey(playerName) {
  return normalizeName(playerName);
}

function teamKey(teamName) {
  return normalizeName(teamName);
}

function eventKey(eventName, startDate, source = '') {
  return `${source}|${normalizeName(eventName)}|${String(startDate || '').slice(0, 10)}`;
}

function pruneSeasonStores() {
  const keepSeasons = new Set();
  const current = currentSeasonId();
  const [startYear] = current.split('-').map(Number);
  for (let i = 0; i < APP.historyRetentionSeasons; i++) keepSeasons.add(`${startYear - i}-${startYear - i + 1}`);

  for (const [loader, saver] of [
    [loadSeasonRosterStore, saveSeasonRosterStore],
    [loadSeasonHistoryStore, saveSeasonHistoryStore]
  ]) {
    const store = loader();
    const next = {};
    for (const [k, v] of Object.entries(store || {})) if (keepSeasons.has(v?.season)) next[k] = v;
    saver(next);
  }
}

function getSeasonRosterProfile(playerName) {
  const store = loadSeasonRosterStore();
  return store[playerKey(playerName)] || { playerKey: playerKey(playerName), season: currentSeasonId(), affiliations: [], lastUpdated: null };
}

function saveSeasonAffiliation(playerName, teamName, source, confidence, aliases = [], meta = {}) {
  if (!teamName) return;
  const store = loadSeasonRosterStore();
  const key = playerKey(playerName);
  const profile = store[key] || { playerKey: key, season: currentSeasonId(), affiliations: [], lastUpdated: null };
  profile.season = currentSeasonId();
  const tKey = teamKey(teamName);
  let aff = profile.affiliations.find(x => x.teamKey === tKey);
  if (!aff) {
    aff = {
      teamKey: tKey,
      teamName,
      teamAliases: Array.from(new Set([teamName, ...aliases].filter(Boolean))),
      confidence: 0,
      sources: [],
      firstSeen: new Date().toISOString(),
      lastValidated: null,
      eventKeys: []
    };
    profile.affiliations.push(aff);
  }
  aff.teamName = aff.teamName || teamName;
  aff.teamAliases = Array.from(new Set([...(aff.teamAliases || []), teamName, ...aliases].filter(Boolean)));
  aff.confidence = Math.max(Number(aff.confidence || 0), Number(confidence || 0));
  aff.sources = Array.from(new Set([...(aff.sources || []), source].filter(Boolean)));
  aff.lastValidated = new Date().toISOString();
  if (meta.eventKey) aff.eventKeys = Array.from(new Set([...(aff.eventKeys || []), meta.eventKey]));
  profile.lastUpdated = new Date().toISOString();
  store[key] = profile;
  saveSeasonRosterStore(store);
}

function inferFinishLabel(event, matchedTeamId, selection) {
  const stages = Array.isArray(event?.stages) ? event.stages : [];
  const row = selection?.lastCompleted || null;
  if (!row) return event?.state === 'complete' ? 'Result not fully determined' : 'In progress';
  const stageName = String(row.stageName || '').trim();
  const ourScore = getPositionScore(row.ourPos);
  const oppScore = getPositionScore(row.oppPos);
  const won = ourScore > oppScore;
  const lost = ourScore < oppScore;
  if (/final/i.test(stageName)) return won ? 'Champion' : lost ? 'Finalist' : 'Final';
  if (/semi/i.test(stageName)) return won ? 'Advanced from semifinal' : 'Semifinalist';
  if (/quarter/i.test(stageName)) return won ? 'Advanced from quarterfinal' : 'Quarterfinalist';
  if (/qualifier/i.test(stageName)) return won ? `Won ${stageName}` : `Eliminated in ${stageName}`;
  const completeState = String(event?.state || '').toLowerCase() === 'complete';
  if (completeState) return 'Exited round robin';
  return stages.some(s => /playoff|semi|quarter|final|qualifier/i.test(String(s?.name || ''))) ? 'Result not fully determined' : 'Exited round robin';
}

function mergeSeasonEventHistory(playerName, eventRecord) {
  const store = loadSeasonHistoryStore();
  const key = playerKey(playerName);
  const season = currentSeasonId();
  const profile = store[key] || { playerKey: key, season, events: [], lastUpdated: null };
  profile.season = season;
  const eKey = eventRecord.eventKey || eventKey(eventRecord.eventName, eventRecord.startDate, eventRecord.source);
  let found = profile.events.find(x => x.eventKey === eKey && x.teamKey === eventRecord.teamKey);
  if (!found) {
    found = { ...eventRecord, eventKey: eKey };
    profile.events.push(found);
  } else {
    Object.assign(found, { ...found, ...eventRecord, eventKey: eKey });
  }
  profile.events.sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')) || String(a.eventName || '').localeCompare(String(b.eventName || '')));
  profile.lastUpdated = new Date().toISOString();
  store[key] = profile;
  saveSeasonHistoryStore(store);
  return found;
}

function getSeasonHistoryProfile(playerName) {
  const store = loadSeasonHistoryStore();
  return store[playerKey(playerName)] || { playerKey: playerKey(playerName), season: currentSeasonId(), events: [], lastUpdated: null };
}

function saveEventCache(playerName, candidate) {
  if (!candidate?.event?.id) return;
  const store = loadEventCacheStore();
  store[playerKey(playerName)] = {
    playerKey: playerKey(playerName),
    source: candidate.source || 'curlingio',
    eventId: candidate.event.id,
    eventName: candidate.event.name,
    subdomain: candidate.subdomain || null,
    matchedTeamId: candidate.match?.team?.id || null,
    matchedTeamName: candidate.match?.team?.name || '',
    matchedCurler: candidate.match?.curler?.name || '',
    identityScore: Number(candidate.identityScore || candidate.match?.score || 0),
    savedAt: new Date().toISOString()
  };
  saveEventCacheStore(store);
}

function loadEventCache(playerName) {
  const store = loadEventCacheStore();
  return store[playerKey(playerName)] || null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchJsonWithTimeout(url, { timeoutMs = 15000, headers = { Accept: 'application/json' }, cache = 'no-store' } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, cache, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  } finally {
    window.clearTimeout(timer);
  }
}

function competitionsUrl(subdomain, delta) {
  return `https://api-curlingio.global.ssl.fastly.net/${APP.language}/clubs/${subdomain}/competitions?occurred=${encodeURIComponent(delta)}&registrations=f`;
}
function eventUrl(subdomain, eventId) {
  return `https://api-curlingio.global.ssl.fastly.net/${APP.language}/clubs/${subdomain}/events/${eventId}`;
}
function parseEventDateToMs(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
function startOfTodayMs() { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
function isEventTodayForward(event) {
  const today = startOfTodayMs();
  const state = String(event?.state || '').toLowerCase();
  if (state === 'active') return true;
  const endsMs = parseEventDateToMs(event?.ends_on);
  const startsMs = parseEventDateToMs(event?.starts_on);
  return (!!endsMs && endsMs >= today) || (!!startsMs && startsMs >= today);
}

function teamMap(event) { const m = new Map(); for (const team of (event.teams || [])) m.set(team.id, team); return m; }
function flattenGames(event) {
  const rows = [];
  for (const stage of (event.stages || [])) {
    for (const game of (stage.games || [])) rows.push({ ...game, stageId: stage.id, stageName: stage.name, stageType: stage.type });
  }
  return rows;
}

function teamAliases(team) {
  const raw = [team?.name, team?.short_name, team?.shortName, team?.affiliation, team?.location].filter(Boolean).map(String);
  const out = new Set();
  for (const item of raw) {
    const n = normalizeName(item);
    if (!n) continue;
    out.add(n);
    out.add(n.replace(/\bc\s*c\b/g,'').replace(/\s+/g,' ').trim());
    out.add(n.replace(/\bcurling club\b/g,'').replace(/\s+/g,' ').trim());
    out.add(n.replace(/\bclub\b/g,'').replace(/\s+/g,' ').trim());
    out.add(n.replace(/\s+#\s*/g,'#'));
    const first = n.split(' ')[0];
    if (first) out.add(first);
  }
  return Array.from(out).filter(Boolean).sort((a,b)=>b.length-a.length);
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

function splitNameParts(name) { return normalizeName(name).split(' ').filter(Boolean); }
function computeIdentityMatchScore(searchName, candidateName) {
  const searchNorm = normalizeName(searchName);
  const candNorm = normalizeName(candidateName);
  if (!searchNorm || !candNorm) return 0;
  if (searchNorm === candNorm) return 100;
  const searchParts = splitNameParts(searchNorm);
  const candParts = splitNameParts(candNorm);
  const [sf = '', sl = ''] = [searchParts[0] || '', searchParts[searchParts.length - 1] || ''];
  const [cf = '', cl = ''] = [candParts[0] || '', candParts[candParts.length - 1] || ''];
  if (sl && cl && sl === cl) {
    if (sf && cf && sf === cf) return 95;
    if (sf && cf && sf[0] === cf[0]) return 92;
    if (searchParts.length >= 2 && candParts.length >= 2) return 88;
  }
  if (sf && sl && sf === cl && sl === cf) return 90;
  const candSet = new Set(candParts);
  const overlap = searchParts.filter(part => candSet.has(part));
  if (overlap.length >= 2) return 82;
  if (overlap.length === 1 && sl && candSet.has(sl)) return 72;
  if (candNorm.includes(searchNorm) || searchNorm.includes(candNorm)) return 70;
  return 0;
}

function findMatchingTeam(event, playerNameNorm) {
  let best = null;
  for (const team of (event.teams || [])) {
    for (const curler of (team.lineup || [])) {
      const norm = normalizeName(curler.name);
      if (!norm) continue;
      let score = 0;
      if (norm === playerNameNorm) score = 100;
      else if (norm.includes(playerNameNorm) || playerNameNorm.includes(norm)) score = 75;
      else {
        const overlap = playerNameNorm.split(' ').filter(Boolean).filter(part => norm.split(' ').includes(part));
        if (overlap.length >= 2) score = 50;
        else if (overlap.length === 1) score = 25;
      }
      if (score > (best?.score || 0)) best = { team, curler, score };
    }
  }
  return best;
}

function getGamePositions(game) {
  const raw = game?.game_positions || game?.gamePositions || game?.positions || game?.entries || game?.sides || [];
  return Array.isArray(raw) ? raw : [];
}
function getTeamIdFromPosition(pos) { return pos?.team_id ?? pos?.teamId ?? pos?.team?.id ?? null; }
function getPositionScore(pos) { return Number(pos?.score ?? pos?.total_score ?? pos?.totalScore ?? 0); }
function getEndScores(pos) { const raw = pos?.end_scores || pos?.endScores || []; return Array.isArray(raw) ? raw : []; }
function getPositionResult(pos) { return pos?.result || pos?.state || null; }
function extractGameIdFromSheetEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') return entry.game_id || entry.gameId || entry.id || entry.game?.id || null;
  return null;
}
function drawGameIds(draw) {
  const out = [];
  for (const arr of [draw?.draw_sheets, draw?.drawSheets, draw?.sheets]) {
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      const gid = extractGameIdFromSheetEntry(entry);
      if (gid) out.push(gid);
    }
  }
  return out;
}
function buildGameMap(event) {
  const map = new Map();
  for (const game of flattenGames(event)) map.set(game.id, game);
  return map;
}
function gameMatchesTeamByAlias(game, team) {
  const gameNameNorm = normalizeName(game?.name || '');
  if (!gameNameNorm) return false;
  const aliases = teamAliases(team);
  return aliases.some(alias => alias && gameNameNorm.includes(alias));
}

function inferLifecycle(game, drawEpochMs) {
  const state = String(game?.state || '').toLowerCase();
  const now = Date.now();
  if (['active', 'playing', 'in progress'].includes(state)) return 'playing';
  if (['completed', 'complete', 'final'].includes(state)) return 'complete';
  if (drawEpochMs && drawEpochMs > now) {
    if (drawEpochMs - APP.preGameWindowMs <= now) return 'pending-window';
    return 'pending';
  }
  const positions = getGamePositions(game);
  const anyScore = positions.some(pos => getPositionScore(pos) > 0 || getEndScores(pos).length);
  if (anyScore) return 'complete';
  return 'unknown';
}

function buildDrawFirstRows(event, matchedTeam) {
  const gameMap = buildGameMap(event);
  const rows = [];
  for (const draw of (event.draws || [])) {
    const gameIds = drawGameIds(draw);
    for (const gameId of gameIds) {
      const game = gameMap.get(gameId);
      if (!game) continue;
      const positions = getGamePositions(game);
      const ourPos = positions.find(pos => getTeamIdFromPosition(pos) === matchedTeam.id) || null;
      if (!ourPos && !gameMatchesTeamByAlias(game, matchedTeam)) continue;
      const oppPos = positions.find(pos => getTeamIdFromPosition(pos) && getTeamIdFromPosition(pos) !== matchedTeam.id) || {};
      const oppTeam = teamMap(event).get(getTeamIdFromPosition(oppPos)) || { name:'TBD', id:null };
      const epochMs = parseEventDateToMs(draw?.starts_at || draw?.startsAt || game?.starts_at || game?.startsAt);
      rows.push({
        draw,
        game,
        gameId: game.id,
        gameName: game.name || '',
        drawLabel: draw?.name || draw?.label || null,
        stageName: game.stageName || null,
        startsAt: epochMs ? formatEpochMs(epochMs) : 'TBD',
        epochMs,
        lifecycle: inferLifecycle(game, epochMs),
        linked: !!ourPos,
        aliasMatch: !ourPos && gameMatchesTeamByAlias(game, matchedTeam),
        openSlots: 0,
        ourPos: ourPos || { team_id: matchedTeam.id, score: 0, end_scores: [] },
        oppPos,
        oppTeam
      });
    }
  }
  return rows.sort((a,b) => (a.epochMs ?? Number.MAX_SAFE_INTEGER) - (b.epochMs ?? Number.MAX_SAFE_INTEGER));
}

function selectGamesForEvent(event, matchedTeam) {
  const rows = buildDrawFirstRows(event, matchedTeam);
  const linkedRows = rows.filter(r => r.linked || r.aliasMatch);
  const active = linkedRows.find(r => r.lifecycle === 'playing') || null;
  const next = linkedRows.find(r => ['pending-window','pending'].includes(r.lifecycle)) || null;
  const lastCompleted = [...linkedRows].reverse().find(r => ['complete','just-finished'].includes(r.lifecycle)) || null;
  const stateCounts = {};
  for (const row of rows) stateCounts[row.lifecycle] = (stateCounts[row.lifecycle] || 0) + 1;
  return {
    rows,
    linkedRows,
    active,
    next,
    inferredNext: null,
    lastCompleted,
    diagnostics: {
      totalStageGames: flattenGames(event).length,
      totalDrawGameRefs: (event.draws || []).reduce((acc, draw) => acc + drawGameIds(draw).length, 0),
      linkedGames: linkedRows.length,
      assignedGames: linkedRows.filter(r => r.linked).length,
      aliasMatchedGames: linkedRows.filter(r => r.aliasMatch).length,
      futureAssignedGames: linkedRows.filter(r => ['pending-window','pending'].includes(r.lifecycle)).length,
      futureOpenSlotGames: 0,
      stateCounts,
      matchedTeamAliases: teamAliases(matchedTeam),
      inferredLinkedGames: [],
      unmatchedDrawRows: [],
      usedInference: false
    }
  };
}

function buildEnds(ourPos, oppPos, totalEnds = 8, lifecycle = 'unknown') {
  const ours = getEndScores(ourPos);
  const opps = getEndScores(oppPos);
  const isComplete = ['complete','just-finished'].includes(lifecycle) || ['won','lost','tied'].includes(String(getPositionResult(ourPos) || '').toLowerCase());
  const playedLength = Math.max(ours.length, opps.length);
  const length = Math.max(totalEnds || 0, playedLength);
  const rows = [];
  for (let i = 0; i < length; i++) {
    const hasPosted = i < playedLength;
    rows.push({
      end: i + 1,
      team: hasPosted ? String(Number(ours[i] ?? 0)) : (isComplete ? 'X' : ''),
      opponent: hasPosted ? String(Number(opps[i] ?? 0)) : (isComplete ? 'X' : '')
    });
  }
  return { rows, total: { team: String(getPositionScore(ourPos)), opponent: String(getPositionScore(oppPos)) } };
}

function deriveHammer(teamAName, teamBName, endScoresA, endScoresB, firstHammerTeamName) {
  let hammer = firstHammerTeamName || 'Unknown';
  const maxEnds = Math.max(endScoresA.length, endScoresB.length);
  for (let i = 0; i < maxEnds; i++) {
    const a = Number(endScoresA[i] ?? 0), b = Number(endScoresB[i] ?? 0);
    if (a > 0 && b === 0) hammer = teamBName;
    else if (b > 0 && a === 0) hammer = teamAName;
  }
  return hammer;
}

function getProgressSignature(row) {
  if (!row) return '';
  return JSON.stringify({
    gameId: row.gameId,
    our: getEndScores(row.ourPos),
    opp: getEndScores(row.oppPos),
    ourScore: getPositionScore(row.ourPos),
    oppScore: getPositionScore(row.oppPos)
  });
}

function computeCheckDelay(selection, previousSnapshot = null) {
  const now = Date.now();
  if (selection.active) {
    const currentSig = getProgressSignature(selection.active);
    const sameAsPrevious = previousSnapshot && previousSnapshot.activeGameId === selection.active.gameId && previousSnapshot.progressSignature === currentSig;
    return sameAsPrevious
      ? { delayMs: APP.activeBetweenChecksMs, reason: 'focused-live poll after 2-minute cadence' }
      : { delayMs: APP.activePostScorePauseMs, reason: 'pause 7 minutes after posted live score change' };
  }
  const nextConfirmed = selection.next;
  if (nextConfirmed) {
    const preWindowAt = (nextConfirmed.epochMs || now) - APP.preGameWindowMs;
    if (preWindowAt > now) return { delayMs: preWindowAt - now, reason: 'sleep until 5 minutes before scheduled game start' };
    return { delayMs: APP.upcomingRefreshMs, reason: 'focused-upcoming polling inside pre-game window' };
  }
  const nextRow = selection.rows.find(r => r.linked && r.epochMs && r.epochMs > now);
  if (nextRow) {
    const preWindowAt = nextRow.epochMs - APP.preGameWindowMs;
    if (preWindowAt > now) return { delayMs: preWindowAt - now, reason: 'sleep until 5 minutes before scheduled game start' };
    return { delayMs: APP.upcomingRefreshMs, reason: 'upcoming polling inside pre-game window' };
  }
  return { delayMs: APP.idleScanMs, reason: 'event complete, resume discovery scans' };
}

function renderHeadline(snapshot) {
  if (!snapshot) {
    els.headlineBlock.innerHTML = '<p class="headline-empty">Enter a curler’s name to begin.</p>';
    return;
  }
  if (snapshot.view === 'live') {
    const titlePrefix = snapshot.gameTitle ? `${escapeHtml(snapshot.gameTitle)} · ` : '';
    els.headlineBlock.innerHTML = `<div><div class="headline-main">${escapeHtml(formatScoreTitle(snapshot.teamName, snapshot.teamScore, snapshot.opponentName, snapshot.opponentScore))}</div><div class="headline-sub">${titlePrefix}Now playing ${escapeHtml(snapshot.currentEndLabel)} · ${escapeHtml(snapshot.hammerSubtitle || 'Hammer unknown')}</div></div>`;
    return;
  }
  if (snapshot.view === 'upcoming') {
    els.headlineBlock.innerHTML = `<div><div class="headline-main">No live game</div><div class="headline-sub">Next game: ${escapeHtml(snapshot.nextGameLabel || 'TBD')}</div></div>`;
    return;
  }
  if (snapshot.view === 'idle-event') {
    els.headlineBlock.innerHTML = `<div><div class="headline-main">Watching this event</div><div class="headline-sub">${escapeHtml(snapshot.nextGameLabel || 'No active draw right now.')}</div></div>`;
    return;
  }
  els.headlineBlock.innerHTML = `<div><div class="headline-main">No active event found</div><div class="headline-sub">Season history has been cached. The app will scan again later.</div></div>`;
}

function renderEnds(teamName, opponentName, endsData) {
  const rowsIn = endsData?.rows || [];
  const total = endsData?.total || null;
  if (!rowsIn.length) {
    els.endsList.className = 'ends-list empty';
    els.endsList.innerHTML = '<p>No end scores yet.</p>';
    return;
  }
  els.endsList.className = 'ends-list';
  let html = `<div class="ends-grid ends-header"><span>End</span><span>${escapeHtml(shortenTeamName(teamName, { keepCC: true }))}</span><span>${escapeHtml(shortenTeamName(opponentName, { keepCC: true }))}</span></div>`;
  for (const row of rowsIn) {
    html += `<div class="ends-grid end-row"><div class="end-label">${row.end}</div><div class="end-score-cell">${escapeHtml(row.team)}</div><div class="end-score-cell">${escapeHtml(row.opponent)}</div></div>`;
  }
  if (total) html += `<div class="ends-grid total-row"><div class="end-label">Final</div><div class="end-score-cell">${escapeHtml(total.team)}</div><div class="end-score-cell">${escapeHtml(total.opponent)}</div></div>`;
  els.endsList.innerHTML = html;
}

function formatScheduleTime(row) { return row.startsAt || formatEpochMs(row.epochMs) || 'TBD'; }

function dedupeScheduleRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = `${normalizeName(row?.eventName || '')}|${normalizeName(row?.team || '')}|${normalizeName(row?.opponent || '')}|${String(row?.epochMs || '')}|${normalizeName(row?.gameName || '')}`;
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values()).sort((a,b) => (a.epochMs ?? Number.MAX_SAFE_INTEGER) - (b.epochMs ?? Number.MAX_SAFE_INTEGER));
}

function renderSchedule(scheduleRows, activeGameId, nextGameId) {
  const rows = dedupeScheduleRows(scheduleRows);
  if (!rows.length) {
    els.scheduleList.className = 'schedule-list empty';
    els.scheduleList.innerHTML = '<p>No scheduled draws to show.</p>';
    return;
  }
  els.scheduleList.className = 'schedule-list';
  els.scheduleList.innerHTML = rows.map(row => {
    const klass = row.gameId === activeGameId ? 'schedule-row active' : row.gameId === nextGameId ? 'schedule-row upcoming' : 'schedule-row';
    const sourceBadge = row.source === 'curlingzone' ? '<span class="tiny-badge">CZ</span>' : '<span class="tiny-badge">CIO</span>';
    const title = resolveGameTitle(row) ? `<div class="schedule-sub">${escapeHtml(resolveGameTitle(row))}</div>` : '';
    return `<div class="${klass}"><div><div class="schedule-label">${escapeHtml(shortenTeamName(row.team, { keepCC: true }))} vs ${escapeHtml(shortenTeamName(row.opponent, { keepCC: true }))} ${sourceBadge}</div>${title}</div><div class="schedule-meta"><div>${escapeHtml(formatScheduleTime(row))}</div><div>${escapeHtml(row.stateLabel || '')}</div></div></div>`;
  }).join('');
}

function renderSeasonHistory(profile, rosterProfile) {
  const events = Array.isArray(profile?.events) ? profile.events.slice().sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))) : [];
  const affiliations = Array.isArray(rosterProfile?.affiliations) ? rosterProfile.affiliations.slice().sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0)) : [];
  const affText = affiliations.length
    ? `Known in-season affiliations: ${affiliations.map(a => `${a.teamName} (${Math.round(Number(a.confidence || 0))})`).join(', ')}`
    : 'No season affiliations cached yet.';
  els.seasonHistoryHint.textContent = affText;
  if (!events.length) {
    els.seasonHistoryList.className = 'season-history-list empty';
    els.seasonHistoryList.innerHTML = '<p>No season tournament history cached yet.</p>';
    return;
  }
  els.seasonHistoryList.className = 'season-history-list';
  els.seasonHistoryList.innerHTML = events.map(evt => `<div class="history-row"><div><div class="schedule-label">${escapeHtml(evt.eventName || 'Unknown event')}</div><div class="schedule-sub">${escapeHtml(evt.teamName || 'Unknown team')} · ${escapeHtml(evt.source || '').toUpperCase()}</div></div><div class="schedule-meta schedule-meta-left"><div>${escapeHtml(formatDateOnly(evt.startDate))} — ${escapeHtml(formatDateOnly(evt.endDate))}</div><div>${escapeHtml(evt.finish || 'Result not fully determined')}</div></div></div>`).join('');
}

function updateBadge(view) {
  els.liveBadge.className = 'badge';
  if (view === 'live') { els.liveBadge.classList.add('live'); els.liveBadge.textContent = 'Live'; return; }
  if (view === 'upcoming') { els.liveBadge.classList.add('upcoming'); els.liveBadge.textContent = 'Upcoming'; return; }
  if (view === 'idle-event') { els.liveBadge.classList.add('complete'); els.liveBadge.textContent = 'Watching'; return; }
  els.liveBadge.classList.add('muted'); els.liveBadge.textContent = 'Idle';
}

function render(snapshot) {
  state.snapshot = snapshot;
  saveSnapshot(snapshot);
  els.trackedPlayer.textContent = snapshot?.displayPlayer || snapshot?.playerName || '—';
  updateBadge(snapshot?.view || 'idle');
  renderHeadline(snapshot);
  els.eventValue.textContent = snapshot?.eventName || '—';
  els.nextCheckValue.textContent = snapshot?.nextCheckAt ? formatClock(snapshot.nextCheckAt) : '—';
  els.updatedValue.textContent = snapshot?.lastUpdatedLabel || '—';
  els.timelineHint.textContent = snapshot?.timelineHint || 'Waiting for a live game.';
  els.scheduleHint.textContent = snapshot?.scheduleHint || 'No event loaded.';
  renderEnds(snapshot?.teamName || 'Team', snapshot?.opponentName || 'Opponent', snapshot?.ends || { rows: [] });
  renderSchedule(snapshot?.scheduleRows || [], snapshot?.activeGameId || null, snapshot?.nextGameId || null);
  renderSeasonHistory(snapshot?.seasonHistory || getSeasonHistoryProfile(snapshot?.playerName || ''), snapshot?.seasonRoster || getSeasonRosterProfile(snapshot?.playerName || ''));
  setDiagnostics(snapshot?.diagnostics || {});
}

function scheduleNextRun(delayMs) {
  if (state.timerId) window.clearTimeout(state.timerId);
  state.timerId = window.setTimeout(() => runTracker({ reason: 'timer' }), Math.max(1000, delayMs));
}

function computeIdleSnapshot(playerName, diagnostics, delayMs) {
  return {
    playerName,
    displayPlayer: playerName,
    view: 'idle',
    teamName: '',
    opponentName: '',
    teamScore: 0,
    opponentScore: 0,
    gameTitle: '',
    currentEndLabel: 'Waiting',
    drawTitle: '',
    hammerNext: '—',
    hammerSubtitle: 'Hammer unknown',
    eventName: 'No active event',
    source: '',
    ends: { rows: [], total: null },
    scheduleRows: [],
    activeGameId: null,
    nextGameId: null,
    nextGameLabel: 'No next game available',
    timelineHint: 'No live game available.',
    scheduleHint: 'No current event loaded.',
    nextCheckAt: Date.now() + delayMs,
    lastUpdatedLabel: formatClock(Date.now()),
    diagnostics,
    eventId: null,
    nextCheckReason: diagnostics?.policy || 'Idle discovery scans only',
    nextGameConfirmed: false,
    progressSignature: '',
    seasonRoster: getSeasonRosterProfile(playerName),
    seasonHistory: getSeasonHistoryProfile(playerName)
  };
}

function computeEventTimeBounds(selection) {
  const rows = selection?.linkedRows?.length ? selection.linkedRows : (selection?.rows || []);
  const times = rows.map(r => Number(r?.epochMs || 0)).filter(Boolean).sort((a,b) => a - b);
  if (!times.length) return { startMs: null, endMs: null };
  return { startMs: times[0], endMs: times[times.length - 1] + APP.postGameWindowMs };
}
function eventsConflictInTime(a, b) {
  const at = computeEventTimeBounds(a.selection);
  const bt = computeEventTimeBounds(b.selection);
  if (!at.startMs || !at.endMs || !bt.startMs || !bt.endMs) return false;
  return at.startMs <= bt.endMs && bt.startMs <= at.endMs;
}
function getCandidatePrimaryTime(candidate) {
  return Number(candidate?.selection?.active?.epochMs || candidate?.selection?.next?.epochMs || candidate?.selection?.lastCompleted?.epochMs || candidate?.eventStartMs || 0) || Number.MAX_SAFE_INTEGER;
}
function computeCandidateIdentityScore(playerName, candidate) {
  const names = new Set([
    candidate?.match?.curler?.name,
    candidate?.matchedCurler,
    candidate?.selectionRows?.[0]?.matchedCurler,
    candidate?.selectionRows?.[0]?.teamSkip,
    candidate?.selectionRows?.[0]?.teamName
  ].filter(Boolean));
  let best = 0;
  for (const name of names) best = Math.max(best, computeIdentityMatchScore(playerName, name));
  const baseScore = Number(candidate?.match?.score || 0);
  if (best === 0) best = baseScore;
  if (baseScore === 100 && best < 100) best = Math.max(best, 96);
  return best;
}
function buildCanonicalEventKey(candidate) {
  const eventName = normalizeName(candidate?.event?.name || '');
  const teamName = normalizeName(candidate?.match?.team?.name || '');
  const primaryTime = getCandidatePrimaryTime(candidate);
  const dayBucket = Number.isFinite(primaryTime) && primaryTime !== Number.MAX_SAFE_INTEGER ? new Date(primaryTime).toISOString().slice(0, 10) : 'no-date';
  return `${eventName}|${teamName}|${dayBucket}`;
}

function findRosterAffiliationBoost(playerName, candidate) {
  const roster = getSeasonRosterProfile(playerName);
  const cTeam = normalizeName(candidate?.match?.team?.name || '');
  if (!cTeam) return 0;
  for (const aff of roster.affiliations || []) {
    const aliases = [aff.teamName, ...(aff.teamAliases || [])].map(normalizeName).filter(Boolean);
    if (aliases.includes(cTeam)) return Math.min(24, Math.round(Number(aff.confidence || 0) / 4));
  }
  return 0;
}

function findHistoryBoost(playerName, candidate) {
  const hist = getSeasonHistoryProfile(playerName);
  const cEvent = normalizeName(candidate?.event?.name || '');
  const cTeam = normalizeName(candidate?.match?.team?.name || '');
  const matches = (hist.events || []).filter(evt => normalizeName(evt.eventName) === cEvent && normalizeName(evt.teamName) === cTeam).length;
  return matches ? 18 : 0;
}

function chooseBetterCandidateForSameEvent(a, b, playerNorm) {
  const SOURCE_PRIORITY = { curlingio: 0, curlingzone: 1 };
  const aExact = normalizeName(a.match.curler.name) === playerNorm ? 1 : 0;
  const bExact = normalizeName(b.match.curler.name) === playerNorm ? 1 : 0;
  const cmp =
    (bExact - aExact) ||
    ((b.identityScore || 0) - (a.identityScore || 0)) ||
    ((b.match.score || 0) - (a.match.score || 0)) ||
    ((SOURCE_PRIORITY[a.source || 'curlingio'] ?? 99) - (SOURCE_PRIORITY[b.source || 'curlingio'] ?? 99)) ||
    (a.scoreRank - b.scoreRank) ||
    (getCandidatePrimaryTime(a) - getCandidatePrimaryTime(b));
  return cmp <= 0 ? a : b;
}

function clusterAndPrioritizeCandidates(playerName, candidates) {
  const playerNorm = normalizeName(playerName);
  const enriched = candidates.map(candidate => {
    const identityScore = computeCandidateIdentityScore(playerName, candidate);
    const rosterBoost = findRosterAffiliationBoost(playerName, candidate);
    const historyBoost = findHistoryBoost(playerName, candidate);
    return { ...candidate, identityScore, rosterBoost, historyBoost, weightedScore: identityScore + rosterBoost + historyBoost, canonicalEventKey: buildCanonicalEventKey(candidate) };
  }).filter(candidate => candidate.identityScore > 0);

  const dedupedMap = new Map();
  for (const candidate of enriched) {
    const existing = dedupedMap.get(candidate.canonicalEventKey);
    if (!existing) dedupedMap.set(candidate.canonicalEventKey, candidate);
    else dedupedMap.set(candidate.canonicalEventKey, chooseBetterCandidateForSameEvent(existing, candidate, playerNorm));
  }

  const deduped = Array.from(dedupedMap.values());
  for (const candidate of deduped) candidate.conflictPenalty = 0;
  for (let i = 0; i < deduped.length; i++) {
    for (let j = i + 1; j < deduped.length; j++) {
      if (!eventsConflictInTime(deduped[i], deduped[j])) continue;
      if ((deduped[i].weightedScore || 0) >= (deduped[j].weightedScore || 0)) deduped[j].conflictPenalty += 18;
      else deduped[i].conflictPenalty += 18;
    }
  }

  return deduped.sort((a, b) =>
    (normalizeName(b.match.curler.name) === playerNorm ? 1 : 0) - (normalizeName(a.match.curler.name) === playerNorm ? 1 : 0) ||
    ((b.weightedScore || 0) - (b.conflictPenalty || 0)) - ((a.weightedScore || 0) - (a.conflictPenalty || 0)) ||
    ((b.match.score || 0) - (a.match.score || 0)) ||
    (a.scoreRank - b.scoreRank) ||
    (getCandidatePrimaryTime(a) - getCandidatePrimaryTime(b))
  );
}

function buildTrackingHint(playerName, candidate, candidatePool = []) {
  if (!candidate?.event?.id || !candidate?.match?.team?.name) return null;
  const identityVariants = [playerName, candidate?.match?.curler?.name, candidate?.match?.team?.name].filter(Boolean);
  return {
    playerName,
    playerNorm: normalizeName(playerName),
    source: candidate.source || 'curlingio',
    sourceSubdomain: candidate.subdomain || null,
    eventId: candidate.event.id,
    eventName: candidate.event.name,
    matchedTeamId: candidate.match.team.id || null,
    matchedTeamName: candidate.match.team.name,
    matchedCurler: candidate.match.curler.name,
    matchScore: Number(candidate.match.score || 0),
    identityScore: Number(candidate.identityScore || candidate.match.score || 0),
    identityVariants,
    savedAt: new Date().toISOString(),
    recentContexts: candidatePool.slice(0, 4).map(item => ({
      source: item.source || 'curlingio',
      sourceSubdomain: item.subdomain || null,
      eventId: item.event?.id || null,
      eventName: item.event?.name || '',
      matchedTeamId: item.match?.team?.id || null,
      matchedTeamName: item.match?.team?.name || '',
      matchedCurler: item.match?.curler?.name || '',
      identityScore: Number(item.identityScore || item.match?.score || 0),
      startsAtMs: getCandidatePrimaryTime(item)
    }))
  };
}

function isTrackingHintEligible(playerName, hint) {
  const variants = [hint?.playerName, hint?.playerNorm, ...(Array.isArray(hint?.identityVariants) ? hint.identityVariants : [])].filter(Boolean);
  const searchNorm = normalizeName(playerName);
  const best = variants.reduce((acc, value) => Math.max(acc, computeIdentityMatchScore(searchNorm, value)), 0);
  return !!hint && best >= 88 && Number(hint.identityScore || hint.matchScore || 0) >= 88 && !!hint.eventId;
}

function inferLifecycleFromCzRow(row) {
  const state = normalizeName(row?.state || row?.status || '');
  const result = normalizeName(row?.result || '');
  if (state.includes('live') || state.includes('in progress') || state.includes('playing')) return 'playing';
  if (state.includes('scheduled') || state.includes('upcoming') || state.includes('starting soon')) return 'pending';
  if (state.includes('final') || state.includes('complete') || result === 'won' || result === 'lost' || result === 'tied') return 'complete';
  const epochMs = Number(row?.epochMs || 0) || null;
  if (epochMs && epochMs > Date.now()) return 'pending';
  if (epochMs && epochMs <= Date.now()) return 'complete';
  return 'unknown';
}
function getResultFromScores(teamScore, opponentScore) {
  const our = Number(teamScore || 0);
  const opp = Number(opponentScore || 0);
  if (our > opp) return 'won';
  if (our < opp) return 'lost';
  return 'tied';
}

function buildCurlingZoneSelection(rows, matchedTeamName) {
  const normalizedRows = rows.map((row, idx) => {
    const lifecycle = inferLifecycleFromCzRow(row);
    const ourPos = { team_id: `cz-team:${normalizeName(matchedTeamName)}`, score: Number(row.teamScore || 0), end_scores: [], result: row.result || getResultFromScores(row.teamScore, row.opponentScore) };
    const oppPos = { team_id: `cz-opp:${normalizeName(row.opponentName || 'tbd')}:${idx}`, score: Number(row.opponentScore || 0), end_scores: [], result: ourPos.result === 'won' ? 'lost' : ourPos.result === 'lost' ? 'won' : 'tied' };
    return {
      draw: { label: row.drawLabel || null },
      game: { id: row.gameId || `cz:${row.eventId || 'event'}:${idx}`, name: row.gameTitle || '', state: row.state || lifecycle, game_positions: [ourPos, oppPos] },
      gameId: row.gameId || `cz:${row.eventId || 'event'}:${idx}`,
      gameName: row.gameTitle || '',
      drawLabel: row.drawLabel || null,
      startsAt: row.startsAt || (row.epochMs ? formatEpochMs(row.epochMs) : 'TBD'),
      epochMs: Number(row.epochMs || 0) || null,
      lifecycle,
      linked: true,
      aliasMatch: false,
      openSlots: 0,
      ourPos,
      oppPos,
      oppTeam: { id: oppPos.team_id, name: row.opponentName || 'TBD' },
      stateLabel: row.stateLabel || row.state || (lifecycle === 'playing' ? 'Live' : lifecycle === 'pending' ? 'Scheduled' : lifecycle === 'complete' ? 'Complete' : 'Unknown'),
      sourceUrl: row.sourceUrl || null
    };
  }).sort((a, b) => (a.epochMs ?? Number.MAX_SAFE_INTEGER) - (b.epochMs ?? Number.MAX_SAFE_INTEGER));

  const active = normalizedRows.find(r => r.lifecycle === 'playing') || null;
  const next = normalizedRows.find(r => ['pending-window', 'pending'].includes(r.lifecycle)) || null;
  const lastCompleted = [...normalizedRows].reverse().find(r => ['just-finished','complete'].includes(r.lifecycle)) || null;
  return {
    rows: normalizedRows,
    linkedRows: normalizedRows,
    active,
    next,
    inferredNext: null,
    lastCompleted,
    diagnostics: {
      totalStageGames: normalizedRows.length,
      totalDrawGameRefs: normalizedRows.length,
      linkedGames: normalizedRows.length,
      assignedGames: normalizedRows.length,
      aliasMatchedGames: 0,
      futureAssignedGames: normalizedRows.filter(r => ['pending-window','pending'].includes(r.lifecycle)).length,
      futureOpenSlotGames: 0,
      stateCounts: normalizedRows.reduce((acc, row) => { acc[row.lifecycle] = (acc[row.lifecycle] || 0) + 1; return acc; }, {}),
      matchedTeamAliases: [],
      inferredLinkedGames: [],
      unmatchedDrawRows: [],
      usedInference: false
    }
  };
}

async function discoverPlayerEventFromHint(playerName, hint) {
  if (!isTrackingHintEligible(playerName, hint)) return null;
  const contexts = Array.isArray(hint?.recentContexts) && hint.recentContexts.length ? hint.recentContexts : [{
    source: hint.source || 'curlingio',
    sourceSubdomain: hint.sourceSubdomain || null,
    eventId: hint.eventId || null,
    matchedTeamId: hint.matchedTeamId || null,
    matchedTeamName: hint.matchedTeamName || '',
    matchedCurler: hint.matchedCurler || '',
    identityScore: Number(hint.identityScore || hint.matchScore || 0)
  }];

  for (const ctx of contexts.sort((a,b) => Number(b.identityScore || 0) - Number(a.identityScore || 0))) {
    if ((ctx.source || 'curlingio') === 'curlingio' && ctx.sourceSubdomain && ctx.eventId) {
      try {
        const event = await fetchJson(eventUrl(ctx.sourceSubdomain, ctx.eventId));
        const matchedTeam = (event.teams || []).find(team => team.id === ctx.matchedTeamId) || (event.teams || []).find(team => normalizeName(team.name) === normalizeName(ctx.matchedTeamName));
        if (!matchedTeam) continue;
        const selection = selectGamesForEvent(event, matchedTeam);
        if (!selection?.rows?.length) continue;
        return { item: { id: event.id }, event, match: { team: { id: matchedTeam.id, name: matchedTeam.name }, curler: { name: ctx.matchedCurler || matchedTeam.name }, score: 100 }, identityScore: Number(ctx.identityScore || 100), selection, subdomain: ctx.sourceSubdomain, source: 'curlingio', scoreRank: selection.active ? 0 : selection.next ? 1 : selection.lastCompleted ? 2 : 3 };
      } catch {}
    }
  }

  const needCurlingZone = contexts.some(ctx => (ctx.source || '') === 'curlingzone');
  if (needCurlingZone) {
    const cz = await discoverCurlingZoneEvents(playerName);
    return cz.candidates.find(c => (c.identityScore || 0) >= 88) || null;
  }
  return null;
}

function normalizeCurlingZoneResponse(payload, playerName) {
  const playerNorm = normalizeName(playerName);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const byCandidate = new Map();
  for (const row of rows) {
    const matchedCurler = row.matchedCurler || row.teamSkip || row.matchedTeam || row.teamName || '';
    const matchScore = Number(row.matchScore || computeNameMatchScore(matchedCurler, playerNorm) || computeNameMatchScore(row.matchedTeam || row.teamName || '', playerNorm));
    if (!matchScore) continue;
    const eventId = row.eventId || row.eventName || 'curlingzone';
    const matchedTeam = row.matchedTeam || row.teamName || matchedCurler || 'Unknown Team';
    const key = `${eventId}|${normalizeName(matchedTeam)}`;
    if (!byCandidate.has(key)) byCandidate.set(key, {
      item: { id: `cz:${eventId}` },
      event: { id: `cz:${eventId}`, name: row.eventName || 'CurlingZone Event', number_of_ends: 8, teams: [], starts_on: row.startDate || null, ends_on: row.endDate || null },
      match: { team: { id: `cz-team:${normalizeName(matchedTeam)}`, name: matchedTeam }, curler: { name: matchedCurler }, score: matchScore },
      selectionRows: [],
      subdomain: 'curlingzone',
      source: 'curlingzone',
      eventStartMs: parseEventDateToMs(row.startDate || row.startsAt || row.epochMs)
    });
    byCandidate.get(key).selectionRows.push({ ...row, eventId: `cz:${eventId}`, matchedTeam, matchedCurler, matchScore });
    if (matchScore > byCandidate.get(key).match.score) {
      byCandidate.get(key).match = { team: { id: `cz-team:${normalizeName(matchedTeam)}`, name: matchedTeam }, curler: { name: matchedCurler }, score: matchScore };
    }
  }

  const candidates = [];
  for (const candidate of byCandidate.values()) {
    const selection = buildCurlingZoneSelection(candidate.selectionRows, candidate.match.team.name);
    const firstRow = candidate.selectionRows[0] || {};
    mergeSeasonEventHistory(playerName, {
      eventKey: eventKey(candidate.event.name, firstRow.startDate || firstRow.startsAt || '', 'curlingzone'),
      eventName: candidate.event.name,
      teamKey: teamKey(candidate.match.team.name),
      teamName: candidate.match.team.name,
      source: 'curlingzone',
      startDate: firstRow.startDate || firstRow.startsAt || null,
      endDate: firstRow.endDate || firstRow.startsAt || null,
      finish: firstRow.finish || 'Result not fully determined'
    });
    saveSeasonAffiliation(playerName, candidate.match.team.name, 'curlingzone', candidate.match.score, [firstRow.teamName, firstRow.matchedTeam], { eventKey: eventKey(candidate.event.name, firstRow.startDate || firstRow.startsAt || '', 'curlingzone') });
    candidates.push({ item: candidate.item, event: candidate.event, match: candidate.match, selection, subdomain: candidate.subdomain, source: candidate.source, eventStartMs: candidate.eventStartMs, scoreRank: selection.active ? 0 : selection.next ? 1 : selection.lastCompleted ? 2 : 3 });
  }
  return candidates;
}

async function discoverCurlingZoneEvents(playerName) {
  if (!APP.curlingZone?.enabled || !APP.curlingZone?.adapterUrl) return { checked: [], candidates: [] };
  const url = `${APP.curlingZone.adapterUrl}?player=${encodeURIComponent(playerName)}`;
  try {
    const payload = await fetchJsonWithTimeout(url, { timeoutMs: APP.curlingZone.timeoutMs });
    const candidates = normalizeCurlingZoneResponse(payload, playerName).filter(c => isEventTodayForward(c.event) || c.selection?.active || c.selection?.next);
    return { checked: [{ source: 'curlingzone', itemsCount: Array.isArray(payload?.rows) ? payload.rows.length : 0, url, ok: true }], candidates };
  } catch (error) {
    return { checked: [{ source: 'curlingzone', itemsCount: 0, url, ok: false, error: error.message }], candidates: [] };
  }
}

async function discoverCurlingIoEvents(playerName, { collectHistory = true } = {}) {
  const playerNorm = normalizeName(playerName);
  const checked = [];
  const candidates = [];
  for (const subdomain of APP.clubSubdomains) {
    for (const delta of APP.lookaheadSeasons) {
      const listUrl = competitionsUrl(subdomain, delta);
      try {
        const payload = await fetchJson(listUrl);
        const items = payload.items || [];
        checked.push({ source: 'curlingio', subdomain, delta, itemsCount: items.length, url: listUrl });
        for (const item of items) {
          try {
            const event = await fetchJson(eventUrl(subdomain, item.id));
            const match = findMatchingTeam(event, playerNorm);
            if (!match) continue;
            const selection = selectGamesForEvent(event, match.team);
            const evKey = eventKey(event.name, event.starts_on || item.starts_on || '', 'curlingio');
            if (collectHistory) {
              mergeSeasonEventHistory(playerName, {
                eventKey: evKey,
                eventName: event.name,
                teamKey: teamKey(match.team.name),
                teamName: match.team.name,
                source: 'curlingio',
                startDate: event.starts_on || item.starts_on || null,
                endDate: event.ends_on || item.ends_on || null,
                finish: inferFinishLabel(event, match.team.id, selection)
              });
              saveSeasonAffiliation(playerName, match.team.name, 'curlingio', Math.max(match.score, computeIdentityMatchScore(playerName, match.curler.name)), teamAliases(match.team), { eventKey: evKey });
            }
            if (!isEventTodayForward(event)) continue;
            candidates.push({ item, event, match, selection, subdomain, source: 'curlingio', eventStartMs: parseEventDateToMs(event.starts_on || item.starts_on), scoreRank: selection.active ? 0 : selection.next ? 1 : selection.lastCompleted ? 2 : 3 });
          } catch {}
        }
      } catch (error) {
        checked.push({ source: 'curlingio', subdomain, delta, itemsCount: 0, url: listUrl, skipped: true, error: error.message });
      }
    }
  }
  return { checked, candidates };
}

async function discoverPlayerEvents(playerName) {
  const [cio, cz] = await Promise.all([discoverCurlingIoEvents(playerName), discoverCurlingZoneEvents(playerName)]);
  const checked = [...cio.checked, ...cz.checked];
  const pool = clusterAndPrioritizeCandidates(playerName, [...cio.candidates, ...cz.candidates]);
  return { checked, candidates: pool };
}

function buildSnapshotFromCandidate(playerName, candidate, diagnostics) {
  const { event, match, selection } = candidate;
  const matchedTeam = match.team;
  const nextGame = selection.next || null;
  const lastCompleted = selection.lastCompleted;
  const active = selection.active;
  const displayGame = active || lastCompleted || nextGame || selection.rows[0] || null;
  let hammerNext='—', hammerSubtitle='Hammer unknown', ends={ rows: [], total: null }, teamScore=0, opponentScore=0, opponentName='TBD', currentEndLabel='Waiting', view='idle-event';

  if (displayGame) {
    const positions = getGamePositions(displayGame.game);
    const ourPos = positions.find(pos => getTeamIdFromPosition(pos) === matchedTeam.id) || positions[0] || {};
    const oppPos = positions.find(pos => { const tid = getTeamIdFromPosition(pos); return tid && tid !== matchedTeam.id; }) || positions[1] || {};
    const oppTeam = teamMap(event).get(getTeamIdFromPosition(oppPos)) || displayGame.oppTeam || { name:'TBD', id:null };
    const firstHammerPos = positions.find(pos => pos.first_hammer || pos.firstHammer);
    const firstHammerName = getTeamIdFromPosition(firstHammerPos) === matchedTeam.id ? matchedTeam.name : getTeamIdFromPosition(firstHammerPos) === oppTeam.id ? oppTeam.name : 'Unknown';
    hammerNext = deriveHammer(matchedTeam.name, oppTeam.name, getEndScores(ourPos), getEndScores(oppPos), firstHammerName);
    hammerSubtitle = `${shortenTeamName(hammerNext, { keepCC: true })} has hammer`;
    ends = buildEnds(ourPos, oppPos, event.number_of_ends || 8, displayGame.lifecycle);
    teamScore = getPositionScore(ourPos);
    opponentScore = getPositionScore(oppPos);
    opponentName = oppTeam.name;
    const currentEnd = Math.max(getEndScores(ourPos).length, getEndScores(oppPos).length) + 1;
    currentEndLabel = active ? `${currentEnd}${ordinalSuffix(currentEnd)} end` : (displayGame.startsAt || 'Scheduled draw');
  }

  const nextGameLabel = nextGame ? `${nextGame.startsAt || formatEpochMs(nextGame.epochMs)}` : 'No next game available';
  const nextCheck = computeCheckDelay(selection, state.snapshot);
  if (active) view = 'live';
  else if (nextGame) view = 'upcoming';
  else if (lastCompleted) view = 'idle-event';

  const linkedScheduleRows = selection.linkedRows.map(r => {
    let stateLabel;
    if (r.lifecycle === 'playing') stateLabel = 'Now playing';
    else if (r.lifecycle === 'pending-window') stateLabel = 'Starting soon';
    else if (r.lifecycle === 'pending') stateLabel = 'Scheduled';
    else if (r.lifecycle === 'just-finished' || r.lifecycle === 'complete') {
      const ourScore = getPositionScore(r.ourPos);
      const oppScore = getPositionScore(r.oppPos);
      stateLabel = ourScore > oppScore ? `Complete · won ${ourScore} - ${oppScore}` : ourScore < oppScore ? `Complete · lost ${ourScore} - ${oppScore}` : `Complete · ${ourScore} - ${oppScore}`;
    } else stateLabel = 'Unknown';
    return { gameId: r.gameId, gameName: r.gameName || r.game?.name || null, eventName: event.name, startsAt: r.startsAt, epochMs: r.epochMs, stateLabel, team: matchedTeam.name, opponent: r.oppTeam?.name || 'TBD', source: candidate.source || 'curlingio', game: r.game };
  });

  return {
    playerName,
    displayPlayer: match.curler.name,
    view,
    teamName: matchedTeam.name,
    opponentName,
    teamScore,
    opponentScore,
    gameTitle: resolveGameTitle(displayGame),
    currentEndLabel,
    drawTitle: active ? (active.drawLabel || active.startsAt || 'Live') : '',
    hammerNext,
    hammerSubtitle,
    eventName: event.name,
    source: candidate.source || 'curlingio',
    ends,
    scheduleRows: linkedScheduleRows,
    activeGameId: active?.gameId || null,
    nextGameId: nextGame?.gameId || null,
    nextGameLabel,
    timelineHint: active ? 'Updates resume 7 minutes after a posted score change, then every 2 minutes.' : lastCompleted ? 'Latest posted end scores.' : 'Waiting for the 5-minute pre-game window.',
    scheduleHint: candidate.source === 'curlingzone' ? 'CurlingZone supplement in use. Curling I/O overrides equivalent events.' : 'Showing team-specific games for the matched team.',
    nextCheckAt: Date.now() + nextCheck.delayMs,
    lastUpdatedLabel: formatClock(Date.now()),
    diagnostics,
    eventId: event.id,
    nextCheckReason: nextCheck.reason,
    nextGameConfirmed: !!selection.next,
    progressSignature: active ? getProgressSignature(active) : '',
    seasonRoster: getSeasonRosterProfile(playerName),
    seasonHistory: getSeasonHistoryProfile(playerName)
  };
}

async function runTracker({ reason }) {
  if (!state.playerName) return;
  state.lastRunAt = Date.now();
  setStatus(`Checking for ${state.playerName}…`);
  try {
    pruneSeasonStores();
    const trackingHint = loadTrackingHint() || loadEventCache(state.playerName);
    const hintedCandidate = await discoverPlayerEventFromHint(state.playerName, trackingHint).catch(() => null);
    if (hintedCandidate) {
      const snapshot = buildSnapshotFromCandidate(state.playerName, hintedCandidate, buildDiagnostics({
        phase: 'matched-from-memory',
        mode: hintedCandidate.selection?.active ? 'focused-live' : hintedCandidate.selection?.next ? 'focused-upcoming' : 'focused-memory',
        reason,
        playerName: state.playerName,
        matchedCurler: hintedCandidate.match.curler.name,
        matchedTeam: hintedCandidate.match.team.name,
        sourceType: hintedCandidate.source || 'curlingio',
        sourceSubdomain: hintedCandidate.subdomain,
        matchScore: hintedCandidate.match.score,
        identityScore: hintedCandidate.identityScore || hintedCandidate.match.score,
        eventId: hintedCandidate.event.id,
        eventName: hintedCandidate.event.name,
        reusedTrackingHint: true,
        nextCheckReason: computeCheckDelay(hintedCandidate.selection, state.snapshot).reason
      }));
      render(snapshot);
      if (snapshot.view === 'live') setStatus(`${hintedCandidate.match.curler.name} is live in ${hintedCandidate.event.name}. Focused updates are active.`);
      else if (snapshot.nextGameId) setStatus(`Reused remembered match for ${hintedCandidate.match.curler.name} in ${hintedCandidate.event.name}. The app will wait until 5 minutes before the next game.`);
      else setStatus(`Reused remembered match for ${hintedCandidate.match.curler.name} in ${hintedCandidate.event.name}. No live draw right now.`);
      scheduleNextRun(Math.max(5000, snapshot.nextCheckAt - Date.now()));
      return;
    }

    const discovery = await discoverPlayerEvents(state.playerName);
    if (!discovery.candidates.length) {
      clearTrackingHint();
      const diagnostics = buildDiagnostics({ phase: 'no-match', reason, playerName: state.playerName, checked: discovery.checked, policy: 'Idle scans every 72 hours until a matching current event appears.' });
      render(computeIdleSnapshot(state.playerName, diagnostics, APP.idleScanMs));
      setStatus(`No current event from today forward found for ${state.playerName}. Season history remains cached. Next scan in about 72 hours.`);
      scheduleNextRun(APP.idleScanMs);
      return;
    }

    const chosen = discovery.candidates[0];
    const hint = buildTrackingHint(state.playerName, chosen, discovery.candidates);
    if (hint) saveTrackingHint(hint);
    saveEventCache(state.playerName, chosen);

    const diagnostics = buildDiagnostics({
      phase: 'matched',
      mode: chosen.selection?.active ? 'live-discovery' : chosen.selection?.next ? 'upcoming-discovery' : 'event-watch',
      reason,
      playerName: state.playerName,
      matchedCurler: chosen.match.curler.name,
      matchedTeam: chosen.match.team.name,
      sourceType: chosen.source || 'curlingio',
      sourceSubdomain: chosen.subdomain,
      matchScore: chosen.match.score,
      identityScore: chosen.identityScore || chosen.match.score,
      rosterBoost: chosen.rosterBoost || 0,
      historyBoost: chosen.historyBoost || 0,
      conflictPenalty: chosen.conflictPenalty || 0,
      weightedScore: chosen.weightedScore || chosen.identityScore || chosen.match.score,
      eventId: chosen.event.id,
      eventName: chosen.event.name,
      nextCheckReason: computeCheckDelay(chosen.selection, state.snapshot).reason,
      checked: discovery.checked,
      candidates: discovery.candidates.slice(0, 8).map(c => ({ eventId: c.event.id, eventName: c.event.name, sourceType: c.source || 'curlingio', matchedCurler: c.match.curler.name, matchedTeam: c.match.team.name, matchScore: c.match.score, identityScore: c.identityScore || c.match.score, rosterBoost: c.rosterBoost || 0, historyBoost: c.historyBoost || 0, conflictPenalty: c.conflictPenalty || 0, weightedScore: c.weightedScore || c.identityScore || c.match.score }))
    });

    const snapshot = buildSnapshotFromCandidate(state.playerName, chosen, diagnostics);
    render(snapshot);
    const exactMatch = normalizeName(chosen.match.curler.name) === normalizeName(state.playerName);
    const prefix = exactMatch ? '' : `Unable to match ${state.playerName} exactly. `;
    if (snapshot.view === 'live') setStatus(`${prefix}${chosen.match.curler.name} is live in ${chosen.event.name}. Focused updates are active.`);
    else if (snapshot.nextGameId) setStatus(`${prefix}Matched ${chosen.match.curler.name} in ${chosen.event.name}. Monitoring starts 5 minutes before the next game.`);
    else setStatus(`${prefix}Matched ${chosen.match.curler.name} in ${chosen.event.name}. No live draw right now.`);
    scheduleNextRun(Math.max(5000, snapshot.nextCheckAt - Date.now()));
  } catch (error) {
    const diagnostics = buildDiagnostics({ phase: 'error', reason, playerName: state.playerName, error: error.message });
    const snapshot = computeIdleSnapshot(state.playerName, diagnostics, APP.errorRetryMs);
    snapshot.eventName = 'Temporary error';
    snapshot.scheduleHint = 'Retrying in 30 minutes.';
    render(snapshot);
    setStatus(`Could not refresh right now. Retrying in 30 minutes. ${error.message}`);
    scheduleNextRun(APP.errorRetryMs);
  }
}

function startTracking(playerName, reason = 'manual-start') {
  const nextPlayer = playerName.trim();
  if (!nextPlayer) return;
  if (normalizeName(nextPlayer) !== normalizeName(state.playerName)) clearTrackingHint();
  state.playerName = nextPlayer;
  savePlayer(state.playerName);
  updateUrlPlayer(state.playerName);
  els.playerInput.value = state.playerName;
  runTracker({ reason });
}

function maybeRunOpenScan(trigger) {
  if (!state.playerName) return;
  const now = Date.now();
  const recentlyRan = now - state.lastRunAt < APP.openRescanFloorMs;
  if (trigger === 'visible') {
    const recentlyVisibilityScanned = now - state.lastVisibilityScanAt < APP.visibleRescanFloorMs;
    if (recentlyRan || recentlyVisibilityScanned) return;
    state.lastVisibilityScanAt = now;
  } else if (recentlyRan) return;
  runTracker({ reason: trigger === 'visible' ? 'app-visible-full-scan' : 'app-open-full-scan' });
}

function bootFromSavedState() {
  const fromUrl = parsePlayerFromUrl();
  const fromStorage = localStorage.getItem(APP.localKeys.player) || '';
  const player = fromUrl || fromStorage;
  const snapshot = loadSnapshot();
  if (snapshot) render(snapshot);
  if (player) startTracking(player, 'boot-full-scan');
}

els.form.addEventListener('submit', event => {
  event.preventDefault();
  const value = els.playerInput.value.trim();
  if (!value) return;
  startTracking(value, 'manual-start');
});
els.shareBtn.addEventListener('click', async () => {
  const player = state.playerName || els.playerInput.value.trim();
  const url = new URL(window.location.href);
  if (player) url.searchParams.set('player', player);
  const text = url.toString();
  try { await navigator.clipboard.writeText(text); setStatus('Share link copied.'); }
  catch { setStatus('Could not copy automatically. You can copy the address from your browser.'); }
});
els.refreshBtn.addEventListener('click', () => {
  if (state.playerName) runTracker({ reason: 'manual-refresh' });
});
els.diagnosticsToggle.addEventListener('click', () => {
  els.diagnosticsPanel.classList.toggle('hidden');
});
window.addEventListener('focus', () => maybeRunOpenScan('open'));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) maybeRunOpenScan('visible');
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.deferredPrompt = event;
  els.installBtn.classList.remove('hidden');
});
els.installBtn.addEventListener('click', async () => {
  if (!state.deferredPrompt) return;
  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice.catch(() => null);
  state.deferredPrompt = null;
  els.installBtn.classList.add('hidden');
});
window.addEventListener('appinstalled', () => {
  state.deferredPrompt = null;
  els.installBtn.classList.add('hidden');
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => null));
}

bootFromSavedState();
