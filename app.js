const APP = {
  clubSubdomain: 'ab',
  language: 'en',
  lookaheadSeasons: [0],
  idleScanMs: 72 * 60 * 60 * 1000,
  preGameWindowMs: 45 * 60 * 1000,
  postGameWindowMs: 3 * 60 * 60 * 1000,
  activeRefreshMs: 60 * 1000,
  upcomingRefreshMs: 5 * 60 * 1000,
  justFinishedRefreshMs: 2 * 60 * 1000,
  errorRetryMs: 30 * 60 * 1000,
  openRescanFloorMs: 15 * 1000,
  visibleRescanFloorMs: 60 * 1000,
  localKeys: {
    player: 'curler-tracker-player-v7',
    snapshot: 'curler-tracker-snapshot-v7'
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
  hammerValue: document.getElementById('hammerValue'),
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
  diagnostics: { phase: 'idle' },
  lastRunAt: 0,
  lastVisibilityScanAt: 0,
  forceRefreshNonce: 0
};

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ordinalSuffix(n) {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

function formatEpochMs(epochMs) {
  if (!epochMs) return '—';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(epochMs));
}

function formatClock(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(d);
}

function setStatus(text) {
  els.statusLine.textContent = text;
}

function savePlayer(player) {
  localStorage.setItem(APP.localKeys.player, player);
}

function saveSnapshot(snapshot) {
  localStorage.setItem(APP.localKeys.snapshot, JSON.stringify(snapshot));
}

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(APP.localKeys.snapshot);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function parsePlayerFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('player')?.trim() || '';
}

function updateUrlPlayer(player) {
  const url = new URL(window.location.href);
  if (player) url.searchParams.set('player', player);
  else url.searchParams.delete('player');
  history.replaceState({}, '', url.toString());
}

function setDiagnostics(obj) {
  state.diagnostics = obj;
  els.diagnosticsOutput.textContent = JSON.stringify(obj, null, 2);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function competitionsUrl(delta) {
  return `https://api-curlingio.global.ssl.fastly.net/${APP.language}/clubs/${APP.clubSubdomain}/competitions?occurred=${encodeURIComponent(delta)}&registrations=f`;
}

function eventUrl(eventId) {
  return `https://api-curlingio.global.ssl.fastly.net/${APP.language}/clubs/${APP.clubSubdomain}/events/${eventId}`;
}


function parseEventDateToMs(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isEventTodayForward(event) {
  const today = startOfTodayMs();
  const state = String(event?.state || '').toLowerCase();
  if (state === 'active') return true;
  const endsMs = parseEventDateToMs(event?.ends_on);
  const startsMs = parseEventDateToMs(event?.starts_on);
  if (endsMs && endsMs >= today) return true;
  if (startsMs && startsMs >= today) return true;
  return false;
}

function flattenGames(event) {
  const rows = [];
  for (const stage of (event.stages || [])) {
    for (const game of (stage.games || [])) {
      rows.push({ ...game, stageId: stage.id, stageName: stage.name, stageType: stage.type });
    }
  }
  return rows;
}

function teamMap(event) {
  const map = new Map();
  for (const team of (event.teams || [])) map.set(team.id, team);
  return map;
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
        const playerParts = playerNameNorm.split(' ');
        const curlerParts = norm.split(' ');
        const overlap = playerParts.filter(part => curlerParts.includes(part));
        if (overlap.length >= 2) score = 50;
        else if (overlap.length === 1) score = 25;
      }
      if (score > (best?.score || 0)) best = { team, curler, score };
    }
  }
  return best;
}

function drawForGame(event, gameId) {
  return (event.draws || []).find(draw => Array.isArray(draw.draw_sheets) && draw.draw_sheets.includes(gameId)) || null;
}

function gameTeams(game, teamsById) {
  const positions = game.game_positions || [];
  return positions
    .filter(pos => pos.team_id)
    .map(pos => ({
      teamId: pos.team_id,
      team: teamsById.get(pos.team_id) || null,
      pos
    }));
}

function inferGameLifecycle(game, drawEpochMs) {
  const now = Date.now();
  const state = String(game.state || '').toLowerCase();
  if (state === 'playing') return 'playing';
  if (state === 'pending') {
    if (drawEpochMs && now >= drawEpochMs - APP.preGameWindowMs && now <= drawEpochMs + APP.postGameWindowMs) {
      return 'pending-window';
    }
    return 'pending';
  }
  if (state === 'complete') {
    if (drawEpochMs && now <= drawEpochMs + APP.postGameWindowMs) return 'just-finished';
    return 'complete';
  }
  const anyEnds = (game.game_positions || []).some(pos => (pos.end_scores || []).some(val => Number(val || 0) > 0));
  if (anyEnds && drawEpochMs && now <= drawEpochMs + APP.postGameWindowMs) return 'playing';
  return state || 'unknown';
}

function buildScheduleRows(event, matchedTeamId, matchedTeamName) {
  const teamsById = teamMap(event);
  const rows = [];
  for (const game of flattenGames(event)) {
    const positions = game.game_positions || [];
    if (!positions.some(pos => pos.team_id === matchedTeamId)) continue;
    const draw = drawForGame(event, game.id);
    const ourPos = positions.find(pos => pos.team_id === matchedTeamId) || {};
    const oppPos = positions.find(pos => pos.team_id && pos.team_id !== matchedTeamId) || {};
    const oppTeam = teamsById.get(oppPos.team_id);
    const epochMs = draw?.epoch ? draw.epoch * 1000 : null;
    const lifecycle = inferGameLifecycle(game, epochMs);
    rows.push({
      gameId: game.id,
      drawLabel: draw?.label ? `${String(draw.label).startsWith('B') ? '' : 'B'}${draw.label}` : (game.stageName || 'Draw'),
      startsAt: draw?.starts_at || (epochMs ? formatEpochMs(epochMs) : 'TBD'),
      epochMs,
      state: lifecycle,
      stateLabel: lifecycle === 'playing' ? 'Live' :
        lifecycle === 'pending-window' ? 'Starting soon' :
        lifecycle === 'pending' ? 'Scheduled' :
        lifecycle === 'just-finished' ? 'Final' :
        lifecycle === 'complete' ? 'Complete' : 'Unknown',
      team: matchedTeamName,
      opponent: oppTeam?.name || 'TBD',
      stageName: game.stageName || '',
      gameName: game.name || '',
      ourScore: Number(ourPos.score ?? 0),
      oppScore: Number(oppPos.score ?? 0)
    });
  }
  return rows.sort((a, b) => {
    const av = a.epochMs ?? Number.MAX_SAFE_INTEGER;
    const bv = b.epochMs ?? Number.MAX_SAFE_INTEGER;
    return av - bv || String(a.gameId).localeCompare(String(b.gameId));
  });
}

function selectGamesForTeam(event, matchedTeamId) {
  const teamsById = teamMap(event);
  const now = Date.now();
  const candidates = flattenGames(event)
    .map(game => {
      const draw = drawForGame(event, game.id);
      const epochMs = draw?.epoch ? draw.epoch * 1000 : null;
      const lifecycle = inferGameLifecycle(game, epochMs);
      const positions = game.game_positions || [];
      const ourPos = positions.find(pos => pos.team_id === matchedTeamId) || null;
      const oppPos = positions.find(pos => pos.team_id && pos.team_id !== matchedTeamId) || null;
      const oppTeam = oppPos?.team_id ? (teamsById.get(oppPos.team_id) || null) : null;
      const openSlots = positions.filter(pos => !pos.team_id).length;
      const proximity = epochMs ? Math.abs(epochMs - now) : Number.MAX_SAFE_INTEGER;
      const hasAssignedTeam = !!ourPos;
      const rank = lifecycle === 'playing' ? 0 :
        lifecycle === 'pending-window' ? 1 :
        lifecycle === 'pending' ? 2 :
        lifecycle === 'just-finished' ? 3 :
        lifecycle === 'complete' ? 4 : 5;
      return { game, draw, epochMs, lifecycle, rank, proximity, ourPos, oppPos, oppTeam, openSlots, hasAssignedTeam };
    })
    .sort((a, b) => a.rank - b.rank || a.proximity - b.proximity || ((a.epochMs || 0) - (b.epochMs || 0)));

  const assigned = candidates.filter(c => c.hasAssignedTeam);
  const active = assigned.find(c => c.lifecycle === 'playing') || null;
  const next = assigned
    .filter(c => ['pending-window', 'pending'].includes(c.lifecycle) && (c.epochMs || 0) >= now - APP.preGameWindowMs)
    .sort((a, b) => (a.epochMs || Number.MAX_SAFE_INTEGER) - (b.epochMs || Number.MAX_SAFE_INTEGER))[0] || null;
  const lastCompleted = assigned
    .filter(c => ['just-finished', 'complete'].includes(c.lifecycle))
    .sort((a, b) => (b.epochMs || 0) - (a.epochMs || 0))[0] || null;

  let inferredNext = null;
  if (!next && lastCompleted && String(lastCompleted.ourPos?.result || '').toLowerCase() === 'won') {
    inferredNext = candidates
      .filter(c => c !== lastCompleted && ['pending-window', 'pending'].includes(c.lifecycle) && (c.epochMs || 0) >= (lastCompleted.epochMs || 0) && c.openSlots > 0)
      .sort((a, b) => (a.epochMs || Number.MAX_SAFE_INTEGER) - (b.epochMs || Number.MAX_SAFE_INTEGER))[0] || null;
  }

  return {
    candidates,
    assignedCandidates: assigned,
    active,
    next,
    inferredNext,
    lastCompleted,
    diagnostics: {
      totalGames: candidates.length,
      assignedGames: assigned.length,
      futureAssignedGames: assigned.filter(c => ['pending-window', 'pending'].includes(c.lifecycle)).length,
      futureOpenSlotGames: candidates.filter(c => ['pending-window', 'pending'].includes(c.lifecycle) && c.openSlots > 0).length,
      usedInference: !next && !!inferredNext
    }
  };
}

function deriveHammer(teamAName, teamBName, endScoresA, endScoresB, firstHammerTeamName) {
  let hammer = firstHammerTeamName || 'Unknown';
  const maxEnds = Math.max(endScoresA.length, endScoresB.length);
  for (let i = 0; i < maxEnds; i += 1) {
    const a = Number(endScoresA[i] ?? 0);
    const b = Number(endScoresB[i] ?? 0);
    if (a > 0 && b === 0) hammer = teamBName;
    else if (b > 0 && a === 0) hammer = teamAName;
  }
  return hammer;
}

function buildEnds(ourPos, oppPos) {
  const ours = ourPos?.end_scores || [];
  const opps = oppPos?.end_scores || [];
  const length = Math.max(ours.length, opps.length);
  const rows = [];
  for (let i = 0; i < length; i += 1) {
    rows.push({
      end: i + 1,
      team: Number(ours[i] ?? 0),
      opponent: Number(opps[i] ?? 0)
    });
  }
  return rows;
}

function computeCheckDelay(eventSelection, scheduleRows) {
  const now = Date.now();
  if (eventSelection.active) return { delayMs: APP.activeRefreshMs, reason: 'live game refresh' };
  if (eventSelection.next) return { delayMs: APP.upcomingRefreshMs, reason: 'confirmed next game found' };
  if (eventSelection.inferredNext) return { delayMs: APP.upcomingRefreshMs, reason: 'watching inferred next game until team assignment appears' };
  if (eventSelection.lastCompleted) return { delayMs: APP.justFinishedRefreshMs, reason: 'checking whether completed game winner has advanced' };
  const nextRow = scheduleRows.find(row => row.epochMs && row.epochMs > now);
  if (nextRow) {
    const preWindowAt = nextRow.epochMs - APP.preGameWindowMs;
    if (preWindowAt > now) return { delayMs: preWindowAt - now, reason: 'sleep until pre-game window' };
    return { delayMs: APP.upcomingRefreshMs, reason: 'pre-game monitoring' };
  }
  return { delayMs: APP.idleScanMs, reason: 'event complete, resume periodic scans' };
}

function renderHeadline(snapshot) {
  if (!snapshot) {
    els.headlineBlock.innerHTML = '<p class="headline-empty">Enter a curler’s name to begin.</p>';
    return;
  }
  if (snapshot.view === 'live') {
    els.headlineBlock.innerHTML = `
      <div>
        <div class="headline-main">${escapeHtml(snapshot.teamName)} ${snapshot.teamScore} vs ${escapeHtml(snapshot.opponentName)} ${snapshot.opponentScore}</div>
        <div class="headline-sub">${escapeHtml(snapshot.currentEndLabel)} · ${escapeHtml(snapshot.drawTitle || 'Live now')}</div>
      </div>`;
    return;
  }
  if (snapshot.view === 'upcoming') {
    els.headlineBlock.innerHTML = `
      <div>
        <div class="headline-main">No live game</div>
        <div class="headline-sub">Next game: ${escapeHtml(snapshot.nextGameLabel || 'TBD')}</div>
      </div>`;
    return;
  }
  if (snapshot.view === 'idle-event') {
    els.headlineBlock.innerHTML = `
      <div>
        <div class="headline-main">Watching this event</div>
        <div class="headline-sub">${escapeHtml(snapshot.nextGameLabel || 'No active draw right now.')}</div>
      </div>`;
    return;
  }
  els.headlineBlock.innerHTML = `
    <div>
      <div class="headline-main">No active event found</div>
      <div class="headline-sub">Checking Alberta competitions every few days.</div>
    </div>`;
}

function renderEnds(ends) {
  if (!ends?.length) {
    els.endsList.className = 'ends-list empty';
    els.endsList.innerHTML = '<p>No end scores yet.</p>';
    return;
  }
  els.endsList.className = 'ends-list';
  els.endsList.innerHTML = ends.map(row => `
    <div class="end-row">
      <span class="end-label">End ${row.end}</span>
      <span class="end-score">${row.team} - ${row.opponent}</span>
    </div>`).join('');
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
    return `
      <div class="${cls}">
        <div>
          <div class="schedule-label">${escapeHtml(row.drawLabel)}</div>
          <div class="schedule-meta">${escapeHtml(row.team)} vs ${escapeHtml(row.opponent)}<br>${escapeHtml(row.gameId)}</div>
        </div>
        <div class="schedule-meta">${escapeHtml(row.startsAt)}<br>${escapeHtml(row.stateLabel)}</div>
      </div>`;
  }).join('');
}

function updateBadge(view) {
  els.liveBadge.className = 'badge';
  if (view === 'live') {
    els.liveBadge.classList.add('live');
    els.liveBadge.textContent = 'Live';
  } else if (view === 'upcoming') {
    els.liveBadge.classList.add('upcoming');
    els.liveBadge.textContent = 'Upcoming';
  } else if (view === 'complete') {
    els.liveBadge.classList.add('complete');
    els.liveBadge.textContent = 'Complete';
  } else {
    els.liveBadge.classList.add('muted');
    els.liveBadge.textContent = view === 'idle-event' ? 'Watching' : 'Idle';
  }
}

function render(snapshot) {
  state.snapshot = snapshot;
  saveSnapshot(snapshot);

  els.trackedPlayer.textContent = snapshot?.playerName || '—';
  renderHeadline(snapshot);
  updateBadge(snapshot?.view || 'idle');
  els.hammerValue.textContent = snapshot?.hammerNext || '—';
  els.eventValue.textContent = snapshot?.eventName || '—';
  els.nextCheckValue.textContent = snapshot?.nextCheckAt ? formatEpochMs(snapshot.nextCheckAt) : '—';
  els.updatedValue.textContent = snapshot?.lastUpdatedLabel || '—';
  els.timelineHint.textContent = snapshot?.timelineHint || 'Waiting for a live game.';
  els.scheduleHint.textContent = snapshot?.scheduleHint || 'No event loaded.';
  renderEnds(snapshot?.ends || []);
  renderSchedule(snapshot?.scheduleRows || [], snapshot?.activeGameId, snapshot?.nextGameId);
}

function scheduleNextRun(delayMs) {
  if (state.timerId) clearTimeout(state.timerId);
  state.timerId = window.setTimeout(() => runTracker({ reason: 'scheduled' }), Math.max(5_000, delayMs));
}

function computeIdleSnapshot(playerName, diagnostics, delayMs) {
  return {
    playerName,
    view: 'idle',
    eventName: 'No active event found',
    hammerNext: '—',
    ends: [],
    scheduleRows: [],
    timelineHint: 'No live game.',
    scheduleHint: 'Scanning Alberta competitions from today forward every 72 hours.',
    nextCheckAt: Date.now() + delayMs,
    lastUpdatedLabel: formatClock(new Date()),
    diagnostics
  };
}

async function discoverPlayerEvents(playerName) {
  const playerNorm = normalizeName(playerName);
  const checked = [];
  const candidates = [];
  for (const delta of APP.lookaheadSeasons) {
    const listUrl = competitionsUrl(delta);
    const payload = await fetchJson(listUrl);
    const items = payload.items || [];
    checked.push({ delta, itemsCount: items.length, url: listUrl });
    for (const item of items) {
      const event = await fetchJson(eventUrl(item.id));
      if (!isEventTodayForward(event)) continue;
      const match = findMatchingTeam(event, playerNorm);
      if (!match) continue;
      const selection = selectGamesForTeam(event, match.team.id);
      candidates.push({
        item,
        event,
        match,
        selection,
        scoreRank: selection.active ? 0 : selection.next ? 1 : selection.lastCompleted ? 2 : 3
      });
    }
  }
  candidates.sort((a, b) => a.scoreRank - b.scoreRank || (b.match.score - a.match.score) || ((b.event.id || 0) - (a.event.id || 0)));
  return { checked, candidates };
}

function buildSnapshotFromCandidate(playerName, candidate, diagnostics) {
  const { event, match, selection } = candidate;
  const matchedTeam = match.team;
  const scheduleRows = buildScheduleRows(event, matchedTeam.id, matchedTeam.name);
  const nextGame = selection.next || selection.inferredNext;
  const nextGameConfirmed = !!selection.next;
  const lastCompleted = selection.lastCompleted;
  const active = selection.active || null;
  const displayGame = active || lastCompleted || selection.next || selection.inferredNext || selection.candidates[0] || null;

  let hammerNext = '—';
  let ends = [];
  let teamScore = 0;
  let opponentScore = 0;
  let opponentName = 'TBD';
  let currentEndLabel = 'Waiting';
  let view = 'idle-event';

  if (displayGame) {
    const positions = displayGame.game.game_positions || [];
    const ourPos = positions.find(pos => pos.team_id === matchedTeam.id) || {};
    const oppPos = positions.find(pos => pos.team_id && pos.team_id !== matchedTeam.id) || {};
    const oppTeam = (teamMap(event)).get(oppPos.team_id) || { name: 'TBD' };
    const firstHammerPosition = positions.find(pos => pos.first_hammer);
    const firstHammerTeamName = firstHammerPosition?.team_id === matchedTeam.id ? matchedTeam.name :
      firstHammerPosition?.team_id === oppTeam.id ? oppTeam.name : 'Unknown';
    hammerNext = deriveHammer(matchedTeam.name, oppTeam.name, ourPos.end_scores || [], oppPos.end_scores || [], firstHammerTeamName);
    ends = buildEnds(ourPos, oppPos);
    teamScore = Number(ourPos.score ?? 0);
    opponentScore = Number(oppPos.score ?? 0);
    opponentName = oppTeam.name;
    const currentEnd = Math.max((ourPos.end_scores || []).length, (oppPos.end_scores || []).length) + 1;
    currentEndLabel = active ? `${currentEnd}${ordinalSuffix(currentEnd)} end` : (displayGame.draw?.starts_at || 'Scheduled draw');
  }

  const nextGameLabel = nextGame ? `${nextGame.draw?.label ? `${String(nextGame.draw.label).startsWith('B') ? '' : 'B'}${nextGame.draw.label}` + ' · ' : ''}${nextGame.draw?.starts_at || formatEpochMs(nextGame.epochMs)}${nextGameConfirmed ? '' : ' (awaiting assignment)'}` : 'No next game available';
  const nextCheck = computeCheckDelay(selection, scheduleRows);

  if (active) view = 'live';
  else if (nextGame) view = 'upcoming';
  else if (lastCompleted) view = 'idle-event';

  return {
    playerName,
    view,
    teamName: matchedTeam.name,
    opponentName,
    teamScore,
    opponentScore,
    currentEndLabel,
    drawTitle: active ? (active.draw?.label ? `B${active.draw.label}` : active.draw?.starts_at || active.game.stageName || 'Live') : '',
    hammerNext,
    eventName: event.name,
    ends,
    scheduleRows,
    activeGameId: active?.game.id || null,
    nextGameId: nextGame?.game.id || null,
    nextGameLabel,
    timelineHint: active ? 'Updates after each end.' : lastCompleted ? 'Latest posted end scores.' : 'Waiting for the draw to begin.',
    scheduleHint: nextGameConfirmed ? 'Only checking during this curler’s draw windows. Next game is confirmed by team assignment in the future game.' : 'Watching current event. No confirmed next game assignment yet; fallback bracket watch is active if applicable.',
    nextCheckAt: Date.now() + nextCheck.delayMs,
    lastUpdatedLabel: formatClock(new Date()),
    diagnostics,
    eventId: event.id,
    nextCheckReason: nextCheck.reason,
    nextGameConfirmed
  };
}

async function runTracker({ reason }) {
  if (!state.playerName) return;
  state.lastRunAt = Date.now();
  setStatus(`Checking for ${state.playerName}…`);

  try {
    const discovery = await discoverPlayerEvents(state.playerName);
    if (!discovery.candidates.length) {
      const diagnostics = {
        phase: 'no-match',
        reason,
        playerName: state.playerName,
        checked: discovery.checked,
        policy: 'Idle scans every 72 hours until a matching event appears.'
      };
      setDiagnostics(diagnostics);
      const snapshot = computeIdleSnapshot(state.playerName, diagnostics, APP.idleScanMs);
      render(snapshot);
      setStatus(`No current Alberta event from today forward found for ${state.playerName}. Next scan in about 72 hours.`);
      scheduleNextRun(APP.idleScanMs);
      return;
    }

    const chosen = discovery.candidates[0];
    const selection = chosen.selection;
    const diagnostics = {
      phase: 'matched',
      reason,
      playerName: state.playerName,
      matchedCurler: chosen.match.curler.name,
      matchedTeam: chosen.match.team.name,
      matchScore: chosen.match.score,
      eventId: chosen.event.id,
      eventName: chosen.event.name,
      activeGameId: selection.active?.game.id || null,
      activeGameState: selection.active?.lifecycle || null,
      nextGameId: (selection.next || selection.inferredNext)?.game.id || null,
      nextGameDrawLabel: (selection.next || selection.inferredNext)?.draw?.label || null,
      nextGameConfirmed: !!selection.next,
      nextGameSearch: selection.diagnostics,
      completedGameId: selection.lastCompleted?.game.id || null,
      completedResult: selection.lastCompleted?.ourPos?.result || null,
      nextCheckReason: computeCheckDelay(selection, buildScheduleRows(chosen.event, chosen.match.team.id, chosen.match.team.name)).reason,
      checked: discovery.checked,
      candidates: discovery.candidates.slice(0, 8).map(c => ({
        eventId: c.event.id,
        eventName: c.event.name,
        matchedCurler: c.match.curler.name,
        matchedTeam: c.match.team.name,
        matchScore: c.match.score,
        activeGameId: c.selection.active?.game.id || null,
        nextGameId: (c.selection.next || c.selection.inferredNext)?.game.id || null,
        nextGameConfirmed: !!c.selection.next,
        completedGameId: c.selection.lastCompleted?.game.id || null
      }))
    };
    setDiagnostics(diagnostics);

    const snapshot = buildSnapshotFromCandidate(state.playerName, chosen, diagnostics);
    render(snapshot);

    if (snapshot.view === 'live') {
      setStatus(`${chosen.match.curler.name} is live in ${chosen.event.name}. Refreshing every 60 seconds.`);
    } else if (snapshot.nextGameId) {
      setStatus(`Matched ${chosen.match.curler.name} in ${chosen.event.name}. Next game ${snapshot.nextGameId} will be monitored when its draw window opens.`);
    } else {
      setStatus(`Matched ${chosen.match.curler.name} in ${chosen.event.name}. No live draw right now.`);
    }

    scheduleNextRun(Math.max(5_000, snapshot.nextCheckAt - Date.now()));
  } catch (error) {
    const diagnostics = { phase: 'error', reason, playerName: state.playerName, error: error.message };
    setDiagnostics(diagnostics);
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

els.form.addEventListener('submit', (event) => {
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
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Share link copied.');
  } catch {
    setStatus('Could not copy automatically. You can copy the address from your browser.');
  }
});

els.refreshBtn.addEventListener('click', () => {
  if (!state.playerName && els.playerInput.value.trim()) {
    startTracking(els.playerInput.value.trim(), 'manual-refresh-start');
    return;
  }
  if (!state.playerName) return;
  runTracker({ reason: 'manual-refresh' });
});

els.diagnosticsToggle.addEventListener('click', () => {
  els.diagnosticsPanel.classList.toggle('hidden');
});

window.addEventListener('beforeinstallprompt', (event) => {
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

window.addEventListener('pageshow', () => maybeRunOpenScan('pageshow'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') maybeRunOpenScan('visible');
});
window.addEventListener('focus', () => maybeRunOpenScan('focus'));

bootFromSavedState();
