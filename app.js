const APP = {
  clubSubdomain: 'ab',
  language: 'en',
  idleScanMs: 72 * 60 * 60 * 1000,
  preGameWindowMs: 45 * 60 * 1000,
  postGameWindowMs: 4 * 60 * 60 * 1000,
  activeRefreshMs: 60 * 1000,
  upcomingRefreshMs: 5 * 60 * 1000,
  errorRetryMs: 30 * 60 * 1000,
  lookaheadSeasons: [0, -1],
  localKeys: {
    player: 'curler-tracker-player',
    snapshot: 'curler-tracker-snapshot'
  }
};

const GAME_STATE = {
  live: new Set(['playing', 'live', 'active', 'inprogress', 'in_progress', 'started', 'underway']),
  upcoming: new Set(['pending', 'scheduled', 'upcoming', 'future', 'ready']),
  complete: new Set(['complete', 'completed', 'final', 'closed'])
};

const els = {
  form: document.getElementById('playerForm'),
  playerInput: document.getElementById('playerInput'),
  shareBtn: document.getElementById('shareBtn'),
  diagnosticsToggle: document.getElementById('diagnosticsToggle'),
  diagnosticsPanel: document.getElementById('diagnosticsPanel'),
  diagnosticsOutput: document.getElementById('diagnosticsOutput'),
  statusLine: document.getElementById('statusLine'),
  trackedPlayer: document.getElementById('trackedPlayer'),
  liveBadge: document.getElementById('liveBadge'),
  headlineBlock: document.getElementById('headlineBlock'),
  hammerValue: document.getElementById('hammerValue'),
  eventValue: document.getElementById('eventValue'),
  nextGameValue: document.getElementById('nextGameValue'),
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
  lastVisibilityScanAt: 0
};

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
    hour: 'numeric', minute: '2-digit'
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
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function competitionsUrl(delta) {
  const base = `https://api-curlingio.global.ssl.fastly.net/${APP.language}/clubs/${APP.clubSubdomain}/competitions`;
  return `${base}?occurred=${encodeURIComponent(delta)}`;
}

function eventUrl(eventId) {
  return `https://api-curlingio.global.ssl.fastly.net/${APP.language}/clubs/${APP.clubSubdomain}/events/${eventId}`;
}

function flattenGames(event) {
  const games = [];
  (event.stages || []).forEach(stage => {
    (stage.games || []).forEach(game => {
      games.push({ ...game, stageName: stage.name, stageType: stage.type });
    });
  });
  return games;
}

function teamMap(event) {
  const map = new Map();
  (event.teams || []).forEach(team => map.set(team.id, team));
  return map;
}

function findMatchingTeam(event, playerNameNorm) {
  const teams = event.teams || [];
  let best = null;
  for (const team of teams) {
    const lineup = team.lineup || [];
    for (const curler of lineup) {
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
      if (score > (best?.score || 0)) {
        best = { team, curler, score, lineupSize: lineup.length };
      }
    }
  }
  return best;
}

function drawContainsGame(draw, gameId) {
  if (!draw || !Array.isArray(draw.draw_sheets)) return false;
  return draw.draw_sheets.some(sheet => {
    if (sheet === gameId) return true;
    if (typeof sheet === 'string') return sheet === gameId;
    if (sheet && typeof sheet === 'object') {
      return sheet.id === gameId || sheet.game_id === gameId || sheet.gameId === gameId;
    }
    return false;
  });
}

function findDrawForGame(event, gameId) {
  return (event.draws || []).find(draw => drawContainsGame(draw, gameId)) || null;
}

function normalizeGameState(rawState) {
  const key = String(rawState || '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
  const compact = key.replace(/_/g, '');
  if (GAME_STATE.live.has(key) || GAME_STATE.live.has(compact)) return 'live';
  if (GAME_STATE.upcoming.has(key) || GAME_STATE.upcoming.has(compact)) return 'upcoming';
  if (GAME_STATE.complete.has(key) || GAME_STATE.complete.has(compact)) return 'complete';
  return 'unknown';
}

function sumEnds(endScores = []) {
  return endScores.reduce((sum, val) => sum + Number(val || 0), 0);
}

function classifyGame(game, draw) {
  const now = Date.now();
  const epochMs = draw?.epoch ? draw.epoch * 1000 : null;
  const startsSoon = epochMs && now >= epochMs - APP.preGameWindowMs && now <= epochMs + APP.postGameWindowMs;
  const positions = game.game_positions || [];
  const hasEnds = positions.some(pos => (pos.end_scores || []).length > 0);
  const hasPartialScore = positions.some(pos => Number(pos.score ?? sumEnds(pos.end_scores || [])) > 0);
  const hasResult = positions.some(pos => pos.result);
  const explicit = normalizeGameState(game.state);

  if (explicit === 'live') return 'live';
  if (explicit === 'upcoming') return 'upcoming';
  if (explicit === 'complete') return 'complete';

  if (hasEnds && !hasResult && startsSoon) return 'live';
  if (hasPartialScore && !hasResult && startsSoon) return 'live';
  if (!hasEnds && startsSoon) return 'upcoming';
  if (hasResult) return 'complete';
  if (epochMs && epochMs > now) return 'upcoming';
  if (hasEnds || hasPartialScore) return 'complete';
  return 'unknown';
}

function chooseRelevantGame(event, matchedTeamId) {
  const now = Date.now();
  const games = flattenGames(event)
    .map(game => {
      const draw = findDrawForGame(event, game.id);
      const positions = game.game_positions || [];
      const includesTeam = positions.some(pos => pos.team_id === matchedTeamId);
      if (!includesTeam) return null;
      const epochMs = draw?.epoch ? draw.epoch * 1000 : null;
      const inferredState = classifyGame(game, draw);
      const stateRank = inferredState === 'live' ? 0 : inferredState === 'upcoming' ? 1 : inferredState === 'complete' ? 2 : 3;
      const inWindow = epochMs ? now >= epochMs - APP.preGameWindowMs && now <= epochMs + APP.postGameWindowMs : false;
      const proximity = epochMs ? Math.abs(epochMs - now) : Number.MAX_SAFE_INTEGER;
      return { game, draw, epochMs, inferredState, stateRank, inWindow, proximity };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.stateRank !== b.stateRank) return a.stateRank - b.stateRank;
      if (a.inWindow !== b.inWindow) return a.inWindow ? -1 : 1;
      if (a.proximity !== b.proximity) return a.proximity - b.proximity;
      return (a.epochMs || 0) - (b.epochMs || 0);
    });

  return games[0] || null;
}

function deriveHammer(teamAName, teamBName, endScoresA, endScoresB, firstHammerTeamName) {
  let hammer = firstHammerTeamName || 'Unknown';
  const ends = Math.max(endScoresA.length, endScoresB.length);
  for (let i = 0; i < ends; i += 1) {
    const a = Number(endScoresA[i] ?? 0);
    const b = Number(endScoresB[i] ?? 0);
    if (a > 0 && b === 0) hammer = teamBName;
    else if (b > 0 && a === 0) hammer = teamAName;
  }
  return hammer;
}

function buildEnds(teamPos, oppPos) {
  const teamEnds = teamPos.end_scores || [];
  const oppEnds = oppPos.end_scores || [];
  const length = Math.max(teamEnds.length, oppEnds.length);
  const rows = [];
  for (let i = 0; i < length; i += 1) {
    const teamVal = Number(teamEnds[i] ?? 0);
    const oppVal = Number(oppEnds[i] ?? 0);
    rows.push({ end: i + 1, team: teamVal, opponent: oppVal });
  }
  return rows;
}

function findNextUpcomingRow(scheduleRows, activeGameId) {
  const now = Date.now();
  return scheduleRows
    .filter(row => row.gameId !== activeGameId && row.epochMs && row.epochMs > now)
    .sort((a, b) => a.epochMs - b.epochMs)[0] || null;
}

function renderHeadline(snapshot) {
  if (!snapshot) {
    els.headlineBlock.innerHTML = '<p class="headline-empty">Enter a curler’s name to begin.</p>';
    return;
  }

  if (snapshot.view === 'live') {
    els.headlineBlock.innerHTML = `
      <div class="headline-main">${escapeHtml(snapshot.teamName)} ${snapshot.teamScore} vs ${escapeHtml(snapshot.opponentName)} ${snapshot.opponentScore}</div>
      <div class="headline-sub">${escapeHtml(snapshot.currentEndLabel)} · ${escapeHtml(snapshot.drawLabel || snapshot.stageName || 'Live now')}</div>
    `;
    return;
  }

  if (snapshot.view === 'upcoming') {
    els.headlineBlock.innerHTML = `
      <div class="headline-main">No live game</div>
      <div class="headline-sub">Next draw: ${escapeHtml(snapshot.nextDrawLabel || 'TBD')}</div>
    `;
    return;
  }

  if (snapshot.view === 'idle-event') {
    els.headlineBlock.innerHTML = `
      <div class="headline-main">Watching this event</div>
      <div class="headline-sub">No active draw right now.</div>
    `;
    return;
  }

  els.headlineBlock.innerHTML = `
    <div class="headline-main">No active event found</div>
    <div class="headline-sub">Checking Alberta competitions every few days.</div>
  `;
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
    </div>
  `).join('');
}

function renderSchedule(scheduleRows, activeGameId) {
  if (!scheduleRows?.length) {
    els.scheduleList.className = 'schedule-list empty';
    els.scheduleList.innerHTML = '<p>No scheduled draws to show.</p>';
    return;
  }
  els.scheduleList.className = 'schedule-list';
  els.scheduleList.innerHTML = scheduleRows.map(row => {
    const cls = row.gameId === activeGameId
      ? 'schedule-row active'
      : row.inferredState === 'upcoming'
        ? 'schedule-row upcoming'
        : 'schedule-row';
    return `
      <div class="${cls}">
        <div>
          <div class="schedule-label">${escapeHtml(row.label)}</div>
          <div class="schedule-meta">${escapeHtml(row.team)} vs ${escapeHtml(row.opponent)}</div>
        </div>
        <div class="schedule-meta">${escapeHtml(row.startsAt)}<br>${escapeHtml(row.stateLabel)}</div>
      </div>
    `;
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
  } else if (view === 'idle-event') {
    els.liveBadge.classList.add('muted');
    els.liveBadge.textContent = 'Waiting';
  } else if (view === 'complete') {
    els.liveBadge.classList.add('complete');
    els.liveBadge.textContent = 'Complete';
  } else {
    els.liveBadge.classList.add('muted');
    els.liveBadge.textContent = 'Idle';
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
  els.nextGameValue.textContent = snapshot?.nextGameLabel || '—';
  els.nextCheckValue.textContent = snapshot?.nextCheckAt ? formatEpochMs(snapshot.nextCheckAt) : '—';
  els.updatedValue.textContent = snapshot?.lastUpdatedLabel || '—';
  els.timelineHint.textContent = snapshot?.timelineHint || 'Waiting for a live game.';
  els.scheduleHint.textContent = snapshot?.scheduleHint || 'No event loaded.';
  renderEnds(snapshot?.ends || []);
  renderSchedule(snapshot?.scheduleRows || [], snapshot?.activeGameId);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function scheduleNextRun(delayMs) {
  if (state.timerId) clearTimeout(state.timerId);
  state.timerId = window.setTimeout(() => runTracker({ reason: 'scheduled' }), Math.max(5_000, delayMs));
}

function computeScanSnapshot(playerName, diagnostics, delayMs, message) {
  const nextCheckAt = Date.now() + delayMs;
  return {
    playerName,
    view: 'idle',
    eventName: 'Searching',
    hammerNext: '—',
    nextGameLabel: '—',
    ends: [],
    scheduleRows: [],
    timelineHint: 'No live game.',
    scheduleHint: 'No matching event loaded.',
    nextCheckAt,
    lastUpdatedLabel: formatClock(new Date()),
    message,
    diagnostics
  };
}

function rankChosenGame(chosen) {
  if (!chosen?.game) return 999;
  if (chosen.inferredState === 'live') return 0;
  if (chosen.inferredState === 'upcoming') return 1;
  if (chosen.inferredState === 'complete') return 2;
  return 3;
}

function chooseBestDiscovery(candidates) {
  const now = Date.now();
  return [...candidates].sort((a, b) => {
    const aChosen = chooseRelevantGame(a.event, a.match.team.id);
    const bChosen = chooseRelevantGame(b.event, b.match.team.id);
    const aRank = rankChosenGame(aChosen);
    const bRank = rankChosenGame(bChosen);
    if (aRank !== bRank) return aRank - bRank;

    const aEpoch = aChosen?.epochMs || Number.MAX_SAFE_INTEGER;
    const bEpoch = bChosen?.epochMs || Number.MAX_SAFE_INTEGER;
    const aWindow = aChosen?.inWindow ? 0 : 1;
    const bWindow = bChosen?.inWindow ? 0 : 1;
    if (aWindow !== bWindow) return aWindow - bWindow;

    const aProx = Math.abs(aEpoch - now);
    const bProx = Math.abs(bEpoch - now);
    if (aProx !== bProx) return aProx - bProx;

    if ((b.match.score || 0) !== (a.match.score || 0)) return (b.match.score || 0) - (a.match.score || 0);
    return (b.event.id || 0) - (a.event.id || 0);
  })[0] || null;
}

async function discoverEventForPlayer(playerName) {
  const norm = normalizeName(playerName);
  const checked = [];
  const candidates = [];

  for (const delta of APP.lookaheadSeasons) {
    const itemsUrl = competitionsUrl(delta);
    const list = await fetchJson(itemsUrl);
    const items = list.items || [];
    checked.push({ delta, itemsCount: items.length, url: itemsUrl });

    for (const item of items) {
      const event = await fetchJson(eventUrl(item.id));
      const match = findMatchingTeam(event, norm);
      if (!match) continue;
      const chosen = chooseRelevantGame(event, match.team.id);
      candidates.push({ item, event, match, chosen });
    }
  }

  const best = chooseBestDiscovery(candidates);
  if (best) {
    return {
      item: best.item,
      event: best.event,
      match: best.match,
      checked,
      candidates: candidates.map(c => ({
        eventId: c.event.id,
        eventName: c.event.name,
        matchedCurler: c.match.curler.name,
        matchedTeam: c.match.team.name,
        matchScore: c.match.score,
        chosenGameId: c.chosen?.game?.id || null,
        chosenGameState: c.chosen?.game?.state || null,
        inferredState: c.chosen?.inferredState || null,
        chosenDrawEpoch: c.chosen?.epochMs || null,
        inWindow: !!c.chosen?.inWindow
      }))
    };
  }

  return { item: null, event: null, match: null, checked, candidates: [] };
}

function buildScheduleRows(event, matchedTeamId, matchedTeamName) {
  const games = flattenGames(event);
  const teamsById = teamMap(event);
  const rows = [];
  for (const game of games) {
    const positions = game.game_positions || [];
    if (!positions.some(pos => pos.team_id === matchedTeamId)) continue;
    const draw = findDrawForGame(event, game.id);
    const oppPos = positions.find(pos => pos.team_id && pos.team_id !== matchedTeamId);
    const oppTeam = teamsById.get(oppPos?.team_id);
    const inferredState = classifyGame(game, draw);
    rows.push({
      gameId: game.id,
      label: draw?.label ? `Draw ${draw.label}` : (game.name || 'Draw'),
      startsAt: draw?.epoch ? formatEpochMs(draw.epoch * 1000) : (draw?.starts_at || 'TBD'),
      state: game.state || 'unknown',
      inferredState,
      stateLabel: inferredState[0].toUpperCase() + inferredState.slice(1),
      team: matchedTeamName,
      opponent: oppTeam?.name || 'TBD',
      epochMs: draw?.epoch ? draw.epoch * 1000 : null
    });
  }
  return rows.sort((a, b) => (a.epochMs || 0) - (b.epochMs || 0));
}

function buildLiveSnapshot(playerName, event, match, chosen, diagnostics) {
  const teamsById = teamMap(event);
  const matchedTeam = match.team;
  const positions = chosen.game.game_positions || [];
  const ourPos = positions.find(pos => pos.team_id === matchedTeam.id) || {};
  const oppPos = positions.find(pos => pos.team_id && pos.team_id !== matchedTeam.id) || {};
  const oppTeam = teamsById.get(oppPos.team_id) || { name: 'TBD' };
  const ends = buildEnds(ourPos, oppPos);
  const firstHammerPos = positions.find(pos => pos.first_hammer);
  const firstHammerTeamName = firstHammerPos?.team_id === matchedTeam.id
    ? matchedTeam.name
    : firstHammerPos?.team_id === oppTeam.id
      ? oppTeam.name
      : 'Unknown';
  const hammerNext = deriveHammer(matchedTeam.name, oppTeam.name, ourPos.end_scores || [], oppPos.end_scores || [], firstHammerTeamName);
  const scheduleRows = buildScheduleRows(event, matchedTeam.id, matchedTeam.name);
  const nextUpcoming = findNextUpcomingRow(scheduleRows, chosen.game.id);
  const nextCheckAt = Date.now() + APP.activeRefreshMs;
  const currentEndNum = Math.max((ourPos.end_scores || []).length, (oppPos.end_scores || []).length) + (chosen.inferredState === 'live' ? 1 : 0);

  return {
    playerName,
    view: chosen.inferredState === 'live' ? 'live' : 'idle-event',
    teamName: matchedTeam.name,
    opponentName: oppTeam.name,
    teamScore: Number(ourPos.score ?? sumEnds(ourPos.end_scores || [])),
    opponentScore: Number(oppPos.score ?? sumEnds(oppPos.end_scores || [])),
    currentEndLabel: chosen.inferredState === 'live' ? `${currentEndNum}${ordinalSuffix(currentEndNum)} end` : 'Game complete',
    hammerNext,
    eventName: event.name,
    drawLabel: chosen.draw?.label ? `Draw ${chosen.draw.label}` : chosen.draw?.starts_at || chosen.game.stageName || '',
    stageName: chosen.game.stageName,
    ends,
    scheduleRows,
    nextGameLabel: nextUpcoming ? `${nextUpcoming.startsAt} · vs ${nextUpcoming.opponent}` : '—',
    nextDrawLabel: nextUpcoming ? nextUpcoming.startsAt : 'TBD',
    activeGameId: chosen.game.id,
    timelineHint: chosen.inferredState === 'live' ? 'Updates after each end.' : 'Latest posted end scores.',
    scheduleHint: 'Only checking around this curler’s scheduled draws.',
    nextCheckAt,
    lastUpdatedLabel: formatClock(new Date()),
    diagnostics,
    eventId: event.id
  };
}

function ordinalSuffix(n) {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

function chooseNextRelevantCheck(chosen, scheduleRows) {
  const now = Date.now();
  if (chosen?.inferredState === 'live') {
    return { delayMs: APP.activeRefreshMs, reason: 'live game refresh' };
  }

  const nextUpcoming = scheduleRows
    .filter(row => row.epochMs && row.epochMs > now)
    .sort((a, b) => a.epochMs - b.epochMs)[0];

  if (nextUpcoming) {
    const preWindow = nextUpcoming.epochMs - APP.preGameWindowMs;
    if (preWindow > now) {
      return { delayMs: preWindow - now, reason: 'sleep until pre-game window' };
    }
    return { delayMs: APP.upcomingRefreshMs, reason: 'pre-game monitoring' };
  }

  return { delayMs: APP.idleScanMs, reason: 'event complete, resume periodic scans' };
}

async function runTracker({ reason }) {
  if (!state.playerName) return;
  state.lastRunAt = Date.now();
  setStatus(`Checking for ${state.playerName}…`);

  try {
    const discovery = await discoverEventForPlayer(state.playerName);

    if (!discovery.event || !discovery.match) {
      const diagnostics = {
        phase: 'no-match',
        playerName: state.playerName,
        checked: discovery.checked,
        candidates: discovery.candidates,
        reason,
        policy: 'Idle scans every 72 hours until a matching event appears.'
      };
      setDiagnostics(diagnostics);
      const snapshot = computeScanSnapshot(state.playerName, diagnostics, APP.idleScanMs, 'No active event found.');
      snapshot.scheduleHint = 'Scanning Alberta competitions every 72 hours.';
      snapshot.eventName = 'No active event found';
      render(snapshot);
      setStatus(`No current Alberta event found for ${state.playerName}. Next scan in about 72 hours.`);
      scheduleNextRun(APP.idleScanMs);
      return;
    }

    const chosen = chooseRelevantGame(discovery.event, discovery.match.team.id);
    const scheduleRows = buildScheduleRows(discovery.event, discovery.match.team.id, discovery.match.team.name);
    const nextUpcoming = findNextUpcomingRow(scheduleRows, chosen?.game?.id || null);
    const nextCheck = chooseNextRelevantCheck(chosen, scheduleRows);

    const diagnostics = {
      phase: 'matched',
      reason,
      playerName: state.playerName,
      matchedCurler: discovery.match.curler.name,
      matchedTeam: discovery.match.team.name,
      matchScore: discovery.match.score,
      eventId: discovery.event.id,
      eventName: discovery.event.name,
      chosenGameId: chosen?.game?.id || null,
      chosenGameState: chosen?.game?.state || null,
      inferredState: chosen?.inferredState || null,
      chosenDrawEpoch: chosen?.epochMs || null,
      nextGame: nextUpcoming ? { gameId: nextUpcoming.gameId, startsAt: nextUpcoming.startsAt, opponent: nextUpcoming.opponent } : null,
      nextCheckReason: nextCheck.reason,
      checked: discovery.checked,
      candidates: discovery.candidates
    };
    setDiagnostics(diagnostics);

    if (!chosen) {
      const snapshot = {
        playerName: state.playerName,
        view: 'idle-event',
        eventName: discovery.event.name,
        hammerNext: '—',
        nextGameLabel: nextUpcoming ? `${nextUpcoming.startsAt} · vs ${nextUpcoming.opponent}` : '—',
        ends: [],
        scheduleRows,
        timelineHint: 'No game selected yet.',
        scheduleHint: 'Only checking around this curler’s scheduled draws.',
        nextCheckAt: Date.now() + nextCheck.delayMs,
        lastUpdatedLabel: formatClock(new Date()),
        diagnostics,
        eventId: discovery.event.id
      };
      render(snapshot);
      setStatus(`Matched ${discovery.match.curler.name} in ${discovery.event.name}. Sleeping until the next draw window.`);
      scheduleNextRun(nextCheck.delayMs);
      return;
    }

    const snapshot = buildLiveSnapshot(state.playerName, discovery.event, discovery.match, chosen, diagnostics);
    snapshot.scheduleRows = scheduleRows;
    snapshot.nextCheckAt = Date.now() + nextCheck.delayMs;
    snapshot.scheduleHint = 'Only checking during this curler’s draw windows.';
    if (chosen.inferredState !== 'live') {
      snapshot.view = chosen.inferredState === 'upcoming' ? 'upcoming' : 'idle-event';
      snapshot.currentEndLabel = chosen.draw?.starts_at || 'Upcoming draw';
      snapshot.timelineHint = chosen.inferredState === 'complete' ? 'Latest posted end scores.' : 'Waiting for the draw to begin.';
      snapshot.nextDrawLabel = nextUpcoming?.startsAt || chosen.draw?.starts_at || 'TBD';
    }

    render(snapshot);
    if (chosen.inferredState === 'live') {
      setStatus(`${discovery.match.curler.name} is live in ${discovery.event.name}. Refreshing every 60 seconds.`);
    } else if (chosen.inferredState === 'upcoming') {
      setStatus(`Matched ${discovery.match.curler.name} in ${discovery.event.name}. Monitoring only around the scheduled draw.`);
    } else {
      setStatus(`Latest event found for ${discovery.match.curler.name}. No live draw right now.`);
    }
    scheduleNextRun(nextCheck.delayMs);
  } catch (error) {
    const diagnostics = {
      phase: 'error',
      playerName: state.playerName,
      reason,
      error: error.message
    };
    setDiagnostics(diagnostics);
    const snapshot = computeScanSnapshot(state.playerName, diagnostics, APP.errorRetryMs, 'Temporary fetch error.');
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
  const recentlyRan = now - state.lastRunAt < 15_000;
  if (trigger === 'visible') {
    const recentlyVisibilityScanned = now - state.lastVisibilityScanAt < 60_000;
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

window.addEventListener('pageshow', () => {
  maybeRunOpenScan('pageshow');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    maybeRunOpenScan('visible');
  }
});

window.addEventListener('focus', () => {
  maybeRunOpenScan('focus');
});

bootFromSavedState();
