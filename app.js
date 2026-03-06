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
  diagnostics: {
    phase: 'idle'
  },
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

function arraysEqual(a = [], b = []) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
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

function findDrawForGame(event, gameId) {
  return (event.draws || []).find(draw => Array.isArray(draw.draw_sheets) && draw.draw_sheets.includes(gameId)) || null;
}

function chooseRelevantGame(event, matchedTeamId) {
  const now = Date.now();
  const games = flattenGames(event)
    .map(game => {
      const draw = findDrawForGame(event, game.id);
      const includesTeam = (game.game_positions || []).some(pos => pos.team_id === matchedTeamId);
      if (!includesTeam) return null;
      const epochMs = draw?.epoch ? draw.epoch * 1000 : null;
      const stateRank = game.state === 'playing' ? 0 : game.state === 'pending' ? 1 : game.state === 'complete' ? 2 : 3;
      const proximity = epochMs ? Math.abs(epochMs - now) : Number.MAX_SAFE_INTEGER;
      return { game, draw, epochMs, stateRank, proximity };
    })
    .filter(Boolean)
    .sort((a, b) => a.stateRank - b.stateRank || a.proximity - b.proximity || (a.epochMs || 0) - (b.epochMs || 0));

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
    if (teamVal === 0 && oppVal === 0 && i >= Math.max(teamEnds.length, oppEnds.length)) continue;
    rows.push({ end: i + 1, team: teamVal, opponent: oppVal });
  }
  while (rows.length && rows[rows.length - 1].team === 0 && rows[rows.length - 1].opponent === 0) {
    const row = rows[rows.length - 1];
    const sourceIndex = row.end - 1;
    const hadSource = sourceIndex < teamEnds.length || sourceIndex < oppEnds.length;
    if (hadSource) break;
    rows.pop();
  }
  return rows;
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
    const cls = row.gameId === activeGameId ? 'schedule-row active' : row.state === 'pending' ? 'schedule-row upcoming' : 'schedule-row';
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

async function discoverEventForPlayer(playerName) {
  const norm = normalizeName(playerName);
  const checked = [];

  for (const delta of APP.lookaheadSeasons) {
    const itemsUrl = competitionsUrl(delta);
    const list = await fetchJson(itemsUrl);
    const items = list.items || [];
    checked.push({ delta, itemsCount: items.length, url: itemsUrl });

    // Prioritize upcoming/current by scanning in listed order and then reverse if needed.
    const prioritized = [...items].reverse();
    for (const item of prioritized) {
      const event = await fetchJson(eventUrl(item.id));
      const match = findMatchingTeam(event, norm);
      if (!match) continue;
      return {
        item,
        event,
        match,
        checked
      };
    }
  }
  return { item: null, event: null, match: null, checked };
}

function buildScheduleRows(event, matchedTeamId, matchedTeamName) {
  const games = flattenGames(event);
  const teamsById = teamMap(event);
  const rows = [];
  for (const game of games) {
    const positions = game.game_positions || [];
    if (!positions.some(pos => pos.team_id === matchedTeamId)) continue;
    const draw = findDrawForGame(event, game.id);
    const ourPos = positions.find(pos => pos.team_id === matchedTeamId);
    const oppPos = positions.find(pos => pos.team_id && pos.team_id !== matchedTeamId);
    const oppTeam = teamsById.get(oppPos?.team_id);
    rows.push({
      gameId: game.id,
      label: draw?.label ? `Draw ${draw.label}` : (game.name || 'Draw'),
      startsAt: draw?.epoch ? formatEpochMs(draw.epoch * 1000) : (draw?.starts_at || 'TBD'),
      state: game.state || 'unknown',
      stateLabel: game.state ? game.state[0].toUpperCase() + game.state.slice(1) : 'Unknown',
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
  const firstHammerTeamName = positions.find(pos => pos.first_hammer)?.team_id === matchedTeam.id
    ? matchedTeam.name
    : positions.find(pos => pos.first_hammer)?.team_id === oppTeam.id
      ? oppTeam.name
      : 'Unknown';
  const hammerNext = deriveHammer(matchedTeam.name, oppTeam.name, ourPos.end_scores || [], oppPos.end_scores || [], firstHammerTeamName);
  const scheduleRows = buildScheduleRows(event, matchedTeam.id, matchedTeam.name);
  const nextCheckAt = Date.now() + APP.activeRefreshMs;
  const currentEndNum = Math.max((ourPos.end_scores || []).length, (oppPos.end_scores || []).length) + (chosen.game.state === 'playing' ? 1 : 0);

  return {
    playerName,
    view: chosen.game.state === 'playing' ? 'live' : 'idle-event',
    teamName: matchedTeam.name,
    opponentName: oppTeam.name,
    teamScore: Number(ourPos.score ?? 0),
    opponentScore: Number(oppPos.score ?? 0),
    currentEndLabel: chosen.game.state === 'playing' ? `${currentEndNum}${ordinalSuffix(currentEndNum)} end` : 'Game complete',
    hammerNext,
    eventName: event.name,
    drawLabel: chosen.draw?.label ? `Draw ${chosen.draw.label}` : chosen.draw?.starts_at || chosen.stageName || '',
    stageName: chosen.game.stageName,
    ends,
    scheduleRows,
    activeGameId: chosen.game.id,
    timelineHint: chosen.game.state === 'playing' ? 'Updates after each end.' : 'Latest posted end scores.',
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
  if (chosen?.game?.state === 'playing') {
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
      nextCheckReason: nextCheck.reason,
      checked: discovery.checked
    };
    setDiagnostics(diagnostics);

    if (!chosen) {
      const snapshot = {
        playerName: state.playerName,
        view: 'idle-event',
        eventName: discovery.event.name,
        hammerNext: '—',
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
    if (chosen.game.state !== 'playing') {
      snapshot.view = chosen.game.state === 'complete' ? 'idle-event' : 'upcoming';
      snapshot.currentEndLabel = chosen.draw?.starts_at || 'Upcoming draw';
      snapshot.timelineHint = chosen.game.state === 'complete' ? 'Latest posted end scores.' : 'Waiting for the draw to begin.';
    }

    render(snapshot);
    if (chosen.game.state === 'playing') {
      setStatus(`${discovery.match.curler.name} is live in ${discovery.event.name}. Refreshing every 60 seconds.`);
    } else if (chosen.game.state === 'pending') {
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
