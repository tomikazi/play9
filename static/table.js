(function () {
  const pathParts = window.location.pathname.split('/');
  const tableName = pathParts[pathParts.length - 1];
  const params = new URLSearchParams(window.location.search);
  const playerId = params.get('id');

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

  if (!playerId) {
    gameSection.hidden = false;
  }

  function getWsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${proto}//${window.location.host}/play9/ws/${tableName}`;
    if (playerId) url += `?id=${encodeURIComponent(playerId)}`;
    return url;
  }

  function updateWaitingDialog(players, activePlayerIds) {
    if (!waitingDialogPlayerList) return;
    const active = new Set(activePlayerIds || []);
    waitingDialogPlayerList.innerHTML = (players || []).map(p => {
      const display = active.has(p.id) ? p.name : p.name + ' 😴';
      return `<li>${escapeHtml(display)}</li>`;
    }).join('');
    if (startBtn) startBtn.disabled = !players || players.length < 2;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function playerDisplayName(p, activePlayerIds) {
    const active = new Set(activePlayerIds || []);
    return active.has(p.id) ? p.name : p.name + ' 😴';
  }

  function syncCardSizeFromSpread() {
    const card = document.querySelector('body.player-view-mode .player-view-bottom .card-grid .card');
    if (card) {
      const rect = card.getBoundingClientRect();
      document.documentElement.style.setProperty('--player-card-height', rect.height + 'px');
      document.documentElement.style.setProperty('--player-card-width', rect.width + 'px');
    }
  }

  function pileRotation(seed, minDeg, maxDeg) {
    const range = maxDeg - minDeg;
    const x = ((seed * 7919 + 31) % 1000) / 1000;
    return minDeg + x * range;
  }

  const PILE_STACK_VISIBLE = 10;
  const PILE_STACK_VISIBLE_DRAW = 8;
  const FACE_DOWN_MASK = -99;
  function isCardValueKnown(val) {
    return val != null && val > FACE_DOWN_MASK;
  }

  function scoreHand(hand) {
    if (!hand || hand.length !== 8) return 0;
    const cols = [];
    for (let i = 0; i < 4; i++) cols.push([hand[i], hand[i + 4]]);
    let total = 0;
    for (const col of cols) {
      const v0 = col[0]?.value ?? 0;
      const v1 = col[1]?.value ?? 0;
      if (v0 > FACE_DOWN_MASK && v1 > FACE_DOWN_MASK) {
        if (v0 === v1) {
          total += v0 === -5 ? -10 : 0;
        } else {
          total += v0 + v1;
        }
      }
    }
    const pairValues = [];
    for (const col of cols) {
      const v0 = col[0]?.value, v1 = col[1]?.value;
      if (v0 > FACE_DOWN_MASK && v1 > FACE_DOWN_MASK && v0 === v1) pairValues.push(v0);
    }
    const counts = {};
    for (const v of pairValues) counts[v] = (counts[v] || 0) + 1;
    const maxSame = pairValues.length ? Math.max(...Object.values(counts)) : 0;
    if (maxSame >= 3) total += -15;
    else if (maxSame >= 2) total += -10;
    return total;
  }

  function createStackedDrawPile(count, opts) {
    const n = Math.max(0, count ?? 0);
    const container = document.createElement('div');
    container.className = 'pile-stack draw-pile' + (opts.variant === 'table' ? ' full-table-pile draw' : ' pile-btn');
    container.title = n ? `${n} cards` : '';
    if (opts.highlight) container.classList.add('highlight');
    if (opts.clickable) container.classList.add('clickable', 'draggable-source');

    const visibleCount = Math.min(n, PILE_STACK_VISIBLE_DRAW);
    for (let i = 0; i < visibleCount; i++) {
      const el = document.createElement('div');
      el.className = 'pile-card card face-down';
      const posInPile = n - visibleCount + i;
      const rot = pileRotation(posInPile, -5, 5);
      const offset = i * 2;
      el.style.transform = `translate(${offset}px, ${offset}px) rotate(${rot}deg)`;
      el.style.zIndex = String(i);
      container.appendChild(el);
    }
    if (visibleCount === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'pile-card pile-placeholder';
      placeholder.textContent = '—';
      container.appendChild(placeholder);
    }
    return container;
  }

  function createStackedDiscardPile(count, topValues, opts) {
    const n = Math.max(0, count ?? 0);
    const top = topValues || [];
    const container = document.createElement('div');
    container.className = 'pile-stack discard-pile' + (opts.variant === 'table' ? ' full-table-pile discard' : '');
    container.title = 'Discard';
    if (opts.highlight) container.classList.add('highlight');
    if (opts.clickable) container.classList.add('clickable', 'draggable-source');

    const visibleCount = Math.min(n, PILE_STACK_VISIBLE);
    for (let i = 0; i < visibleCount; i++) {
      const el = document.createElement('div');
      const idxFromTop = visibleCount - 1 - i;
      const val = top[idxFromTop];
      const known = isCardValueKnown(val);
      el.className = 'pile-card card face-up';
      el.textContent = idxFromTop < 2 && known ? String(val) : '-';
      const posInPile = n - visibleCount + i;
      const seed = posInPile * 127 + (isCardValueKnown(val) ? val : 0);
      const rot = pileRotation(seed, -20, 20);
      const offset = i * 2;
      el.style.transform = `translate(${offset}px, ${offset}px) rotate(${rot}deg)`;
      el.style.zIndex = String(i);
      container.appendChild(el);
    }
    if (visibleCount === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'pile-card pile-placeholder';
      placeholder.textContent = '—';
      container.appendChild(placeholder);
    }
    return container;
  }

  function updateGameTitle(state) {
    const el = document.getElementById('game-title');
    if (!el) return;
    if (!state.players || state.players.length === 0 || state.phase === 'empty') {
      el.textContent = 'Waiting for Players';
    } else if (state.phase === 'waiting') {
      el.textContent = '';
    } else {
      el.textContent = state.round_num >= 9 ? 'Game Over' : `Round ${state.round_num}`;
    }
  }

  function applyState(state) {
    if (state.phase !== 'scoring') {
      const flyover = document.getElementById('score-flyover');
      if (flyover) flyover.hidden = true;
    }
    if (state.phase === 'empty' || !state.players) {
      updateWaitingDialog([], []);
    } else {
      updateWaitingDialog(state.players, state.active_player_ids);
    }
    const showWaitingRoom = playerId && state.phase === 'waiting';
    if (showWaitingRoom) {
      gameSection.hidden = false;
      updateGameTitle(state);
      renderGame(state);
      if (waitingRoomDialog) waitingRoomDialog.hidden = false;
    } else {
      if (waitingRoomDialog) waitingRoomDialog.hidden = true;
      gameSection.hidden = false;
      updateGameTitle(state);
      renderGame(state);
    }
  }

  function renderGame(state) {
    const tableLayout = document.getElementById('table-layout');
    const playerLayout = document.getElementById('player-layout');
    const me = playerId ? state.players.find(p => p.id === playerId) : null;

    tableLayout.innerHTML = '';
    playerLayout.innerHTML = '';

    document.body.classList.toggle('table-view-mode', !playerId);
    document.body.classList.toggle('player-view-mode', !!playerId);

    if (state.phase === 'scoring') {
      renderRoundComplete(state, tableLayout, playerLayout, me);
      showScoreFlyover(state);
      return;
    }

    if (!playerId || state.phase === 'waiting') {
      renderTableView(state, tableLayout);
      return;
    }

    if (me && (state.phase === 'reveal' || state.phase === 'play')) {
      const isMyTurn = state.phase === 'play' && state.players[state.current_player_idx]?.id === playerId;
      const hasDrawn = !!state.drawn_card;

      const wrapper = document.createElement('div');
      wrapper.className = 'player-view';
      if (state.phase === 'play' && state.drawn_card && !isMyTurn) {
        wrapper.classList.add('show-drawn-card');
      }

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

        const drawPileEl = createStackedDrawPile(state.draw_pile_count ?? 0, {
          variant: 'player',
          highlight: drawHighlight,
          clickable: !!drawClickable,
        });
        const discardPileEl = createStackedDiscardPile(state.discard_pile_count ?? 0, state.discard_pile_top ?? [], {
          variant: 'player',
          highlight: discardHighlight,
          clickable: !!discardClickable,
        });
        if (discardHighlight && hasDrawn) {
          discardPileEl.dataset.dropType = 'discard';
        }
        if (drawClickable) setupDragSource(drawPileEl, 'draw', null, state);
        if (discardClickable) setupDragSource(discardPileEl, 'discard', topDiscardValue, state);

        piles.appendChild(drawPileEl);
        piles.appendChild(discardPileEl);
        pilesWrap.appendChild(piles);

        if (state.phase === 'play' && state.drawn_card && !isMyTurn) {
          const floatingCard = document.createElement('div');
          const known = isCardValueKnown(state.drawn_card.value);
          floatingCard.className = 'player-view-drawn-card card highlight ' + (known ? 'face-up' : 'face-down');
          floatingCard.textContent = known ? String(state.drawn_card.value) : '';
          pilesWrap.appendChild(floatingCard);
        }
        top.appendChild(pilesWrap);
      }
      wrapper.appendChild(top);

      const center = document.createElement('div');
      center.className = 'player-view-center';

      if (state.phase === 'play') {
        const allFaceUp = me.hand.every((c) => c.face_up);
        if (allFaceUp) {
          const msg = document.createElement('p');
          msg.className = 'center-instruction center-instruction-score';
          msg.textContent = String(state.round_scores?.[me.id] ?? scoreHand(me.hand));
          center.appendChild(msg);
        } else {
          const mustFlip = !!state.must_flip_after_discard;
          if (mustFlip && isMyTurn) {
            const msg = document.createElement('p');
            msg.className = 'center-instruction';
            msg.textContent = 'Flip a card';
            center.appendChild(msg);
          } else if (!isMyTurn) {
            const msg = document.createElement('p');
            msg.className = 'center-instruction center-instruction-wait';
            msg.textContent = 'Wait your turn';
            center.appendChild(msg);
          } else if (isMyTurn && !hasDrawn) {
            const msg = document.createElement('p');
            msg.className = 'center-instruction';
            msg.textContent = 'Draw your card';
            center.appendChild(msg);
          }
        }
      } else if (state.phase === 'reveal') {
        const msg = document.createElement('p');
        msg.className = 'center-instruction';
        msg.textContent = 'Reveal 2 of your cards';
        center.appendChild(msg);
      }
      wrapper.appendChild(center);

      const bottom = document.createElement('div');
      bottom.className = 'player-view-bottom';
      const grid = document.createElement('div');
      grid.className = 'card-grid';

      me.hand.forEach((card, i) => {
        const el = document.createElement('div');
        let cls = 'card' + (card.face_up ? ' face-up' : ' face-down');
        if (isLastAffectedCard(state, me.id, i)) cls += ' last-affected';
        el.className = cls;
        if (card.face_up && isCardValueKnown(card.value)) {
          el.textContent = card.value;
        } else {
          el.textContent = '';
        }
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
      requestAnimationFrame(function () {
        requestAnimationFrame(syncCardSizeFromSpread);
      });
    } else {
      const msg = document.createElement('p');
      msg.textContent = 'Waiting…';
      playerLayout.appendChild(msg);
    }
  }

  function isLastAffectedCard(state, playerId, cardIndex) {
    const lac = state.last_affected_card;
    return lac && lac[0] === playerId && lac[1] === cardIndex;
  }

  function slotPositionForPlayer(n, i) {
    if (n <= 2) return i === 0 ? 'left' : 'right';
    if (n === 3) return ['left', 'top', 'right'][i];
    if (n === 4) return ['left', 'top', 'right', 'bottom'][i];
    if (n === 5) return ['left', 'top-left', 'top', 'right', 'bottom'][i];
    return ['left', 'top-left', 'top-right', 'right', 'bottom-right', 'bottom-left'][i];
  }

  function renderTableView(state, container) {
    const turnIdx = state.current_player_idx;

    const wrapper = document.createElement('div');
    wrapper.className = 'full-table';

    const surface = document.createElement('div');
    surface.className = 'full-table-surface';

    const center = document.createElement('div');
    center.className = 'full-table-center';

    const drawPile = createStackedDrawPile(state.draw_pile_count ?? 0, { variant: 'table' });
    const discardPile = createStackedDiscardPile(state.discard_pile_count ?? 0, state.discard_pile_top ?? [], { variant: 'table' });
    center.appendChild(drawPile);
    center.appendChild(discardPile);

    if (state.phase === 'play' && state.drawn_card) {
      const floatingCard = document.createElement('div');
      const known = isCardValueKnown(state.drawn_card.value);
      floatingCard.className = 'full-table-drawn-card card highlight ' + (known ? 'face-up' : 'face-down');
      floatingCard.textContent = known ? String(state.drawn_card.value) : '';
      center.appendChild(floatingCard);
    }
    surface.appendChild(center);

    const playersWrap = document.createElement('div');
    playersWrap.className = 'full-table-players players-' + state.players.length;

    state.players.forEach((p, i) => {
      const slot = document.createElement('div');
      const pos = slotPositionForPlayer(state.players.length, i);
      slot.className = 'full-table-slot slot-' + pos + (i === turnIdx && state.phase === 'play' ? ' current-turn' : '');
      const nameEl = document.createElement('div');
      nameEl.className = 'full-table-player-name';
      nameEl.textContent = playerDisplayName(p, state.active_player_ids);
      slot.appendChild(nameEl);

      const grid = document.createElement('div');
      grid.className = 'full-table-card-grid';
      (p.hand || []).forEach((card, ci) => {
        const c = document.createElement('div');
        let cls = 'card' + (card.face_up ? ' face-up' : ' face-down');
        if (isLastAffectedCard(state, p.id, ci)) cls += ' last-affected';
        c.className = cls;
        c.textContent = card.face_up && isCardValueKnown(card.value) ? card.value : '';
        grid.appendChild(c);
      });
      slot.appendChild(grid);
      playersWrap.appendChild(slot);
    });

    surface.appendChild(playersWrap);
    wrapper.appendChild(surface);
    container.appendChild(wrapper);
  }

  function renderRoundComplete(state, tableLayout, playerLayout, me) {
    document.body.classList.toggle('table-view-mode', !playerId);
    document.body.classList.toggle('player-view-mode', !!playerId);

    if (playerId && me) {
      const wrapper = document.createElement('div');
      wrapper.className = 'player-view round-complete';
      const top = document.createElement('div');
      top.className = 'player-view-top';
      const piles = document.createElement('div');
      piles.className = 'player-view-piles';
      const drawPileEl = createStackedDrawPile(state.draw_pile_count ?? 0, { variant: 'player' });
      const discardPileEl = createStackedDiscardPile(state.discard_pile_count ?? 0, state.discard_pile_top ?? [], { variant: 'player' });
      piles.appendChild(drawPileEl);
      piles.appendChild(discardPileEl);
      top.appendChild(piles);
      wrapper.appendChild(top);

      const center = document.createElement('div');
      center.className = 'player-view-center';
      const msg = document.createElement('p');
      msg.className = 'center-instruction center-instruction-score';
      msg.textContent = String(state.round_scores?.[me.id] ?? 0);
      center.appendChild(msg);
      wrapper.appendChild(center);

      const bottom = document.createElement('div');
      bottom.className = 'player-view-bottom';
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      me.hand.forEach((card, i) => {
        const el = document.createElement('div');
        let cls = 'card face-up';
        if (isLastAffectedCard(state, me.id, i)) cls += ' last-affected';
        el.className = cls;
        el.textContent = card.face_up && isCardValueKnown(card.value) ? card.value : '';
        grid.appendChild(el);
      });
      bottom.appendChild(grid);
      wrapper.appendChild(bottom);
      playerLayout.appendChild(wrapper);
      requestAnimationFrame(function () {
        requestAnimationFrame(syncCardSizeFromSpread);
      });
    } else {
      const wrapper = document.createElement('div');
      wrapper.className = 'full-table round-complete';

      const surface = document.createElement('div');
      surface.className = 'full-table-surface';

      const center = document.createElement('div');
      center.className = 'full-table-center';
      const drawPile = createStackedDrawPile(state.draw_pile_count ?? 0, { variant: 'table' });
      const discardPile = createStackedDiscardPile(state.discard_pile_count ?? 0, state.discard_pile_top ?? [], { variant: 'table' });
      center.appendChild(drawPile);
      center.appendChild(discardPile);
      surface.appendChild(center);

      const playersWrap = document.createElement('div');
      playersWrap.className = 'full-table-players players-' + state.players.length;
      state.players.forEach((p, i) => {
        const slot = document.createElement('div');
        const pos = slotPositionForPlayer(state.players.length, i);
        slot.className = 'full-table-slot slot-' + pos;
        const nameEl = document.createElement('div');
        nameEl.className = 'full-table-player-name';
        nameEl.textContent = playerDisplayName(p, state.active_player_ids);
        slot.appendChild(nameEl);
        const grid = document.createElement('div');
        grid.className = 'full-table-card-grid';
        (p.hand || []).forEach((card, ci) => {
          const c = document.createElement('div');
          let cls = 'card face-up';
          if (isLastAffectedCard(state, p.id, ci)) cls += ' last-affected';
          c.className = cls;
          c.textContent = card.face_up && isCardValueKnown(card.value) ? card.value : '';
          grid.appendChild(c);
        });
        slot.appendChild(grid);
        playersWrap.appendChild(slot);
      });
      surface.appendChild(playersWrap);
      wrapper.appendChild(surface);
      tableLayout.appendChild(wrapper);
    }
  }

  function showScoreFlyover(state) {
    const flyover = document.getElementById('score-flyover');
    flyover.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = state.round_num >= 9 ? 'Game Over' : `Round ${state.round_num} complete`;
    const scores = state.players
      .map(p => ({
        rank: 0,
        name: p.name,
        round: state.round_scores?.[p.id] ?? 0,
        total: state.scores?.[p.id] ?? 0,
      }))
      .sort((a, b) => a.total - b.total);
    scores.forEach((s, i) => { s.rank = i + 1; });
    const table = document.createElement('div');
    table.className = 'score-table';
    scores.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'score-table-row';
      row.innerHTML = `
        <span class="score-rank">${s.rank}</span>
        <span class="score-name">${escapeHtml(s.name)}</span>
        <span class="score-round">${s.round}</span>
        <span class="score-total">${s.total}</span>
      `;
      table.appendChild(row);
    });
    const nextBtn = document.createElement('button');
    nextBtn.className = 'next-round-btn';
    nextBtn.textContent = state.round_num >= 9 ? 'Back to Lobby' : 'Next Round';
    nextBtn.addEventListener('click', function () {
      sendAction({ type: 'advance_scoring' });
    });
    flyover.appendChild(title);
    flyover.appendChild(table);
    flyover.appendChild(nextBtn);
    flyover.hidden = false;
  }

  function renderScoring(state, container, me) {
    const title = document.createElement('h3');
    title.textContent = state.round_num >= 9 ? 'Game Over' : `Round ${state.round_num} complete`;
    container.appendChild(title);

    const scores = state.players
      .map(p => ({
        name: p.name,
        round: state.round_scores?.[p.id] ?? 0,
        total: state.scores?.[p.id] ?? 0,
      }))
      .sort((a, b) => a.total - b.total);

    const list = document.createElement('ol');
    list.className = 'score-list';
    scores.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${i + 1}. ${escapeHtml(s.name)}</strong> — round: ${s.round}, total: ${s.total}`;
      list.appendChild(li);
    });
    container.appendChild(list);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'next-round-btn';
    nextBtn.textContent = state.round_num >= 9 ? 'Back to Lobby' : 'Next Round';
    nextBtn.addEventListener('click', () => sendAction({ type: 'advance_scoring' }));
    container.appendChild(nextBtn);
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

  function flipCard(index) {
    if (!playerId) return;
    sendAction({ type: 'reveal', card_index: index });
  }

  let dragState = null;

  function createDragGhost(value) {
    const ghost = document.createElement('div');
    const isBack = value == null;
    ghost.className = 'drag-ghost card ' + (isBack ? 'face-down' : 'face-up');
    ghost.textContent = isBack ? '' : String(value);
    ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;opacity:0.95;';
    document.body.appendChild(ghost);
    return ghost;
  }

  const DRAG_THRESHOLD = 5;

  function setupDragSource(el, source, knownValue, state) {
    el.addEventListener('pointerdown', function (e) {
      if (!playerId || e.button !== 0) return;
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
          const cardValue = knownValue;
          if (source === 'draw') {
            sendAction({ type: 'draw_from_draw' });
          } else if (source === 'discard') {
            sendAction({ type: 'draw_from_discard' });
          }
          ghost = createDragGhost(cardValue);
          ghost.style.width = w + 'px';
          ghost.style.height = h + 'px';
          ghost.style.left = (e.clientX - w / 2) + 'px';
          ghost.style.top = (e.clientY - h) + 'px';

          dragState = {
            source,
            drawnFrom: source === 'draw' ? 'draw' : 'discard',
            cardValue: knownValue,
            ghost,
          };
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
              const idx = parseInt(dropEl.dataset.cardIndex, 10);
              sendAction({ type: 'play_replace', card_index: idx });
            } else if (dropType === 'discard') {
              if (dragState.drawnFrom === 'draw') {
                sendAction({ type: 'play_discard_only' });
              } else if (dragState.drawnFrom === 'discard') {
                sendAction({ type: 'play_put_back' });
              }
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

  function applyStateWithDragUpdate(state) {
    if (dragState && state.drawn_card && dragState.source === 'draw') {
      dragState.cardValue = state.drawn_card.value;
      dragState.drawnFrom = state.drawn_from;
      if (dragState.ghost) {
        dragState.ghost.classList.remove('face-down');
        dragState.ghost.classList.add('face-up');
        dragState.ghost.textContent = isCardValueKnown(state.drawn_card.value) ? String(state.drawn_card.value) : '';
      }
    }
    applyState(state);
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
          if (data.error === 'Player already connected elsewhere') {
            document.getElementById('already-connected-dialog').hidden = false;
            if (reconnectTimer) {
              clearTimeout(reconnectTimer);
              reconnectTimer = null;
            }
            ws = null;
            return;
          }
          if (data.error !== 'Not a player at this table') {
            alert(data.error);
          }
          if (playerId && waitingRoomDialog && !waitingRoomDialog.hidden) {
            startBtn.disabled = false;
          }
          return;
        }
        applyStateWithDragUpdate(data);
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
        sendAction({ type: 'heartbeat' });
      }
    }, HEARTBEAT_INTERVAL);
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
    sendAction({ type: 'restart' });
    closeRestartConfirm();
  });
  restartConfirmDialog?.querySelector('.confirm-dialog-backdrop')?.addEventListener('click', closeRestartConfirm);

  const alreadyConnectedDialog = document.getElementById('already-connected-dialog');
  document.getElementById('already-connected-ok')?.addEventListener('click', function () {
    window.location.href = '/play9';
  });
  alreadyConnectedDialog?.querySelector('.confirm-dialog-backdrop')?.addEventListener('click', function () {
    window.location.href = '/play9';
  });

  startBtn?.addEventListener('click', function () {
    if (!playerId) return;
    startBtn.disabled = true;
    sendAction({ type: 'start' });
  });

  window.addEventListener('resize', function () {
    if (document.body.classList.contains('player-view-mode')) {
      syncCardSizeFromSpread();
    }
  });

  connect();
  fetch(`/play9/api/table/${tableName}`).then(r => r.json()).then(applyStateWithDragUpdate);
})();
