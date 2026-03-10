
const APP_VERSION = 'v28';
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
  localKeys: {
    player: 'curler-tracker-player-v28',
    snapshot: 'curler-tracker-snapshot-v28',
    trackingHint: 'curler-tracker-hint-v28'
  },
  curlingZone: {
    enabled: true,
    adapterUrl: './api/curlingzone/search',
    timeoutMs: 12000
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
  return new Intl.DateTimeFormat(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(epochMs));
}

function formatClock(value) {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? String(value || '—') : new Intl.DateTimeFormat(undefined, { hour:'numeric', minute:'2-digit' }).format(d);
}

function setStatus(text) { els.statusLine.textContent = text; }
function savePlayer(player) { localStorage.setItem(APP.localKeys.player, player); }
function saveSnapshot(snapshot) { localStorage.setItem(APP.localKeys.snapshot, JSON.stringify(snapshot)); }
function loadSnapshot() { try { const raw = localStorage.getItem(APP.localKeys.snapshot); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function saveTrackingHint(hint) {
  if (!hint) return localStorage.removeItem(APP.localKeys.trackingHint);
  localStorage.setItem(APP.localKeys.trackingHint, JSON.stringify(hint));
}
function loadTrackingHint() {
  try {
    const raw = localStorage.getItem(APP.localKeys.trackingHint);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearTrackingHint() { localStorage.removeItem(APP.localKeys.trackingHint); }
function parsePlayerFromUrl() { return new URLSearchParams(window.location.search).get('player')?.trim() || ''; }
function updateUrlPlayer(player) {
  const url = new URL(window.location.href);
  if (player) url.searchParams.set('player', player); else url.searchParams.delete('player');
  history.replaceState({}, '', url.toString());
}
function setDiagnostics(obj) {
  state.diagnostics = obj;
  els.diagnosticsOutput.textContent = JSON.stringify(obj, null, 2);
}
function buildDiagnostics(base) { return { appVersion: APP_VERSION, timestamp: new Date().toISOString(), ...base }; }

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
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
      const openSlots = Math.max(0, 2 - positions.filter(pos => !!getTeamIdFromPosition(pos)).length);
      const lifecycle = inferLifecycle(game, epochMs);
      const aliasMatch = !ourPos
        && openSlots > 0
        && ['pending-window','pending'].includes(lifecycle)
        && gameMatchesTeamByAlias(game, matchedTeam);
      const linked = !!ourPos || aliasMatch;
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
  els.headlineBlock.innerHTML = `<div><div class="headline-main">No active event found</div><div class="headline-sub">Checking Alberta competitions every few days.</div></div>`;
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
    const resolvedTitle = resolveGameTitle(row);
    const title = row.branchLabel ? row.branchLabel : (resolvedTitle ? `${resolvedTitle} · ${matchup}` : matchup);
    const subtitle = row.branchLabel ? `${shortenTeamName(row.team)} vs ${shortenTeamName(row.opponent)}` : row.stateLabel;
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
  els.trackedPlayer.textContent = snapshot?.displayPlayer || snapshot?.playerName || '—';
  renderHeadline(snapshot);
  updateBadge(snapshot?.view || 'idle');
  els.eventValue.textContent = snapshot?.eventName || '—';
  els.nextCheckValue.textContent = snapshot?.nextCheckAt ? formatEpochMs(snapshot.nextCheckAt) : '—';
  els.updatedValue.textContent = snapshot?.lastUpdatedLabel || '—';
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
    scheduleHint: 'Scanning Alberta competitions from today forward every 72 hours.',
    nextCheckAt: Date.now() + delayMs,
    lastUpdatedLabel: formatClock(Date.now()),
    diagnostics
  };
}



async function fetchJsonWithTimeout(url, { timeoutMs = 15000, headers = { Accept: "application/json" }, cache = "no-store" } = {}) {
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

function splitNameParts(name) {
  return normalizeName(name).split(' ').filter(Boolean);
}

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

function computeEventTimeBounds(selection) {
  const rows = selection?.linkedRows?.length ? selection.linkedRows : (selection?.rows || []);
  const times = rows.map(r => Number(r?.epochMs || 0)).filter(Boolean).sort((a,b) => a-b);
  if (!times.length) return { startMs: null, endMs: null };
  return {
    startMs: times[0],
    endMs: times[times.length - 1] + APP.postGameWindowMs
  };
}

function eventsConflictInTime(a, b) {
  const at = computeEventTimeBounds(a.selection);
  const bt = computeEventTimeBounds(b.selection);
  if (!at.startMs || !at.endMs || !bt.startMs || !bt.endMs) return false;
  return at.startMs <= bt.endMs && bt.startMs <= at.endMs;
}

function getCandidatePrimaryTime(candidate) {
  return Number(candidate?.selection?.active?.epochMs || candidate?.selection?.next?.epochMs || candidate?.selection?.lastCompleted?.epochMs || 0) || Number.MAX_SAFE_INTEGER;
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
  const dayBucket = Number.isFinite(primaryTime) && primaryTime !== Number.MAX_SAFE_INTEGER
    ? new Date(primaryTime).toISOString().slice(0, 10)
    : 'no-date';
  return `${eventName}|${teamName}|${dayBucket}`;
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
  const enriched = candidates.map(candidate => ({
    ...candidate,
    identityScore: computeCandidateIdentityScore(playerName, candidate),
    canonicalEventKey: buildCanonicalEventKey(candidate)
  })).filter(candidate => candidate.identityScore > 0);

  const dedupedMap = new Map();
  for (const candidate of enriched) {
    const existing = dedupedMap.get(candidate.canonicalEventKey);
    if (!existing) dedupedMap.set(candidate.canonicalEventKey, candidate);
    else dedupedMap.set(candidate.canonicalEventKey, chooseBetterCandidateForSameEvent(existing, candidate, playerNorm));
  }

  let pool = Array.from(dedupedMap.values());
  const exactPool = pool.filter(c => normalizeName(c.match.curler.name) === playerNorm);
  if (exactPool.length) pool = exactPool;
  else {
    const strongPool = pool.filter(c => (c.identityScore || 0) >= 88);
    if (strongPool.length) pool = strongPool;
  }

  const SOURCE_PRIORITY = { curlingio: 0, curlingzone: 1 };
  pool.sort((a, b) =>
    ((b.identityScore || 0) - (a.identityScore || 0)) ||
    ((b.match.score || 0) - (a.match.score || 0)) ||
    ((SOURCE_PRIORITY[a.source || 'curlingio'] ?? 99) - (SOURCE_PRIORITY[b.source || 'curlingio'] ?? 99)) ||
    (a.scoreRank - b.scoreRank) ||
    (getCandidatePrimaryTime(a) - getCandidatePrimaryTime(b)) ||
    (String(b.event.id || '').localeCompare(String(a.event.id || '')))
  );

  return pool;
}

function buildTrackingHint(playerName, candidate, candidatePool = []) {
  if (!candidate?.match || Number(candidate.identityScore || 0) < 88) return null;
  const identityVariants = Array.from(new Set(candidatePool
    .filter(c => (c.identityScore || 0) >= 88 && !eventsConflictInTime(candidate, c))
    .flatMap(c => [c?.match?.curler?.name, c?.matchedCurler, c?.selectionRows?.[0]?.matchedCurler])
    .filter(Boolean)
    .map(name => normalizeName(name)))).slice(0, 8);
  const recentContexts = candidatePool
    .filter(c => (c.identityScore || 0) >= 88)
    .slice(0, 6)
    .map(c => ({
      source: c.source || 'curlingio',
      sourceSubdomain: c.subdomain || null,
      eventId: c.event?.id || null,
      eventName: c.event?.name || '',
      matchedTeamId: c.match?.team?.id || null,
      matchedTeamName: c.match?.team?.name || '',
      matchedCurler: c.match?.curler?.name || '',
      identityScore: c.identityScore || 0,
      startsAtMs: getCandidatePrimaryTime(c),
      timeBounds: computeEventTimeBounds(c.selection)
    }));
  return {
    playerName,
    playerNorm: normalizeName(playerName),
    source: candidate.source || 'curlingio',
    sourceSubdomain: candidate.subdomain || null,
    eventId: candidate.event?.id || null,
    eventName: candidate.event?.name || '',
    matchedCurler: candidate.match?.curler?.name || '',
    matchedTeamId: candidate.match?.team?.id || null,
    matchedTeamName: candidate.match?.team?.name || '',
    matchScore: Number(candidate.match?.score || 0),
    identityScore: Number(candidate.identityScore || 0),
    identityVariants,
    recentContexts,
    savedAt: new Date().toISOString()
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
      game: {
        id: row.gameId || `cz:${row.eventId || 'event'}:${idx}`,
        name: row.gameTitle || '',
        state: row.state || lifecycle,
        game_positions: [ourPos, oppPos]
      },
      gameId: row.gameId || `cz:${row.eventId || 'event'}:${idx}`,
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
      gameName: row.gameTitle || '',
      stateLabel: row.stateLabel || row.state || (lifecycle === 'playing' ? 'Live' : lifecycle === 'pending' ? 'Scheduled' : lifecycle === 'complete' ? 'Complete' : 'Unknown'),
      sourceUrl: row.sourceUrl || null
    };
  }).sort((a, b) => (a.epochMs ?? Number.MAX_SAFE_INTEGER) - (b.epochMs ?? Number.MAX_SAFE_INTEGER) || String(a.gameId).localeCompare(String(b.gameId)));

  const active = normalizedRows.find(r => r.lifecycle === 'playing') || null;
  const next = normalizedRows.filter(r => ['pending-window', 'pending'].includes(r.lifecycle)).sort((a, b) => (a.epochMs ?? Number.MAX_SAFE_INTEGER) - (b.epochMs ?? Number.MAX_SAFE_INTEGER))[0] || null;
  const lastCompleted = normalizedRows.filter(r => ['just-finished', 'complete'].includes(r.lifecycle)).sort((a, b) => (b.epochMs || 0) - (a.epochMs || 0))[0] || null;
  const stateCounts = {};
  for (const row of normalizedRows) stateCounts[row.lifecycle] = (stateCounts[row.lifecycle] || 0) + 1;
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
      futureAssignedGames: normalizedRows.filter(r => ['pending-window', 'pending'].includes(r.lifecycle)).length,
      futureOpenSlotGames: 0,
      stateCounts,
      matchedTeamAliases: [],
      inferredLinkedGames: [],
      unmatchedDrawRows: [],
      usedInference: false
    }
  };
}



function findMatchingTeamFromHint(event, hint) {
  const hintTeamId = hint?.matchedTeamId || null;
  const hintTeamNameNorm = normalizeName(hint?.matchedTeamName || '');
  if (hintTeamId) {
    const byId = (event.teams || []).find(team => team.id === hintTeamId);
    if (byId) return byId;
  }
  if (hintTeamNameNorm) {
    const exact = (event.teams || []).find(team => normalizeName(team.name) === hintTeamNameNorm);
    if (exact) return exact;
    const alias = (event.teams || []).find(team => teamAliases(team).includes(hintTeamNameNorm));
    if (alias) return alias;
  }
  return null;
}

async function discoverPlayerEventFromHint(playerName, hint) {
  if (!isTrackingHintEligible(playerName, hint)) return null;

  const contexts = Array.isArray(hint?.recentContexts) && hint.recentContexts.length
    ? hint.recentContexts
    : [{
        source: hint.source || 'curlingio',
        sourceSubdomain: hint.sourceSubdomain || null,
        eventId: hint.eventId || null,
        matchedTeamId: hint.matchedTeamId || null,
        matchedTeamName: hint.matchedTeamName || '',
        matchedCurler: hint.matchedCurler || '',
        identityScore: Number(hint.identityScore || hint.matchScore || 0)
      }];

  const preferred = contexts.slice().sort((a, b) => (Number(b.identityScore || 0) - Number(a.identityScore || 0)) || (Number(a.startsAtMs || 0) - Number(b.startsAtMs || 0)));

  for (const ctx of preferred) {
    if ((ctx.source || 'curlingio') === 'curlingio') {
      if (!ctx.sourceSubdomain || !ctx.eventId) continue;
      try {
        const event = await fetchJson(eventUrl(ctx.sourceSubdomain, ctx.eventId));
        const matchedTeam = findMatchingTeamFromHint(event, ctx);
        if (!matchedTeam) continue;
        const selection = selectGamesForEvent(event, matchedTeam);
        if (!selection?.rows?.length) continue;
        return {
          item: { id: event.id },
          event,
          match: {
            team: { id: matchedTeam.id, name: matchedTeam.name },
            curler: { name: ctx.matchedCurler || hint.matchedCurler || matchedTeam.name },
            score: 100
          },
          identityScore: Number(ctx.identityScore || hint.identityScore || 100),
          selection,
          subdomain: ctx.sourceSubdomain,
          source: 'curlingio',
          scoreRank: selection.active ? 0 : selection.next ? 1 : selection.lastCompleted ? 2 : 3
        };
      } catch {}
    }
  }

  const needCurlingZone = preferred.some(ctx => (ctx.source || '') === 'curlingzone');
  if (needCurlingZone) {
    const cz = await discoverCurlingZoneEvents(playerName);
    const ctxs = preferred.filter(ctx => (ctx.source || '') === 'curlingzone');
    for (const ctx of ctxs) {
      const eventId = String(ctx.eventId || '');
      const candidate = cz.candidates.find(c => String(c.event?.id || '') === eventId && (c.identityScore || 0) >= 88) || null;
      if (candidate) return candidate;
    }
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
      event: { id: `cz:${eventId}`, name: row.eventName || 'CurlingZone Event', number_of_ends: 8, teams: [] },
      match: { team: { id: `cz-team:${normalizeName(matchedTeam)}`, name: matchedTeam }, curler: { name: matchedCurler }, score: matchScore },
      selectionRows: [],
      subdomain: 'curlingzone',
      source: 'curlingzone'
    });
    byCandidate.get(key).selectionRows.push({ ...row, eventId: `cz:${eventId}`, matchedTeam, matchedCurler, matchScore });
    if (matchScore > byCandidate.get(key).match.score) {
      byCandidate.get(key).match = { team: { id: `cz-team:${normalizeName(matchedTeam)}`, name: matchedTeam }, curler: { name: matchedCurler }, score: matchScore };
    }
  }

  const candidates = [];
  for (const candidate of byCandidate.values()) {
    const selection = buildCurlingZoneSelection(candidate.selectionRows, candidate.match.team.name);
    candidates.push({
      item: candidate.item,
      event: candidate.event,
      match: candidate.match,
      selection,
      subdomain: candidate.subdomain,
      source: candidate.source,
      scoreRank: selection.active ? 0 : selection.next ? 1 : selection.lastCompleted ? 2 : 3
    });
  }
  return candidates;
}

async function discoverCurlingZoneEvents(playerName) {
  if (!APP.curlingZone?.enabled || !APP.curlingZone?.adapterUrl) return { checked: [], candidates: [] };
  const url = `${APP.curlingZone.adapterUrl}?player=${encodeURIComponent(playerName)}`;
  try {
    const payload = await fetchJsonWithTimeout(url, { timeoutMs: APP.curlingZone.timeoutMs });
    const candidates = normalizeCurlingZoneResponse(payload, playerName);
    return {
      checked: [{ source: 'curlingzone', itemsCount: Array.isArray(payload?.rows) ? payload.rows.length : 0, url, ok: true }],
      candidates
    };
  } catch (error) {
    return {
      checked: [{ source: 'curlingzone', itemsCount: 0, url, ok: false, error: error.message }],
      candidates: []
    };
  }
}

async function discoverCurlingIoEvents(playerName) {
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
            if (!isEventTodayForward(event)) continue;
            const match = findMatchingTeam(event, playerNorm);
            if (!match) continue;
            const selection = selectGamesForEvent(event, match.team);
            candidates.push({ item, event, match, selection, subdomain, source: 'curlingio', scoreRank: selection.active ? 0 : selection.next ? 1 : selection.lastCompleted ? 2 : 3 });
          } catch {}
        }
      } catch {
        checked.push({ source: 'curlingio', subdomain, delta, itemsCount: 0, url: listUrl, skipped: true });
      }
    }
  }
  return { checked, candidates };
}

async function discoverPlayerEvents(playerName) {
  const [cio, cz] = await Promise.all([
    discoverCurlingIoEvents(playerName),
    discoverCurlingZoneEvents(playerName)
  ]);
  const checked = [...cio.checked, ...cz.checked];
  const candidates = [...cio.candidates, ...cz.candidates];
  const pool = clusterAndPrioritizeCandidates(playerName, candidates);
  return { checked, candidates: pool };
}

function buildSnapshotFromCandidate(playerName, candidate, diagnostics) {
  const { event, match, selection } = candidate;
  const matchedTeam = match.team;
  const nextGame = selection.next || null;
  const nextGameConfirmed = !!selection.next;
  const lastCompleted = selection.lastCompleted;
  const active = selection.active;
  const displayGame = active || lastCompleted || nextGame || selection.rows[0] || null;
  let hammerNext='—', hammerSubtitle='Hammer unknown', ends={ rows: [], total: null }, teamScore=0, opponentScore=0, opponentName='TBD', currentEndLabel='Waiting', view='idle-event';

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
        ? `Complete · won ${ourScore} - ${oppScore}`
        : ourScore < oppScore
        ? `Complete · lost ${ourScore} - ${oppScore}`
        : `Complete · ${ourScore} - ${oppScore}`;
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
  const branchRows = [];
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
    source: candidate.source || 'curlingio',
    ends,
    scheduleRows: mergedScheduleRows,
    activeGameId: active?.gameId || null,
    nextGameId: nextGame?.gameId || null,
    nextGameLabel,
    timelineHint: active ? 'Updates after each end.' : lastCompleted ? 'Latest posted end scores.' : 'Waiting for the draw to begin.',
    scheduleHint: candidate.source === 'curlingzone' ? 'CurlingZone supplement in use. Curling I/O would override this source when available.' : (nextGameConfirmed ? `Showing confirmed ${shortenTeamName(matchedTeam.name)} games only.` : 'Showing confirmed games for this team only.'),
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
  setStatus(`Checking for ${state.playerName}…`);
  try {
    const trackingHint = loadTrackingHint();
    const hintedCandidate = await discoverPlayerEventFromHint(state.playerName, trackingHint).catch(() => null);
    if (hintedCandidate) {
      const selection = hintedCandidate.selection;
      const diagnostics = buildDiagnostics({
        phase: 'matched-from-memory',
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
        trackingHintSavedAt: trackingHint?.savedAt || null,
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
          stagesCount: (hintedCandidate.event.stages || []).length,
          drawsCount: (hintedCandidate.event.draws || []).length,
          gamesCount: selection.diagnostics.totalStageGames,
          drawGameRefs: selection.diagnostics.totalDrawGameRefs
        },
        checked: [{ source: hintedCandidate.source || 'curlingio', eventId: hintedCandidate.event.id, reusedTrackingHint: true }],
        candidates: [{
          eventId: hintedCandidate.event.id,
          eventName: hintedCandidate.event.name,
          sourceType: hintedCandidate.source || 'curlingio',
          sourceSubdomain: hintedCandidate.subdomain,
          matchedCurler: hintedCandidate.match.curler.name,
          matchedTeam: hintedCandidate.match.team.name,
          matchScore: hintedCandidate.match.score,
        identityScore: hintedCandidate.identityScore || hintedCandidate.match.score,
          activeGameId: selection.active?.gameId || null,
          nextGameId: selection.next?.gameId || null,
          nextGameConfirmed: !!selection.next,
          completedGameId: selection.lastCompleted?.gameId || null
        }]
      });

      const snapshot = buildSnapshotFromCandidate(state.playerName, hintedCandidate, diagnostics);
      render(snapshot);
      if (snapshot.view === 'live') setStatus(`${hintedCandidate.match.curler.name} is live in ${hintedCandidate.event.name}.`);
      else if (snapshot.nextGameId) setStatus(`Reused remembered match for ${hintedCandidate.match.curler.name} in ${hintedCandidate.event.name}. Next game will be monitored when its draw window opens.`);
      else setStatus(`Reused remembered match for ${hintedCandidate.match.curler.name} in ${hintedCandidate.event.name}. No live draw right now.`);
      scheduleNextRun(Math.max(5000, snapshot.nextCheckAt - Date.now()));
      return;
    }

    const discovery = await discoverPlayerEvents(state.playerName);
    if (!discovery.candidates.length) {
      const diagnostics = buildDiagnostics({
        phase: 'no-match',
        reason,
        playerName: state.playerName,
        checked: discovery.checked,
        policy: 'Idle scans every 72 hours until a matching Curling I/O or CurlingZone event appears.'
      });
      clearTrackingHint();
      render(computeIdleSnapshot(state.playerName, diagnostics, APP.idleScanMs));
      setStatus(`No current Curling I/O or CurlingZone event from today forward found for ${state.playerName}. Next scan in about 72 hours.`);
      scheduleNextRun(APP.idleScanMs);
      return;
    }

    const chosen = discovery.candidates[0];
    const chosenHint = buildTrackingHint(state.playerName, chosen, discovery.candidates);
    if (chosenHint) saveTrackingHint(chosenHint);
    const selection = chosen.selection;
    const diagnostics = buildDiagnostics({
      phase: 'matched',
      reason,
      playerName: state.playerName,
      matchedCurler: chosen.match.curler.name,
      matchedTeam: chosen.match.team.name,
      sourceType: chosen.source || 'curlingio',
      sourceSubdomain: chosen.subdomain,
      matchScore: chosen.match.score,
      identityScore: chosen.identityScore || chosen.match.score,
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
        sourceType: c.source || 'curlingio',
        sourceSubdomain: c.subdomain,
        matchedCurler: c.match.curler.name,
        matchedTeam: c.match.team.name,
        matchScore: c.match.score,
        identityScore: c.identityScore || c.match.score,
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
  const nextPlayer = playerName.trim();
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
els.diagnosticsToggle.addEventListener('click', () => els.diagnosticsPanel.classList.toggle('hidden'));
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
      const reg = await navigator.serviceWorker.register('./sw.js');
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
