/* Play Nine — Table view (spectator) only */
(function () {
  const pathParts = window.location.pathname.split('/');
  const tableName = pathParts[pathParts.length - 1];
  const Play9 = window.Play9;

  if (tableName) {
    try {
      localStorage.setItem('play9_last_table', tableName);
    } catch (_) {}
  }

  const gameSection = document.getElementById('game-section');

  function showErrorDialog(message) {
    const dialog = document.getElementById('error-dialog');
    const msgEl = document.getElementById('error-dialog-message');
    if (!dialog || !msgEl) return;
    msgEl.textContent = message;
    dialog.hidden = false;
  }

  function closeErrorDialog() {
    const dialog = document.getElementById('error-dialog');
    if (dialog) dialog.hidden = true;
  }

  function getWsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/play9/ws/${tableName}`;
  }

  let ws = null;
  let reconnectTimer = null;
  let pingTimer = null;
  let inactiveTurnCountdown = null;
  let lastStateForInactive = null;
  const RECONNECT_DELAY = 3000;
  const HEARTBEAT_INTERVAL = 5000;

  function sendAction(action) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  }

  const INACTIVE_LEAVE_TIMEOUT = 60;

  function computeInactiveSecondsRemaining(playerLastActive, currentPlayerId) {
    if (!playerLastActive || !currentPlayerId) return null;
    const lastEpoch = playerLastActive[currentPlayerId];
    if (lastEpoch == null || typeof lastEpoch !== 'number') return null;
    const elapsed = (Date.now() / 1000) - lastEpoch;
    const remaining = Math.floor(INACTIVE_LEAVE_TIMEOUT - elapsed);
    return remaining > 0 ? remaining : 0;
  }

  function updateInactiveTurnFlyover(state) {
    const flyover = document.getElementById('inactive-turn-flyover');
    const nameEl = document.getElementById('inactive-turn-name');
    const secondsEl = document.getElementById('inactive-turn-seconds');
    if (!flyover || !nameEl || !secondsEl) return;
    const playerIds = state.players || [];
    const idx = state.current_player_idx;
    const currentPlayer = (idx != null && idx >= 0 && idx < playerIds.length) ? playerIds[idx] : null;
    const currentPlayerId = currentPlayer && currentPlayer.id;
    const remaining = computeInactiveSecondsRemaining(state.player_last_active, currentPlayerId);
    const show = state.inactive_turn_name != null && remaining != null && remaining > 0;
    if (show) {
      nameEl.textContent = state.inactive_turn_name;
      secondsEl.textContent = String(remaining);
      flyover.hidden = false;
      if (!inactiveTurnCountdown) {
        inactiveTurnCountdown = setInterval(function () {
          const s = lastStateForInactive;
          const pid = s && s.players && s.current_player_idx != null ? (s.players[s.current_player_idx] || {}).id : null;
          const r = computeInactiveSecondsRemaining(s && s.player_last_active, pid);
          const el = document.getElementById('inactive-turn-seconds');
          if (!el || r == null || r <= 0) {
            if (inactiveTurnCountdown) {
              clearInterval(inactiveTurnCountdown);
              inactiveTurnCountdown = null;
            }
            return;
          }
          el.textContent = String(r);
        }, 1000);
      }
    } else {
      flyover.hidden = true;
      if (inactiveTurnCountdown) {
        clearInterval(inactiveTurnCountdown);
        inactiveTurnCountdown = null;
      }
    }
  }

  function applyState(state) {
    lastStateForInactive = state;
    if (state.phase !== 'scoring') {
      const flyover = document.getElementById('score-flyover');
      if (flyover) flyover.hidden = true;
    }
    updateInactiveTurnFlyover(state);
    gameSection.hidden = false;
    Play9.updateGameTitle(state);
    renderGame(state);
  }

  function renderGame(state) {
    const tableLayout = document.getElementById('table-layout');
    const playerLayout = document.getElementById('player-layout');
    tableLayout.innerHTML = '';
    playerLayout.innerHTML = '';

    if (state.phase === 'scoring') {
      Play9.renderRoundComplete(state, tableLayout, playerLayout, null, null, sendAction, null);
      Play9.showScoreFlyover(state, sendAction);
      return;
    }
    Play9.renderTableView(state, tableLayout);
  }

  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    ws = new WebSocket(getWsUrl());
    ws.onopen = function () {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) sendAction({ type: 'heartbeat' });
      }, HEARTBEAT_INTERVAL);
    };
    ws.onmessage = function (ev) {
      try {
        const data = JSON.parse(ev.data);
        if (data.error) {
          if (data.error !== 'Not a player at this table') {
            showErrorDialog(data.error);
          }
          return;
        }
        applyState(data);
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    };
    ws.onclose = function () {
      ws = null;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
      }
    };
    ws.onerror = function () {
      ws.close();
    };
  }

  document.getElementById('leave-game')?.addEventListener('click', function () {
    window.location.href = '/play9';
  });

  document.getElementById('error-dialog-ok')?.addEventListener('click', closeErrorDialog);
  document.getElementById('error-dialog')?.querySelector('.confirm-dialog-backdrop')?.addEventListener('click', closeErrorDialog);

  connect();
  fetch(`/play9/api/table/${tableName}`).then(r => r.json()).then(applyState);
})();
