(function () {
  const pathParts = window.location.pathname.split('/');
  const tableName = pathParts[pathParts.length - 1];
  const params = new URLSearchParams(window.location.search);
  const playerId = params.get('id');

  const tableDisplay = document.getElementById('table-display');
  const playerList = document.getElementById('player-list');
  const startBtn = document.getElementById('start-game');
  const leaveBtn = document.getElementById('leave-table');
  const waitingRoom = document.getElementById('waiting-room');
  const gameSection = document.getElementById('game-section');
  const startHint = document.getElementById('start-hint');

  tableDisplay.textContent = tableName;
  if (!playerId) {
    startHint.hidden = true;
  }

  function getWsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${proto}//${window.location.host}/play9/ws/${tableName}`;
    if (playerId) url += `?id=${encodeURIComponent(playerId)}`;
    return url;
  }

  function renderPlayers(players) {
    playerList.innerHTML = (players || []).map(p => `<li>${escapeHtml(p.name)}</li>`).join('');
    const isPlayer = !!playerId;
    startBtn.disabled = !isPlayer || !players || players.length < 2;
    startBtn.hidden = !isPlayer;
    if (startHint) startHint.hidden = !isPlayer;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function applyState(state) {
    if (state.phase === 'empty' || !state.players) {
      renderPlayers([]);
    } else {
      renderPlayers(state.players);
      if (state.phase !== 'waiting') {
        waitingRoom.hidden = true;
        gameSection.hidden = false;
        renderGame(state);
      }
    }
  }

  function renderGame(state) {
    const tableLayout = document.getElementById('table-layout');
    const playerLayout = document.getElementById('player-layout');
    const me = playerId ? state.players.find(p => p.id === playerId) : null;

    tableLayout.innerHTML = '';
    playerLayout.innerHTML = '';

    const phaseLabel = state.phase === 'reveal' ? 'Reveal 2 cards' : 'Play';
    const roundLabel = `Round ${state.round_num}`;

    if (me && (state.phase === 'reveal' || state.phase === 'play')) {
      const title = document.createElement('h3');
      title.textContent = `${roundLabel} — ${phaseLabel}`;
      playerLayout.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'card-grid';
      me.hand.forEach((card, i) => {
        const el = document.createElement('div');
        el.className = 'card' + (card.face_up ? ' face-up' : ' face-down');
        el.dataset.index = String(i);
        if (card.face_up) {
          el.textContent = card.value;
        } else {
          el.textContent = '?';
        }
        const canFlip = state.phase === 'reveal' && !card.face_up && me.revealed_count < 2;
        if (canFlip) {
          el.classList.add('clickable');
          el.addEventListener('click', () => flipCard(i));
        }
        grid.appendChild(el);
      });
      playerLayout.appendChild(grid);

      if (state.phase === 'reveal') {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = `Tap 2 cards to reveal (${me.revealed_count}/2)`;
        playerLayout.appendChild(hint);
      }
    } else {
      const msg = document.createElement('p');
      msg.textContent = playerId ? 'Waiting for game…' : `${roundLabel} — ${phaseLabel}`;
      playerLayout.appendChild(msg);
    }
  }

  let ws = null;
  let reconnectTimer = null;
  let pingTimer = null;
  const RECONNECT_DELAY = 3000;
  const PING_INTERVAL = 20000;

  function sendAction(action) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  }

  function flipCard(index) {
    if (!playerId) return;
    sendAction({ type: 'reveal', card_index: index });
  }

  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    ws = new WebSocket(getWsUrl());
    ws.onopen = function () {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      startPing();
    };
    ws.onmessage = function (ev) {
      try {
        const data = JSON.parse(ev.data);
        if (data.error) {
          if (data.error !== 'Not a player at this table') {
            alert(data.error);
          }
          if (waitingRoom && !waitingRoom.hidden) {
            startBtn.disabled = false;
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
      stopPing();
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
      }
    };
    ws.onerror = function () {
      ws.close();
    };
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendAction({ type: 'ping' });
      }
    }, PING_INTERVAL);
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  async function doLeave() {
    if (playerId) {
      try {
        await fetch('/play9/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table_name: tableName, player_id: playerId }),
        });
      } catch (e) {
        console.error('Leave failed:', e);
      }
    }
    window.location.href = '/play9';
  }

  leaveBtn.addEventListener('click', doLeave);

  document.getElementById('leave-game')?.addEventListener('click', doLeave);

  startBtn.addEventListener('click', function () {
    if (!playerId) return;
    startBtn.disabled = true;
    sendAction({ type: 'start' });
  });

  connect();
  fetch(`/play9/api/table/${tableName}`).then(r => r.json()).then(applyState);
})();
