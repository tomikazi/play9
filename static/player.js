/* Play Nine — Player view only */
(function () {
  const pathParts = window.location.pathname.split('/');
  const tableName = pathParts[pathParts.length - 1];
  const params = new URLSearchParams(window.location.search);
  const playerId = params.get('id');
  const Play9 = window.Play9;

  if (tableName) {
    try {
      localStorage.setItem('play9_last_table', tableName);
    } catch (_) {}
  }

  const gameSection = document.getElementById('game-section');
  const waitingRoomDialog = document.getElementById('waiting-room-dialog');
  const waitingDialogPlayerList = document.getElementById('waiting-dialog-player-list');
  const startBtn = document.getElementById('start-game');
  const waitingLeaveBtn = document.getElementById('waiting-leave-btn');

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
    return `${proto}//${window.location.host}/play9/ws/${tableName}?id=${encodeURIComponent(playerId)}`;
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

  let lastStateForInactive = null;

  function updateInactiveTurnFlyover(state) {
    const flyover = document.getElementById('inactive-turn-flyover');
    const nameEl = document.getElementById('inactive-turn-name');
    const secondsEl = document.getElementById('inactive-turn-seconds');
    if (!flyover || !nameEl || !secondsEl) return;
    lastStateForInactive = state;
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

  let lastDismissedRestartAt = null;
  let restartVoteTimer = null;
  const RESTART_VOTE_TIMEOUT_MS = 30000;

  let restartVoteTimerRequestedAt = null;

  function updateRestartVoteDialog(state) {
    const dialog = document.getElementById('restart-vote-dialog');
    const requesterEl = document.getElementById('restart-vote-requester');
    if (!dialog || !requesterEl) return;
    const requestedBy = state.restart_requested_by;
    const requestedAt = state.restart_requested_at;
    const yesVotes = new Set(state.restart_yes_votes || []);
    const show = requestedBy && requestedAt != null && playerId && !yesVotes.has(playerId) &&
      (lastDismissedRestartAt == null || requestedAt > lastDismissedRestartAt);
    if (!show) {
      if (restartVoteTimer) {
        clearTimeout(restartVoteTimer);
        restartVoteTimer = null;
        restartVoteTimerRequestedAt = null;
      }
      dialog.hidden = true;
      return;
    }
    requesterEl.textContent = requestedBy;
    dialog.hidden = false;
    if (restartVoteTimer && restartVoteTimerRequestedAt === requestedAt) {
      return;
    }
    if (restartVoteTimer) {
      clearTimeout(restartVoteTimer);
    }
    restartVoteTimerRequestedAt = requestedAt;
    restartVoteTimer = setTimeout(function () {
      restartVoteTimer = null;
      restartVoteTimerRequestedAt = null;
      lastDismissedRestartAt = lastStateForInactive?.restart_requested_at ?? Date.now() / 1000;
      sendAction({ type: 'vote_restart_no' });
      if (dialog) dialog.hidden = true;
    }, RESTART_VOTE_TIMEOUT_MS);
  }

  function updateWaitingDialog(players, activePlayerIds) {
    if (!waitingDialogPlayerList) return;
    const active = new Set(activePlayerIds || []);
    waitingDialogPlayerList.innerHTML = (players || []).map(p => {
      const display = active.has(p.id) ? p.name : p.name + ' \u{1F634}';
      return `<li>${Play9.escapeHtml(display)}</li>`;
    }).join('');
    if (startBtn) startBtn.disabled = !players || players.length < 2;
  }

  function syncCardSizeFromSpread() {
    const card = document.querySelector('body.player-view-mode .player-view-bottom .card-grid .card');
    if (card) {
      const rect = card.getBoundingClientRect();
      document.documentElement.style.setProperty('--player-card-height', rect.height + 'px');
      document.documentElement.style.setProperty('--player-card-width', rect.width + 'px');
    }
  }

  let ws = null;
  let reconnectTimer = null;
  let pingTimer = null;
  let dragState = null;
  let inactiveTurnCountdown = null;
  const RECONNECT_DELAY = 3000;
  const HEARTBEAT_INTERVAL = 5000;
  const DRAG_THRESHOLD = 5;

  function sendAction(action) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  }

  function flipCard(index) {
    sendAction({ type: 'reveal', card_index: index });
  }

  function createDragGhost(value) {
    const ghost = document.createElement('div');
    const isBack = value == null;
    ghost.className = 'drag-ghost card ' + (isBack ? 'face-down' : 'face-up');
    ghost.textContent = isBack ? '' : String(value);
    ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;opacity:0.95;';
    document.body.appendChild(ghost);
    return ghost;
  }

  function setupDragSource(el, source, knownValue, state) {
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      el.style.touchAction = 'none';
      const rect = el.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      let dragStarted = false;
      let ghost = null;
      const w = rect.width;
      const h = rect.height;
      const onMove = function (e) {
        if (dragStarted && dragState) {
          dragState.ghost.style.left = (e.clientX - w / 2) + 'px';
          dragState.ghost.style.top = (e.clientY - h) + 'px';
          return;
        }
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD) {
          dragStarted = true;
          if (source === 'draw') sendAction({ type: 'draw_from_draw' });
          else if (source === 'discard') sendAction({ type: 'draw_from_discard' });
          ghost = createDragGhost(knownValue);
          ghost.style.width = w + 'px';
          ghost.style.height = h + 'px';
          ghost.style.left = (e.clientX - w / 2) + 'px';
          ghost.style.top = (e.clientY - h) + 'px';
          dragState = { source, drawnFrom: source === 'draw' ? 'draw' : 'discard', cardValue: knownValue, ghost };
        }
      };
      const onUp = function (e) {
        if (dragStarted && dragState) {
          ghost.style.visibility = 'hidden';
          const target = document.elementFromPoint(e.clientX, e.clientY);
          ghost.style.visibility = '';
          const dropEl = target?.closest('[data-drop-type]');
          if (dropEl) {
            const dropType = dropEl.dataset.dropType;
            if (dropType === 'hand') {
              sendAction({ type: 'play_replace', card_index: parseInt(dropEl.dataset.cardIndex, 10) });
            } else if (dropType === 'discard') {
              if (dragState.drawnFrom === 'draw') sendAction({ type: 'play_discard_only' });
              else if (dragState.drawnFrom === 'discard') sendAction({ type: 'play_put_back' });
            }
          }
          dragState.ghost.remove();
          dragState = null;
        }
        el.style.touchAction = '';
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  function applyState(state) {
    if (state.phase !== 'scoring') {
      const flyover = document.getElementById('score-flyover');
      if (flyover) flyover.hidden = true;
    }
    updateWaitingDialog(state.players || [], state.active_player_ids || []);
    updateRestartVoteDialog(state);
    updateInactiveTurnFlyover(state);
    const showWaitingRoom = state.phase === 'waiting' || state.phase === 'empty';
    if (showWaitingRoom) {
      gameSection.hidden = false;
      Play9.updateGameTitle(state);
      renderGame(state);
      if (waitingRoomDialog) waitingRoomDialog.hidden = false;
    } else {
      if (waitingRoomDialog) waitingRoomDialog.hidden = true;
      gameSection.hidden = false;
      Play9.updateGameTitle(state);
      renderGame(state);
    }
  }

  function applyStateWithDragUpdate(state) {
    if (dragState && state.drawn_card && dragState.source === 'draw') {
      dragState.cardValue = state.drawn_card.value;
      dragState.drawnFrom = state.drawn_from;
      if (dragState.ghost) {
        dragState.ghost.classList.remove('face-down');
        dragState.ghost.classList.add('face-up');
        dragState.ghost.textContent = Play9.isCardValueKnown(state.drawn_card.value) ? String(state.drawn_card.value) : '';
      }
    }
    applyState(state);
  }

  function renderGame(state) {
    const tableLayout = document.getElementById('table-layout');
    const playerLayout = document.getElementById('player-layout');
    const me = state.players?.find(p => p.id === playerId) || null;

    tableLayout.innerHTML = '';
    playerLayout.innerHTML = '';

    document.body.classList.add('player-view-mode');
    document.body.classList.remove('table-view-mode');

    if (state.phase === 'scoring') {
      Play9.renderRoundComplete(state, tableLayout, playerLayout, me, playerId, sendAction, syncCardSizeFromSpread);
      Play9.showScoreFlyover(state, sendAction);
      return;
    }

    if (state.phase === 'waiting' || state.phase === 'empty') {
      Play9.renderTableView(state, tableLayout);
      return;
    }

    if (me && (state.phase === 'reveal' || state.phase === 'play')) {
      const isMyTurn = state.phase === 'play' && state.players[state.current_player_idx]?.id === playerId;
      const hasDrawn = !!state.drawn_card;

      const wrapper = document.createElement('div');
      wrapper.className = 'player-view';
      if (state.phase === 'play' && state.drawn_card && !isMyTurn) wrapper.classList.add('show-drawn-card');

      const top = document.createElement('div');
      top.className = 'player-view-top';
      if (state.phase === 'reveal' || state.phase === 'play') {
        const pilesWrap = document.createElement('div');
        pilesWrap.className = 'player-view-piles-wrap';
        const piles = document.createElement('div');
        piles.className = 'player-view-piles';
        const drawHighlight = state.phase === 'play' && isMyTurn && !hasDrawn && !state.must_flip_after_discard;
        const discardHighlight = drawHighlight || (state.phase === 'play' && isMyTurn && hasDrawn);
        const drawClickable = state.phase === 'play' && isMyTurn && !hasDrawn && !state.must_flip_after_discard && (state.draw_pile_count ?? 0) > 0;
        const discardClickable = state.phase === 'play' && isMyTurn && !hasDrawn && !state.must_flip_after_discard && (state.discard_pile_count ?? 0) > 0;
        const topDiscardValue = state.discard_pile_top?.[0];

        const drawPileEl = Play9.createStackedDrawPile(state.draw_pile_count ?? 0, { variant: 'player', highlight: drawHighlight, clickable: !!drawClickable });
        const discardPileEl = Play9.createStackedDiscardPile(state.discard_pile_count ?? 0, state.discard_pile_top ?? [], { variant: 'player', highlight: discardHighlight, clickable: !!discardClickable });
        if (discardHighlight && hasDrawn) discardPileEl.dataset.dropType = 'discard';
        if (drawClickable) setupDragSource(drawPileEl, 'draw', null, state);
        if (discardClickable) setupDragSource(discardPileEl, 'discard', topDiscardValue, state);
        piles.appendChild(drawPileEl);
        piles.appendChild(discardPileEl);
        if (state.phase === 'play' && state.drawn_card && !isMyTurn) {
          const floatingCard = document.createElement('div');
          const known = Play9.isCardValueKnown(state.drawn_card.value);
          floatingCard.className = 'player-view-drawn-card card highlight ' + (known ? 'face-up' : 'face-down');
          floatingCard.textContent = known ? String(state.drawn_card.value) : '';
          pilesWrap.appendChild(floatingCard);
        }
        pilesWrap.appendChild(piles);
        top.appendChild(pilesWrap);
      }
      wrapper.appendChild(top);

      const center = document.createElement('div');
      center.className = 'player-view-center';
      if (state.phase === 'play') {
        const allFaceUp = me.hand.every(c => c.face_up);
        if (allFaceUp) {
          const msg = document.createElement('p');
          msg.className = 'center-instruction center-instruction-score';
          msg.textContent = String(state.round_scores?.[me.id] ?? Play9.scoreHand(me.hand));
          center.appendChild(msg);
        } else {
          const mustFlip = !!state.must_flip_after_discard;
          if (mustFlip && isMyTurn) {
            const m = document.createElement('p');
            m.className = 'center-instruction';
            m.textContent = 'Flip a card';
            center.appendChild(m);
          } else if (!isMyTurn) {
            const m = document.createElement('p');
            m.className = 'center-instruction center-instruction-wait';
            m.textContent = 'Wait your turn';
            center.appendChild(m);
          } else if (isMyTurn && !hasDrawn) {
            const m = document.createElement('p');
            m.className = 'center-instruction';
            m.textContent = 'Draw your card';
            center.appendChild(m);
          }
        }
      } else if (state.phase === 'reveal') {
        const m = document.createElement('p');
        m.className = 'center-instruction';
        m.textContent = 'Reveal 2 of your cards';
        center.appendChild(m);
      }
      wrapper.appendChild(center);

      const bottom = document.createElement('div');
      bottom.className = 'player-view-bottom';
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      me.hand.forEach((card, i) => {
        const el = document.createElement('div');
        let cls = 'card' + (card.face_up ? ' face-up' : ' face-down');
        if (Play9.isLastAffectedCard(state, me.id, i)) cls += ' last-affected';
        el.className = cls;
        el.textContent = card.face_up && Play9.isCardValueKnown(card.value) ? card.value : '';
        if (state.phase === 'reveal') {
          const canFlip = !card.face_up && me.revealed_count < 2;
          if (canFlip) {
            el.classList.add('clickable');
            el.addEventListener('click', () => flipCard(i));
          }
        } else if (state.phase === 'play' && isMyTurn) {
          if (state.must_flip_after_discard) {
            if (!card.face_up) {
              el.classList.add('clickable', 'highlight');
              el.addEventListener('click', () => sendAction({ type: 'play_flip_after_discard', card_index: i }));
            }
          } else if (hasDrawn) {
            el.classList.add('clickable', 'highlight');
            el.dataset.dropType = 'hand';
            el.dataset.cardIndex = String(i);
            el.addEventListener('click', () => sendAction({ type: 'play_replace', card_index: i }));
          }
        }
        grid.appendChild(el);
      });
      bottom.appendChild(grid);
      wrapper.appendChild(bottom);
      playerLayout.appendChild(wrapper);
      requestAnimationFrame(() => requestAnimationFrame(syncCardSizeFromSpread));
    } else {
      const msg = document.createElement('p');
      msg.textContent = 'Waiting…';
      playerLayout.appendChild(msg);
    }
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
          if (data.error === 'Player already connected elsewhere') {
            document.getElementById('already-connected-dialog').hidden = false;
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
            ws = null;
            return;
          }
          if (data.error === 'Game already started') {
            sendAction({ type: 'request_restart' });
            return;
          }
          if (data.error !== 'Not a player at this table' && data.error !== 'Card already face-up') {
            showErrorDialog(data.error);
          }
          if (waitingRoomDialog && !waitingRoomDialog.hidden && startBtn) startBtn.disabled = false;
          return;
        }
        applyStateWithDragUpdate(data);
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    };
    ws.onclose = function () {
      ws = null;
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (!reconnectTimer) reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
    };
    ws.onerror = function () { ws.close(); };
  }

  async function doLeave() {
    try {
      await fetch('/play9/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: tableName, player_id: playerId }),
      });
    } catch (e) {
      console.error('Leave failed:', e);
    }
    window.location.href = '/play9';
  }

  waitingLeaveBtn?.addEventListener('click', doLeave);
  document.getElementById('leave-game')?.addEventListener('click', doLeave);

  const restartConfirmDialog = document.getElementById('restart-confirm-dialog');
  const restartConfirmCancel = document.getElementById('restart-confirm-cancel');
  const restartConfirmRestart = document.getElementById('restart-confirm-restart');

  document.getElementById('restart-game')?.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (restartConfirmDialog) restartConfirmDialog.hidden = false;
  });

  function closeRestartConfirm() {
    if (restartConfirmDialog) restartConfirmDialog.hidden = true;
  }

  restartConfirmCancel?.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    closeRestartConfirm();
  });
  restartConfirmRestart?.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    sendAction({ type: 'request_restart' });
    closeRestartConfirm();
  });
  restartConfirmDialog?.querySelector('.confirm-dialog-backdrop')?.addEventListener('click', closeRestartConfirm);

  const restartVoteDialog = document.getElementById('restart-vote-dialog');
  const restartVoteNo = document.getElementById('restart-vote-no');
  const restartVoteYes = document.getElementById('restart-vote-yes');
  restartVoteNo?.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (restartVoteTimer) {
      clearTimeout(restartVoteTimer);
      restartVoteTimer = null;
      restartVoteTimerRequestedAt = null;
    }
    lastDismissedRestartAt = lastStateForInactive?.restart_requested_at ?? Date.now() / 1000;
    sendAction({ type: 'vote_restart_no' });
    if (restartVoteDialog) restartVoteDialog.hidden = true;
  });
  restartVoteYes?.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (restartVoteTimer) {
      clearTimeout(restartVoteTimer);
      restartVoteTimer = null;
      restartVoteTimerRequestedAt = null;
    }
    sendAction({ type: 'vote_restart' });
    if (restartVoteDialog) restartVoteDialog.hidden = true;
  });
  restartVoteDialog?.querySelector('.confirm-dialog-backdrop')?.addEventListener('click', function () {
    if (restartVoteTimer) {
      clearTimeout(restartVoteTimer);
      restartVoteTimer = null;
      restartVoteTimerRequestedAt = null;
    }
    lastDismissedRestartAt = lastStateForInactive?.restart_requested_at ?? Date.now() / 1000;
    sendAction({ type: 'vote_restart_no' });
    if (restartVoteDialog) restartVoteDialog.hidden = true;
  });

  const alreadyConnectedDialog = document.getElementById('already-connected-dialog');
  document.getElementById('already-connected-ok')?.addEventListener('click', () => { window.location.href = '/play9'; });
  alreadyConnectedDialog?.querySelector('.confirm-dialog-backdrop')?.addEventListener('click', () => { window.location.href = '/play9'; });

  document.getElementById('error-dialog-ok')?.addEventListener('click', closeErrorDialog);
  document.getElementById('error-dialog')?.querySelector('.confirm-dialog-backdrop')?.addEventListener('click', closeErrorDialog);

  startBtn?.addEventListener('click', function () {
    startBtn.disabled = true;
    sendAction({ type: 'start' });
  });

  window.addEventListener('resize', function () {
    if (document.body.classList.contains('player-view-mode')) syncCardSizeFromSpread();
  });

  connect();
  fetch(`/play9/api/table/${tableName}`).then(r => r.json()).then(applyStateWithDragUpdate);
})();
