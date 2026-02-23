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
  let lastStateForDrawAnimation = null;
  let animateDrawnFrom = null;
  let justFlippedCardIndices = null;

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

  const DRAWN_CARD_ANIMATION_MS = 400;

  function runDrawnCardFlyAnimation(wrapper, fromPile) {
    const cardEl = wrapper.querySelector('.player-view-drawn-card');
    const pileSelector = fromPile === 'discard' ? '.player-view-piles .discard-pile' : '.player-view-piles .draw-pile';
    const pileEl = wrapper.querySelector(pileSelector);
    if (!cardEl || !pileEl) return;
    const pileRect = pileEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    const dx = (pileRect.left + pileRect.width / 2) - (cardRect.left + cardRect.width / 2);
    const dy = pileRect.top - cardRect.top;
    const scaleX = pileRect.width / cardRect.width;
    const scaleY = pileRect.height / cardRect.height;
    cardEl.style.transformOrigin = 'top center';
    cardEl.style.transition = 'none';
    cardEl.style.transform = 'translate(calc(-50% + ' + dx + 'px), ' + dy + 'px) scale(' + scaleX + ', ' + scaleY + ')';
    void cardEl.offsetHeight;
    requestAnimationFrame(function () {
      cardEl.style.transition = 'transform ' + DRAWN_CARD_ANIMATION_MS + 'ms ease-out';
      cardEl.style.transform = 'translate(-50%, 0) scale(1.6)';
    });
  }

  const DRAWN_CARD_TO_TARGET_MS = 400;
  let drawnCardToTargetInProgress = false;

  function runDrawnCardToTargetAnimation(wrapper, targetEl, onDone) {
    const cardEl = wrapper.querySelector('.player-view-drawn-card');
    if (!cardEl || !targetEl || drawnCardToTargetInProgress) return;
    drawnCardToTargetInProgress = true;
    const cardRect = cardEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const dx = (targetRect.left + targetRect.width / 2) - (cardRect.left + cardRect.width / 2);
    const dy = targetRect.top - cardRect.top;
    const scaleX = targetRect.width / cardRect.width;
    const scaleY = targetRect.height / cardRect.height;
    cardEl.style.transformOrigin = 'top center';
    cardEl.style.transition = 'transform ' + DRAWN_CARD_TO_TARGET_MS + 'ms ease-out';
    cardEl.style.transform = 'translate(calc(-50% + ' + dx + 'px), ' + dy + 'px) scale(' + scaleX + ', ' + scaleY + ')';
    var completed = false;
    function finish() {
      if (completed) return;
      completed = true;
      drawnCardToTargetInProgress = false;
      cardEl.removeEventListener('transitionend', finish);
      clearTimeout(timeoutId);
      onDone();
    }
    cardEl.addEventListener('transitionend', finish);
    var timeoutId = setTimeout(finish, DRAWN_CARD_TO_TARGET_MS + 50);
  }

  function runReplacedCardToDiscardAnimation(wrapper, slotEl, card, onDone) {
    const discardEl = wrapper.querySelector('.player-view-piles .discard-pile');
    if (!discardEl || !slotEl) {
      if (onDone) onDone();
      return;
    }
    const slotRect = slotEl.getBoundingClientRect();
    const discardRect = discardEl.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'card-ghost-to-discard card face-up';
    ghost.textContent = Play9.isCardValueKnown(card.value) ? String(card.value) : '';
    ghost.style.position = 'fixed';
    ghost.style.left = slotRect.left + 'px';
    ghost.style.top = slotRect.top + 'px';
    ghost.style.width = slotRect.width + 'px';
    ghost.style.height = slotRect.height + 'px';
    ghost.style.transition = 'left ' + DRAWN_CARD_TO_TARGET_MS + 'ms ease-out, top ' + DRAWN_CARD_TO_TARGET_MS + 'ms ease-out, width ' + DRAWN_CARD_TO_TARGET_MS + 'ms ease-out, height ' + DRAWN_CARD_TO_TARGET_MS + 'ms ease-out';
    ghost.style.zIndex = '2000';
    document.body.appendChild(ghost);
    var completed = false;
    function finish() {
      if (completed) return;
      completed = true;
      ghost.removeEventListener('transitionend', finish);
      clearTimeout(timeoutId);
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      if (onDone) onDone();
    }
    ghost.addEventListener('transitionend', finish);
    var timeoutId = setTimeout(finish, DRAWN_CARD_TO_TARGET_MS + 50);
    void ghost.offsetHeight;
    requestAnimationFrame(function () {
      ghost.style.left = discardRect.left + 'px';
      ghost.style.top = discardRect.top + 'px';
      ghost.style.width = discardRect.width + 'px';
      ghost.style.height = discardRect.height + 'px';
    });
  }

  let ws = null;
  let reconnectTimer = null;
  let pingTimer = null;
  let inactiveTurnCountdown = null;
  const RECONNECT_DELAY = 3000;
  const HEARTBEAT_INTERVAL = 5000;

  function sendAction(action) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  }

  function flipCard(index) {
    sendAction({ type: 'reveal', card_index: index });
  }

  function applyState(state) {
    const hadDrawn = lastStateForDrawAnimation && lastStateForDrawAnimation.drawn_card;
    const haveDrawn = state.drawn_card && state.drawn_from;
    animateDrawnFrom = (lastStateForDrawAnimation != null && !hadDrawn && haveDrawn) ? state.drawn_from : null;
    justFlippedCardIndices = [];
    var hadDrawnCard = lastStateForDrawAnimation && lastStateForDrawAnimation.drawn_card;
    var haveDrawnCard = !!state.drawn_card;
    if (lastStateForDrawAnimation && state.players && !(hadDrawnCard && !haveDrawnCard)) {
      var me = state.players.find(function (p) { return p.id === playerId; });
      var prevMe = lastStateForDrawAnimation.players && lastStateForDrawAnimation.players.find(function (p) { return p.id === playerId; });
      if (me && prevMe && me.hand && prevMe.hand && me.hand.length === 8 && prevMe.hand.length === 8) {
        for (var fi = 0; fi < 8; fi++) {
          if (!prevMe.hand[fi].face_up && me.hand[fi].face_up) justFlippedCardIndices.push(fi);
        }
      }
    }
    lastStateForDrawAnimation = state;

    if (state.phase !== 'scoring') {
      const flyover = document.getElementById('score-flyover');
      if (flyover) flyover.hidden = true;
      const historyFlyover = document.getElementById('score-history-flyover');
      if (historyFlyover) historyFlyover.hidden = true;
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

  function renderGame(state) {
    const tableLayout = document.getElementById('table-layout');
    const playerLayout = document.getElementById('player-layout');
    const me = state.players?.find(p => p.id === playerId) || null;

    tableLayout.innerHTML = '';
    playerLayout.innerHTML = '';

    document.documentElement.classList.add('player-view-mode');
    document.documentElement.classList.remove('table-view-mode');
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
      if (state.phase === 'play' && state.drawn_card) wrapper.classList.add('show-drawn-card');

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

        const drawPileEl = Play9.createStackedDrawPile(state.draw_pile_count ?? 0, { variant: 'player', highlight: drawHighlight, clickable: !!drawClickable });
        const discardPileEl = Play9.createStackedDiscardPile(state.discard_pile_count ?? 0, state.discard_pile_top ?? [], { variant: 'player', highlight: discardHighlight, clickable: !!discardClickable || (hasDrawn && isMyTurn) });
        if (drawClickable) drawPileEl.addEventListener('click', () => sendAction({ type: 'draw_from_draw' }));
        if (discardClickable) discardPileEl.addEventListener('click', () => sendAction({ type: 'draw_from_discard' }));
        if (hasDrawn && isMyTurn) {
          discardPileEl.classList.add('clickable');
          discardPileEl.addEventListener('click', function () {
            runDrawnCardToTargetAnimation(wrapper, discardPileEl, function () {
              if (state.drawn_from === 'draw') sendAction({ type: 'play_discard_only' });
              else if (state.drawn_from === 'discard') sendAction({ type: 'play_put_back' });
            });
          });
        }
        piles.appendChild(drawPileEl);
        piles.appendChild(discardPileEl);
        if (state.phase === 'play' && state.drawn_card) {
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
      const flipIndices = justFlippedCardIndices || [];
      justFlippedCardIndices = null;
      me.hand.forEach((card, i) => {
        const isJustFlipped = card.face_up && flipIndices.indexOf(i) !== -1;
        var el;
        if (isJustFlipped) {
          const flipWrapper = document.createElement('div');
          flipWrapper.className = 'card-flip-wrapper';
          const flipInner = document.createElement('div');
          flipInner.className = 'card-flip-inner';
          const backFace = document.createElement('div');
          backFace.className = 'card-face card-face-back';
          const frontFace = document.createElement('div');
          frontFace.className = 'card-face card-face-front';
          frontFace.textContent = Play9.isCardValueKnown(card.value) ? String(card.value) : '';
          flipInner.appendChild(backFace);
          flipInner.appendChild(frontFace);
          flipWrapper.appendChild(flipInner);
          if (Play9.isLastAffectedCard(state, me.id, i)) flipWrapper.classList.add('last-affected');
          el = flipWrapper;
          grid.appendChild(el);
          flipInner.style.transition = 'none';
          void flipInner.offsetHeight;
          requestAnimationFrame(function () {
            flipInner.style.transition = '';
            flipInner.classList.add('card-flip-animate');
          });
        } else {
          el = document.createElement('div');
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
              el.addEventListener('click', function () {
                var pending = 2;
                function bothDone() {
                  pending--;
                  if (pending === 0) sendAction({ type: 'play_replace', card_index: i });
                }
                runDrawnCardToTargetAnimation(wrapper, el, bothDone);
                runReplacedCardToDiscardAnimation(wrapper, el, card, bothDone);
              });
            }
          }
          grid.appendChild(el);
        }
      });
      bottom.appendChild(grid);
      wrapper.appendChild(bottom);
      playerLayout.appendChild(wrapper);
      if (state.phase === 'play' && state.drawn_card && animateDrawnFrom) {
        runDrawnCardFlyAnimation(wrapper, animateDrawnFrom);
        animateDrawnFrom = null;
      }
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
        applyState(data);
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
  fetch(`/play9/api/table/${tableName}`).then(r => r.json()).then(applyState);
})();
