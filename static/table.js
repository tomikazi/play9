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

  function getWsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/play9/ws/${tableName}`;
  }

  let ws = null;
  let reconnectTimer = null;
  let pingTimer = null;
  const RECONNECT_DELAY = 3000;
  const HEARTBEAT_INTERVAL = 5000;

  function sendAction(action) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  }

  function applyState(state) {
    if (state.phase !== 'scoring') {
      const flyover = document.getElementById('score-flyover');
      if (flyover) flyover.hidden = true;
    }
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
          if (data.error !== 'Not a player at this table') alert(data.error);
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

  connect();
  fetch(`/play9/api/table/${tableName}`).then(r => r.json()).then(applyState);
})();
