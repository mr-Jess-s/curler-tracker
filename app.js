
const APP_VERSION = 'v25.3';
const APP = {
  clubSubdomains: ['ab','canada','bc','mb','nb','nl','ns','nt','nu','on','pe','qc','sk','yt'],
  language: 'en',
  lookaheadSeasons: [0],
  idleScanMs: 72 * 60 * 60 * 1000,
  preGameWindowMs: 45 * 60 * 1000,
  postGameWindowMs: 3 * 60 * 60 * 1000,
  activePostEndPauseMs: 10 * 60 * 1000,
  activeBetweenChecksMs: 2 * 60 * 1000,
  upcomingRefreshMs: 5 * 60 * 1000,
  errorRetryMs: 30 * 60 * 1000,
  openRescanFloorMs: 15 * 1000,
  visibleRescanFloorMs: 60 * 1000,
  listCacheMs: 3 * 60 * 1000,
  eventCacheMs: 60 * 1000,
  discoveryFastPathMs: 15 * 60 * 1000,
  maxParallelSubdomains: 3,
  maxParallelEventsPerList: 3,
  localKeys: {
    player: 'curler-tracker-player-v253',
    snapshot: 'curler-tracker-snapshot-v253',
    cachePrefix: 'curler-tracker-cache-v253:',
    discoveryPrefix: 'curler-tracker-discovery-v253:'
  }
};

const els = {
  form: document.getElementById('playerForm'),
  playerInput: document.getElementById('playerInput'),
  shareBtn: document.getElementById('shareBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
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

const memoryCache = new Map();

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
  return String(row?.gameName || row?.game?.name || '').trim();
}
function ordinalSuffix(n) {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

function formatEpochMs(epochMs) {
  if (!epochMs) return '-';
  return new Intl.DateTimeFormat(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(epochMs));
}

function formatClock(value) {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? String(value || '-') : new Intl.DateTimeFormat(undefined, { hour:'numeric', minute:'2-digit' }).format(d);
}

function setStatus(text) { els.statusLine.textContent = text; }
function savePlayer(player) { localStorage.setItem(APP.localKeys.player, player); }
function saveSnapshot(snapshot) { localStorage.setItem(APP.localKeys.snapshot, JSON.stringify(snapshot)); }
function loadSnapshot() { try { const raw = localStorage.getItem(APP.localKeys.snapshot); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function parsePlayerFromUrl() { return new URLSearchParams(window.location.search).get('player')?.trim() || ''; }
function updateUrlPlayer(player) {
  const url = new URL(window.location.href);
  if (player) url.searchParams.set('player', player); else url.searchParams.delete('player');
  history.replaceState({}, '', url.toString());
}
function setDiagnostics(obj) {
  state.diagnostics = obj;
}
function buildDiagnostics(base) { return { appVersion: APP_VERSION, timestamp: new Date().toISOString(), ...base }; }

function cacheKey(kind, key) {
  return `${APP.localKeys.cachePrefix}${kind}:${key}`;
}

function readTimedCache(kind, key, ttlMs) {
  if (!ttlMs) return null;
  const fullKey = cacheKey(kind, key);
  const mem = memoryCache.get(fullKey);
  if (mem && (Date.now() - mem.savedAt) <= ttlMs) return mem.value;
  try {
    const raw = localStorage.getItem(fullKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (Date.now() - parsed.savedAt) > ttlMs) {
      localStorage.removeItem(fullKey);
      return null;
    }
    memoryCache.set(fullKey, parsed);
    return parsed.value;
  } catch {
    return null;
  }
}

function writeTimedCache(kind, key, value) {
  const record = { savedAt: Date.now(), value };
  const fullKey = cacheKey(kind, key);
  memoryCache.set(fullKey, record);
  try {
    localStorage.setItem(fullKey, JSON.stringify(record));
  } catch {}
}

async function fetchJson(url, { ttlMs = 0, cacheGroup = 'json' } = {}) {
  const cached = ttlMs ? readTimedCache(cacheGroup, url, ttlMs) : null;
  if (cached) return cached;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const payload = await res.json();
  if (ttlMs) writeTimedCache(cacheGroup, url, payload);
  return payload;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => runWorker());
  await Promise.all(workers);
  return results;
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

function findMatchingTeam(event, playerNameNorm) {
  const wantedParts = playerNameNorm.split(' ').filter(Boolean);
  const wantedFirst = wantedParts[0] || '';
  const wantedLast = wantedParts[wantedParts.length - 1] || '';
  let best = null;

  for (const team of (event.teams || [])) {
    for (const curler of (team.lineup || [])) {
      const norm = normalizeName(curler.name);
      if (!norm) continue;

      const parts = norm.split(' ').filter(Boolean);
      const first = parts[0] || '';
      const last = parts[parts.length - 1] || '';
      const overlap = wantedParts.filter(part => parts.includes(part));
      const fullJoined = parts.join(' ');

      let score = 0;

      if (norm === playerNameNorm) {
        score = 100;
      } else if (wantedLast && last === wantedLast) {
        if (overlap.length >= 2) {
          score = 90;
        } else if (fullJoined.includes(playerNameNorm) || playerNameNorm.includes(fullJoined)) {
          score = 80;
        } else if (wantedFirst && first === wantedFirst) {
          score = 70;
        } else {
          score = 0;
        }
      } else if (overlap.length >= 2) {
        score = 40;
      } else {
        score = 0;
      }

      if (score > (best?.score || 0)) best = { team, curler, score };
    }
  }

  return best && best.score >= 55 ? best : null;
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
  const now = Date.now();
  const state = String(game?.state || '').toLowerCase();
  if (['playing','live','active','started','in_progress','in progress'].includes(state)) return 'playing';
  if (['pending','scheduled','upcoming','assigned'].includes(state)) {
    if (drawEpochMs && now >= drawEpochMs - APP.preGameWindowMs && now <= drawEpochMs + APP.postGameWindowMs) return 'pending-window';
    return 'pending';
  }
  if (['complete','completed','final','finished'].includes(state)) {
    if (drawEpochMs && now <= drawEpochMs + APP.postGameWindowMs) return 'just-finished';
    return 'complete';
  }
  const positions = getGamePositions(game);
  const total = positions.reduce((acc,pos)=>acc+getPositionScore(pos),0);
  const anyEnds = positions.some(pos => getEndScores(pos).some(v => Number(v||0) > 0));
  if ((anyEnds || total > 0) && drawEpochMs && now <= drawEpochMs + APP.postGameWindowMs) return 'playing';
  if (drawEpochMs && drawEpochMs > now) return 'pending';
  return state || 'unknown';
}

function buildDrawFirstRows(event, matchedTeam) {
  const matchedTeamId = matchedTeam.id;
  const teamsById = teamMap(event);
  const gamesById = buildGameMap(event);
  const aliases = teamAliases(matchedTeam);
  const rows = [];
  const unmatchedDrawRows = [];

  for (const draw of (event.draws || [])) {
    const epochMs = draw?.epoch ? draw.epoch * 1000 : null;
    for (const gid of drawGameIds(draw)) {
      const game = gamesById.get(gid);
      if (!game) {
        unmatchedDrawRows.push({ drawLabel: draw?.label || null, gameId: gid });
        continue;
      }
      const positions = getGamePositions(game);
      const ourPos = positions.find(pos => getTeamIdFromPosition(pos) === matchedTeamId) || null;
      const oppPos = positions.find(pos => {
        const tid = getTeamIdFromPosition(pos);
        return tid && tid !== matchedTeamId;
      }) || null;
      const oppTeam = oppPos?.team_id ? teamsById.get(getTeamIdFromPosition(oppPos)) : null;
      const aliasMatch = !ourPos && gameMatchesTeamByAlias(game, matchedTeam);
      const linked = !!ourPos || aliasMatch;
      const openSlots = Math.max(0, 2 - positions.filter(pos => !!getTeamIdFromPosition(pos)).length);
      const lifecycle = inferLifecycle(game, epochMs);
      rows.push({
        draw,
        game,
        gameId: gid,
        drawLabel: draw?.label ? `${String(draw.label).startsWith('B') ? '' : 'B'}${draw.label}` : (game.stageName || 'Draw'),
        startsAt: draw?.starts_at || draw?.startsAt || (epochMs ? formatEpochMs(epochMs) : 'TBD'),
        epochMs,
        lifecycle,
        linked,
        aliasMatch,
        openSlots,
        ourPos,
        oppPos,
        oppTeam,
        gameName: game?.name || '',
        stateLabel: lifecycle === 'playing' ? 'Live' :
          lifecycle === 'pending-window' ? 'Starting soon' :
          lifecycle === 'pending' ? 'Scheduled' :
          lifecycle === 'just-finished' ? 'Final' :
          lifecycle === 'complete' ? 'Complete' : 'Unknown'
      });
    }
  }

  rows.sort((a,b) => (a.epochMs ?? Number.MAX_SAFE_INTEGER) - (b.epochMs ?? Number.MAX_SAFE_INTEGER) || String(a.gameId).localeCompare(String(b.gameId)));
  return { rows, aliases, unmatchedDrawRows, totalStageGames: gamesById.size };
}

function selectGamesForEvent(event, matchedTeam) {
  const { rows, aliases, unmatchedDrawRows, totalStageGames } = buildDrawFirstRows(event, matchedTeam);
  const now = Date.now();
  const linkedRows = rows.filter(r => r.linked);
  const active = linkedRows.find(r => r.lifecycle === 'playing') || null;
  const nextConfirmed = linkedRows
    .filter(r => ['pending-window','pending'].includes(r.lifecycle))
    .sort((a,b) => (a.epochMs ?? Number.MAX_SAFE_INTEGER) - (b.epochMs ?? Number.MAX_SAFE_INTEGER))[0] || null;
  const completed = linkedRows
    .filter(r => ['just-finished','complete'].includes(r.lifecycle))
    .sort((a,b) => (b.epochMs || 0) - (a.epochMs || 0))[0] || null;
  let inferredNext = null;
  if (!nextConfirmed && completed && String(getPositionResult(completed.ourPos) || '').toLowerCase() === 'won') {
    inferredNext = rows
      .filter(r => r !== completed && ['pending-window','pending'].includes(r.lifecycle) && (r.epochMs || 0) >= (completed.epochMs || 0))
      .sort((a,b) => (a.epochMs ?? Number.MAX_SAFE_INTEGER) - (b.epochMs ?? Number.MAX_SAFE_INTEGER))[0] || null;
  }

  const stateCounts = {};
  for (const r of rows) stateCounts[r.lifecycle] = (stateCounts[r.lifecycle] || 0) + 1;

  return {
    rows,
    linkedRows,
    active,
    next: nextConfirmed,
    inferredNext,
    lastCompleted: completed,
    diagnostics: {
      totalStageGames,
      totalDrawGameRefs: rows.length,
      linkedGames: linkedRows.length,
      assignedGames: linkedRows.filter(r => !!r.ourPos).length,
      aliasMatchedGames: linkedRows.filter(r => r.aliasMatch).length,
      futureAssignedGames: linkedRows.filter(r => !!r.ourPos && ['pending-window','pending'].includes(r.lifecycle)).length,
      futureOpenSlotGames: rows.filter(r => ['pending-window','pending'].includes(r.lifecycle) && r.openSlots > 0).length,
      stateCounts,
      matchedTeamAliases: aliases.slice(0, 12),
      inferredLinkedGames: linkedRows.filter(r => r.aliasMatch).map(r => r.gameId).slice(0, 10),
      unmatchedDrawRows: unmatchedDrawRows.slice(0, 10),
      usedInference: !nextConfirmed && !!inferredNext
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
  return {
    rows,
    total: {
      team: String(getPositionScore(ourPos)),
      opponent: String(getPositionScore(oppPos))
    }
  };
}
function deriveHammer(teamAName, teamBName, endScoresA, endScoresB, firstHammerTeamName) {
  let hammer = firstHammerTeamName || 'Unknown';
  const maxEnds = Math.max(endScoresA.length, endScoresB.length);
  for (let i=0;i<maxEnds;i++) {
    const a = Number(endScoresA[i] ?? 0), b = Number(endScoresB[i] ?? 0);
    if (a > 0 && b === 0) hammer = teamBName;
    else if (b > 0 && a === 0) hammer = teamAName;
  }
  return hammer;
}

function getProgressSignature(row) {
  if (!row) return '';
  const our = getEndScores(row.ourPos);
  const opp = getEndScores(row.oppPos);
  return JSON.stringify({
    gameId: row.gameId,
    our,
    opp,
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
      ? { delayMs: APP.activeBetweenChecksMs, reason: 'awaiting next end score after active check' }
      : { delayMs: APP.activePostEndPauseMs, reason: 'post-end pause before active polling' };
  }
  const nextConfirmed = selection.next;
  if (nextConfirmed) {
    const preWindowAt = (nextConfirmed.epochMs || now) - APP.preGameWindowMs;
    if (preWindowAt > now) return { delayMs: preWindowAt - now, reason: 'sleep until next game pre-game window' };
    return { delayMs: APP.upcomingRefreshMs, reason: 'next game pre-game monitoring' };
  }
  const nextRow = selection.rows.find(r => r.linked && r.epochMs && r.epochMs > now);
  if (nextRow) {
    const preWindowAt = nextRow.epochMs - APP.preGameWindowMs;
    if (preWindowAt > now) return { delayMs: preWindowAt - now, reason: 'sleep until next game pre-game window' };
    return { delayMs: APP.upcomingRefreshMs, reason: 'next game pre-game monitoring' };
  }
  return { delayMs: APP.idleScanMs, reason: 'event complete, resume periodic scans' };
}

function renderHeadline(snapshot) {
  if (!snapshot) {
    els.headlineBlock.innerHTML = '<p class="headline-empty">Enter a curler\'s name to begin.</p>';
    return;
  }
  if (snapshot.view === 'live') {
    const titlePrefix = snapshot.gameTitle ? `${escapeHtml(snapshot.gameTitle)} - ` : '';
    els.headlineBlock.innerHTML = `<div><div class="headline-main">${escapeHtml(formatScoreTitle(snapshot.teamName, snapshot.teamScore, snapshot.opponentName, snapshot.opponentScore))}</div><div class="headline-sub">${titlePrefix}Now playing ${escapeHtml(snapshot.currentEndLabel)} - ${escapeHtml(snapshot.hammerSubtitle || 'Hammer unknown')}</div></div>`;
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
  els.headlineBlock.innerHTML = `<div><div class="headline-main">No current event found</div><div class="headline-sub">Checking supported Curling I/O competitions again later.</div></div>`;
}

function renderEnds(teamName, opponentName, endsData) {
  const rowsIn = endsData?.rows || [];
  const total = endsData?.total || null;
  if (!rowsIn.length) {
    els.endsList.className = 'ends-list empty';
    els.endsList.innerHTML = '<p>No end scores yet.</p>';
    return;
  }
  const teamShort = escapeHtml(shortenTeamName(teamName));
  const oppShort = escapeHtml(shortenTeamName(opponentName));
  els.endsList.className = 'ends-list ends-table';
  const header = `<div class="ends-grid ends-header"><span></span><span>${teamShort}</span><span>${oppShort}</span></div>`;
  const rows = rowsIn.map(row => `<div class="ends-grid end-row"><span class="end-label">End ${row.end}</span><span class="end-score-cell">${escapeHtml(row.team)}</span><span class="end-score-cell">${escapeHtml(row.opponent)}</span></div>`).join('');
  const totalRow = total ? `<div class="ends-grid end-row total-row"><span class="end-label">Total</span><span class="end-score-cell">${escapeHtml(total.team)}</span><span class="end-score-cell">${escapeHtml(total.opponent)}</span></div>` : '';
  els.endsList.innerHTML = header + rows + totalRow;
}

function formatScheduleTime(row) {
  return row?.startsAt || (row?.epochMs ? formatEpochMs(row.epochMs) : 'TBD');
}

function renderSchedule(scheduleRows, activeGameId, nextGameId) {
  if (!scheduleRows?.length) {
    els.scheduleList.className = 'schedule-list empty';
    els.scheduleList.innerHTML = '<p>No scheduled draws to show.</p>';
    return;
  }
  els.scheduleList.className = 'schedule-list';
  els.scheduleList.innerHTML = scheduleRows.map(row => {
    const cls = row.gameId === activeGameId ? 'schedule-row active' : row.gameId === nextGameId ? 'schedule-row upcoming' : 'schedule-row';
    const matchup = `${shortenTeamName(row.team)} vs ${shortenTeamName(row.opponent)}`;
    const title = row.branchLabel ? row.branchLabel : matchup;
    const subtitle = row.branchLabel ? matchup : row.stateLabel;
    return `<div class="${cls}"><div><div class="schedule-label">${escapeHtml(title)}</div><div class="schedule-meta schedule-meta-left">${escapeHtml(subtitle)}</div></div><div class="schedule-meta">${escapeHtml(formatScheduleTime(row))}</div></div>`;
  }).join('');
}
function updateBadge(view) {
  els.liveBadge.className = 'badge';
  if (view === 'live') { els.liveBadge.classList.add('live'); els.liveBadge.textContent = 'Live'; }
  else if (view === 'upcoming') { els.liveBadge.classList.add('upcoming'); els.liveBadge.textContent = 'Upcoming'; }
  else if (view === 'complete') { els.liveBadge.classList.add('complete'); els.liveBadge.textContent = 'Complete'; }
  else { els.liveBadge.classList.add('muted'); els.liveBadge.textContent = view === 'idle-event' ? 'Watching' : 'Idle'; }
}

function render(snapshot) {
  state.snapshot = snapshot;
  saveSnapshot(snapshot);
  els.trackedPlayer.textContent = snapshot?.displayPlayer || snapshot?.playerName || '-';
  renderHeadline(snapshot);
  updateBadge(snapshot?.view || 'idle');
  els.eventValue.textContent = snapshot?.eventName || '-';
  els.nextCheckValue.textContent = snapshot?.nextCheckAt ? formatEpochMs(snapshot.nextCheckAt) : '-';
  els.updatedValue.textContent = snapshot?.lastUpdatedLabel || '-';
  els.timelineHint.textContent = snapshot?.timelineHint || 'Waiting for a live game.';
  els.scheduleHint.textContent = snapshot?.scheduleHint || 'No event loaded.';
  renderEnds(snapshot?.teamName || 'Team', snapshot?.opponentName || 'Opponent', snapshot?.ends || []);
  renderSchedule(snapshot?.scheduleRows || [], snapshot?.activeGameId, snapshot?.nextGameId);
  setDiagnostics(snapshot?.diagnostics || { appVersion: APP_VERSION, phase:'idle' });
}

function scheduleNextRun(delayMs) {
  if (state.timerId) clearTimeout(state.timerId);
  state.timerId = window.setTimeout(() => runTracker({ reason:'scheduled' }), Math.max(5000, delayMs));
}

const BRANCH_OVERRIDES = {
  '24013:59caf1a7': { win: 'b253bd29', loss: 'bd4a80b5' }
};

function getOutcomeBranchRows(event, matchedTeam, selection) {
  const source = selection.active || selection.lastCompleted;
  if (!source) return [];
  const key = `${event.id}:${source.gameId}`;
  const override = BRANCH_OVERRIDES[key];
  if (!override) return [];
  const byId = new Map(selection.rows.map(r => [r.gameId, r]));
  const rows = [];
  if (override.win && byId.get(override.win)) rows.push({ ...byId.get(override.win), branchLabel: `If ${shortenTeamName(matchedTeam.name)} wins` });
  if (override.loss && byId.get(override.loss)) rows.push({ ...byId.get(override.loss), branchLabel: `If ${shortenTeamName(matchedTeam.name)} loses` });
  return rows;
}

function computeIdleSnapshot(playerName, diagnostics, delayMs) {
  return {
    playerName,
    view: 'idle',
    eventName: 'No active event found',
    ends: [],
    scheduleRows: [],
    timelineHint: 'No live game.',
    scheduleHint: 'Scanning supported Curling I/O competitions for a current event every 72 hours.',
    nextCheckAt: Date.now() + delayMs,
    lastUpdatedLabel: formatClock(Date.now()),
    diagnostics
  };
}

function discoveryFastPathKey(playerNorm) {
  return `${APP.localKeys.discoveryPrefix}${playerNorm}`;
}

function saveDiscoveryFastPath(playerNorm, candidate) {
  try {
    const payload = {
      savedAt: Date.now(),
      subdomain: candidate.subdomain,
      eventId: candidate.event?.id || null
    };
    localStorage.setItem(discoveryFastPathKey(playerNorm), JSON.stringify(payload));
  } catch {}
}

function loadDiscoveryFastPath(playerNorm) {
  try {
    const raw = localStorage.getItem(discoveryFastPathKey(playerNorm));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.subdomain || !parsed.eventId) return null;
    if ((Date.now() - (parsed.savedAt || 0)) > APP.discoveryFastPathMs) {
      localStorage.removeItem(discoveryFastPathKey(playerNorm));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function candidateScoreRank(selection) {
  return selection.active ? 0 : selection.next ? 1 : selection.lastCompleted ? 2 : 3;
}

async function tryFastPathCandidate(playerNorm) {
  const fastPath = loadDiscoveryFastPath(playerNorm);
  if (!fastPath) return null;
  try {
    const event = await fetchJson(eventUrl(fastPath.subdomain, fastPath.eventId), {
      ttlMs: APP.eventCacheMs,
      cacheGroup: 'event'
    });
    if (!isEventTodayForward(event)) return null;
    const match = findMatchingTeam(event, playerNorm);
    if (!match) return null;
    const selection = selectGamesForEvent(event, match.team);
    return {
      item: { id: event.id },
      event,
      match,
      selection,
      subdomain: fastPath.subdomain,
      scoreRank: candidateScoreRank(selection),
      fastPath: true
    };
  } catch {
    return null;
  }
}

async function discoverPlayerEvents(playerName) {
  const playerNorm = normalizeName(playerName);
  const checked = [];
  const candidates = [];
  const fastCandidate = await tryFastPathCandidate(playerNorm);
  if (fastCandidate) {
    checked.push({ fastPath: true, subdomain: fastCandidate.subdomain, eventId: fastCandidate.event.id });
    return { checked, candidates: [fastCandidate] };
  }

  const listJobs = [];
  for (const subdomain of APP.clubSubdomains) {
    for (const delta of APP.lookaheadSeasons) {
      listJobs.push({ subdomain, delta });
    }
  }

  const listResults = await mapWithConcurrency(listJobs, APP.maxParallelSubdomains, async ({ subdomain, delta }) => {
    const listUrl = competitionsUrl(subdomain, delta);
    try {
      const payload = await fetchJson(listUrl, { ttlMs: APP.listCacheMs, cacheGroup: 'list' });
      const items = payload.items || [];
      return { subdomain, delta, listUrl, items };
    } catch {
      return { subdomain, delta, listUrl, items: [], skipped: true };
    }
  });

  for (const result of listResults) {
    checked.push({
      subdomain: result.subdomain,
      delta: result.delta,
      itemsCount: result.items.length,
      url: result.listUrl,
      skipped: !!result.skipped
    });

    if (!result.items.length) continue;

    const eventCandidates = await mapWithConcurrency(result.items, APP.maxParallelEventsPerList, async (item) => {
      try {
        const event = await fetchJson(eventUrl(result.subdomain, item.id), {
          ttlMs: APP.eventCacheMs,
          cacheGroup: 'event'
        });
        if (!isEventTodayForward(event)) return null;
        const match = findMatchingTeam(event, playerNorm);
        if (!match) return null;
        const selection = selectGamesForEvent(event, match.team);
        return {
          item,
          event,
          match,
          selection,
          subdomain: result.subdomain,
          scoreRank: candidateScoreRank(selection)
        };
      } catch {
        return null;
      }
    });

    for (const candidate of eventCandidates) {
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort((a,b) => a.scoreRank - b.scoreRank || (normalizeName(a.match.curler.name) === playerNorm ? -1 : 0) - (normalizeName(b.match.curler.name) === playerNorm ? -1 : 0) || (b.match.score - a.match.score) || ((b.event.id||0)-(a.event.id||0)));
  if (candidates[0]) saveDiscoveryFastPath(playerNorm, candidates[0]);
  return { checked, candidates };
}

function buildSnapshotFromCandidate(playerName, candidate, diagnostics) {
  const { event, match, selection } = candidate;
  const matchedTeam = match.team;
  const nextGame = selection.next || null;
  const nextGameConfirmed = !!selection.next;
  const lastCompleted = selection.lastCompleted;
  const active = selection.active;
  const displayGame = active || lastCompleted || nextGame || selection.rows[0] || null;
  let hammerNext='-', hammerSubtitle='Hammer unknown', ends={ rows: [], total: null }, teamScore=0, opponentScore=0, opponentName='TBD', currentEndLabel='Waiting', view='idle-event';

  if (displayGame) {
    const positions = getGamePositions(displayGame.game);
    const ourPos = positions.find(pos => getTeamIdFromPosition(pos) === matchedTeam.id) || {};
    const oppPos = positions.find(pos => { const tid = getTeamIdFromPosition(pos); return tid && tid !== matchedTeam.id; }) || {};
    const oppTeam = teamMap(event).get(getTeamIdFromPosition(oppPos)) || { name:'TBD', id:null };
    const firstHammerPos = positions.find(pos => pos.first_hammer || pos.firstHammer);
    const firstHammerName = getTeamIdFromPosition(firstHammerPos) === matchedTeam.id ? matchedTeam.name :
      getTeamIdFromPosition(firstHammerPos) === oppTeam.id ? oppTeam.name : 'Unknown';
    hammerNext = deriveHammer(matchedTeam.name, oppTeam.name, getEndScores(ourPos), getEndScores(oppPos), firstHammerName);
    hammerSubtitle = `${shortenTeamName(hammerNext, { keepCC: true })} has hammer`;
    ends = buildEnds(ourPos, oppPos, event.number_of_ends || 8, displayGame.lifecycle);
    teamScore = getPositionScore(ourPos);
    opponentScore = getPositionScore(oppPos);
    opponentName = oppTeam.name;
    const currentEnd = Math.max(getEndScores(ourPos).length, getEndScores(oppPos).length) + 1;
    currentEndLabel = active ? `${currentEnd}${ordinalSuffix(currentEnd)} end` : (displayGame.startsAt || 'Scheduled draw');
  }

  const nextGameLabel = nextGame
    ? `${nextGame.startsAt || formatEpochMs(nextGame.epochMs)}${nextGameConfirmed ? '' : ' (awaiting assignment)'}`
    : 'No next game available';
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
      stateLabel = ourScore > oppScore
        ? `Complete - won ${ourScore} - ${oppScore}`
        : ourScore < oppScore
        ? `Complete - lost ${ourScore} - ${oppScore}`
        : `Complete - ${ourScore} - ${oppScore}`;
    } else stateLabel = 'Unknown';
    return {
      gameId: r.gameId,
      gameName: r.gameName || r.game?.name || null,
      stageName: r.stageName || r.game?.stageName || null,
      drawLabel: r.drawLabel || null,
      game: r.game || null,
      startsAt: r.startsAt,
      epochMs: r.epochMs,
      stateLabel,
      team: matchedTeam.name,
      opponent: r.oppTeam?.name || 'TBD'
    };
  });
  const branchRows = getOutcomeBranchRows(event, matchedTeam, selection);
  const dedup = new Map();
  for (const row of [...linkedScheduleRows, ...branchRows]) {
    const key = `${row.gameId}|${row.branchLabel || ''}`;
    if (!dedup.has(key)) dedup.set(key, row);
  }
  const mergedScheduleRows = Array.from(dedup.values()).sort((a,b) => (a.epochMs ?? Number.MAX_SAFE_INTEGER) - (b.epochMs ?? Number.MAX_SAFE_INTEGER));

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
    ends,
    scheduleRows: mergedScheduleRows,
    activeGameId: active?.gameId || null,
    nextGameId: nextGame?.gameId || null,
    nextGameLabel,
    timelineHint: active ? 'Updates after each end.' : lastCompleted ? 'Latest posted end scores.' : 'Waiting for the draw to begin.',
    scheduleHint: nextGameConfirmed ? `Showing confirmed ${shortenTeamName(matchedTeam.name)} games only.` : 'Showing confirmed games for this team only.',
    nextCheckAt: Date.now() + nextCheck.delayMs,
    lastUpdatedLabel: formatClock(Date.now()),
    diagnostics,
    eventId: event.id,
    nextCheckReason: nextCheck.reason,
    nextGameConfirmed,
    progressSignature: active ? getProgressSignature(active) : ''
  };
}

async function runTracker({ reason }) {
  if (!state.playerName) return;
  state.lastRunAt = Date.now();
  setStatus(`Checking for ${state.playerName}...`);
  try {
    const discovery = await discoverPlayerEvents(state.playerName);
    if (!discovery.candidates.length) {
      const diagnostics = buildDiagnostics({
        phase: 'no-match',
        reason,
        playerName: state.playerName,
        checked: discovery.checked,
        policy: 'Idle scans every 72 hours until a current event appears.'
      });
      render(computeIdleSnapshot(state.playerName, diagnostics, APP.idleScanMs));
      setStatus(`No current Curling I/O event found for ${state.playerName}. Next scan in about 72 hours.`);
      scheduleNextRun(APP.idleScanMs);
      return;
    }

    const chosen = discovery.candidates[0];
    const selection = chosen.selection;
    const diagnostics = buildDiagnostics({
      phase: 'matched',
      reason,
      playerName: state.playerName,
      matchedCurler: chosen.match.curler.name,
      matchedTeam: chosen.match.team.name,
      sourceSubdomain: chosen.subdomain,
      matchScore: chosen.match.score,
      fastPathHit: !!chosen.fastPath,
      eventId: chosen.event.id,
      eventName: chosen.event.name,
      matchedTeamAliases: selection.diagnostics.matchedTeamAliases,
      aliasSearch: {
        aliasesChecked: selection.diagnostics.matchedTeamAliases,
        gamesMatchedByAlias: selection.diagnostics.aliasMatchedGames,
        inferredLinkedGames: selection.diagnostics.inferredLinkedGames
      },
      activeGameId: selection.active?.gameId || null,
      activeGameState: selection.active?.lifecycle || null,
      nextGameId: selection.next?.gameId || null,
      nextGameDrawLabel: selection.next?.drawLabel || null,
      nextGameConfirmed: !!selection.next,
      nextGameSearch: selection.diagnostics,
      completedGameId: selection.lastCompleted?.gameId || null,
      completedResult: getPositionResult(selection.lastCompleted?.ourPos) || null,
      nextCheckReason: computeCheckDelay(selection).reason,
      payloadStructure: {
        stagesCount: (chosen.event.stages || []).length,
        drawsCount: (chosen.event.draws || []).length,
        gamesCount: selection.diagnostics.totalStageGames,
        drawGameRefs: selection.diagnostics.totalDrawGameRefs
      },
      checked: discovery.checked,
      candidates: discovery.candidates.slice(0, 8).map(c => ({
        eventId: c.event.id,
        eventName: c.event.name,
        sourceSubdomain: c.subdomain,
        matchedCurler: c.match.curler.name,
        matchedTeam: c.match.team.name,
        matchScore: c.match.score,
        activeGameId: c.selection.active?.gameId || null,
        nextGameId: c.selection.next?.gameId || null,
        nextGameConfirmed: !!c.selection.next,
        completedGameId: c.selection.lastCompleted?.gameId || null
      }))
    });

    const snapshot = buildSnapshotFromCandidate(state.playerName, chosen, diagnostics);
    render(snapshot);

    const exactMatch = normalizeName(chosen.match.curler.name) === normalizeName(state.playerName);
    const prefix = exactMatch ? '' : `Unable to match ${state.playerName}. `;
    if (snapshot.view === 'live') {
      setStatus(`${prefix}${chosen.match.curler.name} is live in ${chosen.event.name}.`);
    } else if (snapshot.nextGameId) {
      setStatus(`${prefix}Matched ${chosen.match.curler.name} in ${chosen.event.name}. Next game will be monitored when its draw window opens.`);
    } else {
      setStatus(`${prefix}Matched ${chosen.match.curler.name} in ${chosen.event.name}. No live draw right now.`);
    }

    scheduleNextRun(Math.max(5000, snapshot.nextCheckAt - Date.now()));
  } catch (error) {
    const diagnostics = buildDiagnostics({ phase:'error', reason, playerName: state.playerName, error: error.message });
    const snapshot = computeIdleSnapshot(state.playerName, diagnostics, APP.errorRetryMs);
    snapshot.eventName = 'Temporary error';
    snapshot.scheduleHint = 'Retrying in 30 minutes.';
    render(snapshot);
    setStatus(`Could not refresh right now. Retrying in 30 minutes. ${error.message}`);
    scheduleNextRun(APP.errorRetryMs);
  }
}

function startTracking(playerName, reason = 'manual-start') {
  state.playerName = playerName.trim();
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
  } else if (recentlyRan) {
    return;
  }
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
  if (!state.playerName && els.playerInput.value.trim()) return startTracking(els.playerInput.value.trim(), 'manual-refresh-start');
  if (!state.playerName) return;
  runTracker({ reason:'manual-refresh' });
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  state.deferredPrompt = event;
  els.installBtn.classList.remove('hidden');
});
els.installBtn.addEventListener('click', async () => {
  if (!state.deferredPrompt) return;
  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice;
  state.deferredPrompt = null;
  els.installBtn.classList.add('hidden');
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(APP_VERSION)}`, { updateViaCache: 'none' });
      reg.update?.();
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!window.__ctReloaded) { window.__ctReloaded = true; window.location.reload(); }
      });
    } catch {}
  });
}
window.addEventListener('pageshow', () => maybeRunOpenScan('pageshow'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') maybeRunOpenScan('visible'); });
window.addEventListener('focus', () => maybeRunOpenScan('focus'));
bootFromSavedState();
