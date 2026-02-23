/* Play Nine — Shared game logic (table + player views) */
window.Play9 = (function () {
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function playerDisplayName(p, activePlayerIds) {
    const active = new Set(activePlayerIds || []);
    return active.has(p.id) ? p.name : p.name + ' \u{1F634}';
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
    if (opts.clickable) container.classList.add('clickable');
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
      const ph = document.createElement('div');
      ph.className = 'pile-card pile-placeholder';
      ph.textContent = '\u2014';
      container.appendChild(ph);
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
    if (opts.clickable) container.classList.add('clickable');
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
      const ph = document.createElement('div');
      ph.className = 'pile-card pile-placeholder';
      ph.textContent = '\u2014';
      container.appendChild(ph);
    }
    return container;
  }

  function slotPositionForPlayer(n, i) {
    if (n <= 2) return i === 0 ? 'left' : 'right';
    if (n === 3) return ['left', 'top', 'right'][i];
    if (n === 4) return ['left', 'top', 'right', 'bottom'][i];
    if (n === 5) return ['left', 'top-left', 'top', 'right', 'bottom'][i];
    return ['left', 'top-left', 'top-right', 'right', 'bottom-right', 'bottom-left'][i];
  }

  function isLastAffectedCard(state, pid, cardIndex) {
    const lac = state.last_affected_card;
    return lac && lac[0] === pid && lac[1] === cardIndex;
  }

  const DRAWN_CARD_ANIMATION_MS = 400;

  function runTableDrawnCardFlyAnimation(wrapper, fromPile) {
    const cardEl = wrapper.querySelector('.full-table-drawn-card');
    const pileSelector = fromPile === 'discard' ? '.full-table-center .discard-pile' : '.full-table-center .draw-pile';
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

  function renderTableView(state, container, opts) {
    opts = opts || {};
    const turnIdx = state.current_player_idx;
    const wrapper = document.createElement('div');
    wrapper.className = 'full-table';
    const surface = document.createElement('div');
    surface.className = 'full-table-surface';
    const center = document.createElement('div');
    center.className = 'full-table-center';
    center.appendChild(createStackedDrawPile(state.draw_pile_count ?? 0, { variant: 'table' }));
    if (state.phase !== 'empty' && state.phase !== 'waiting') {
      center.appendChild(createStackedDiscardPile(state.discard_pile_count ?? 0, state.discard_pile_top ?? [], { variant: 'table' }));
    }
    if (state.phase === 'play' && state.drawn_card) {
      const fc = document.createElement('div');
      const known = isCardValueKnown(state.drawn_card.value);
      fc.className = 'full-table-drawn-card card highlight ' + (known ? 'face-up' : 'face-down');
      fc.textContent = known ? String(state.drawn_card.value) : '';
      center.appendChild(fc);
    }
    surface.appendChild(center);
    const playersWrap = document.createElement('div');
    playersWrap.className = 'full-table-players players-' + (state.players?.length || 0);
    const justFlipped = opts.justFlippedByPlayer || {};
    (state.players || []).forEach((p, i) => {
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
        const isJustFlipped = card.face_up && justFlipped[i] && justFlipped[i].indexOf(ci) !== -1;
        if (isJustFlipped) {
          const flipWrapper = document.createElement('div');
          flipWrapper.className = 'full-table-card-flip-wrapper';
          const flipInner = document.createElement('div');
          flipInner.className = 'full-table-card-flip-inner';
          const backFace = document.createElement('div');
          backFace.className = 'full-table-card-face full-table-card-face-back';
          const frontFace = document.createElement('div');
          frontFace.className = 'full-table-card-face full-table-card-face-front';
          frontFace.textContent = isCardValueKnown(card.value) ? String(card.value) : '';
          flipInner.appendChild(backFace);
          flipInner.appendChild(frontFace);
          flipWrapper.appendChild(flipInner);
          if (isLastAffectedCard(state, p.id, ci)) flipWrapper.classList.add('last-affected');
          grid.appendChild(flipWrapper);
          flipInner.style.transition = 'none';
          void flipInner.offsetHeight;
          requestAnimationFrame(function () {
            flipInner.style.transition = '';
            flipInner.classList.add('full-table-card-flip-animate');
          });
        } else {
          const c = document.createElement('div');
          let cls = 'card' + (card.face_up ? ' face-up' : ' face-down');
          if (isLastAffectedCard(state, p.id, ci)) cls += ' last-affected';
          c.className = cls;
          c.textContent = card.face_up && isCardValueKnown(card.value) ? card.value : '';
          grid.appendChild(c);
        }
      });
      slot.appendChild(grid);
      playersWrap.appendChild(slot);
    });
    surface.appendChild(playersWrap);
    wrapper.appendChild(surface);
    container.appendChild(wrapper);
    if (state.phase === 'play' && state.drawn_card && opts.animateDrawnFrom) {
      runTableDrawnCardFlyAnimation(wrapper, opts.animateDrawnFrom);
    }
    if (opts.animateDrawnCardDrop) {
      runTableDrawnCardDropAnimation(wrapper, opts.animateDrawnCardDrop);
    }
    if (opts.animateReplacedCardToDiscard) {
      runTableReplacedCardToDiscardAnimation(wrapper, opts.animateReplacedCardToDiscard);
    }
  }

  const TABLE_DROP_ANIMATION_MS = 400;

  function runTableDrawnCardDropAnimation(wrapper, spec) {
    const center = wrapper.querySelector('.full-table-center');
    const discardEl = wrapper.querySelector('.full-table-center .discard-pile');
    if (!center || !discardEl) return;
    var toRect;
    if (spec.to === 'slot') {
      const slot = wrapper.querySelectorAll('.full-table-slot')[spec.playerIdx];
      const grid = slot && slot.querySelector('.full-table-card-grid');
      const cardEl = grid && grid.children[spec.slotIndex];
      if (!cardEl) return;
      toRect = cardEl.getBoundingClientRect();
    } else {
      toRect = discardEl.getBoundingClientRect();
    }
    var fromPlaceholder = document.createElement('div');
    fromPlaceholder.className = 'full-table-drawn-card card face-up';
    fromPlaceholder.style.visibility = 'hidden';
    fromPlaceholder.style.pointerEvents = 'none';
    center.appendChild(fromPlaceholder);
    var fromRect = fromPlaceholder.getBoundingClientRect();
    fromPlaceholder.parentNode.removeChild(fromPlaceholder);
    var ghost = document.createElement('div');
    ghost.className = 'card-ghost-to-discard card face-up';
    var known = isCardValueKnown(spec.drawnCard && spec.drawnCard.value);
    ghost.textContent = known ? String(spec.drawnCard.value) : '';
    ghost.style.position = 'fixed';
    ghost.style.left = fromRect.left + 'px';
    ghost.style.top = fromRect.top + 'px';
    ghost.style.width = fromRect.width + 'px';
    ghost.style.height = fromRect.height + 'px';
    ghost.style.transition = 'left ' + TABLE_DROP_ANIMATION_MS + 'ms ease-out, top ' + TABLE_DROP_ANIMATION_MS + 'ms ease-out, width ' + TABLE_DROP_ANIMATION_MS + 'ms ease-out, height ' + TABLE_DROP_ANIMATION_MS + 'ms ease-out';
    ghost.style.zIndex = '2000';
    document.body.appendChild(ghost);
    var completed = false;
    function finish() {
      if (completed) return;
      completed = true;
      ghost.removeEventListener('transitionend', finish);
      clearTimeout(tid);
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    }
    ghost.addEventListener('transitionend', finish);
    var tid = setTimeout(finish, TABLE_DROP_ANIMATION_MS + 50);
    void ghost.offsetHeight;
    requestAnimationFrame(function () {
      ghost.style.left = toRect.left + 'px';
      ghost.style.top = toRect.top + 'px';
      ghost.style.width = toRect.width + 'px';
      ghost.style.height = toRect.height + 'px';
    });
  }

  function runTableReplacedCardToDiscardAnimation(wrapper, spec) {
    const discardEl = wrapper.querySelector('.full-table-center .discard-pile');
    const slot = wrapper.querySelectorAll('.full-table-slot')[spec.playerIdx];
    const grid = slot && slot.querySelector('.full-table-card-grid');
    const cardEl = grid && grid.children[spec.slotIndex];
    if (!discardEl || !cardEl) return;
    const fromRect = cardEl.getBoundingClientRect();
    const toRect = discardEl.getBoundingClientRect();
    var ghost = document.createElement('div');
    ghost.className = 'card-ghost-to-discard card face-up';
    ghost.textContent = isCardValueKnown(spec.card && spec.card.value) ? String(spec.card.value) : '';
    ghost.style.position = 'fixed';
    ghost.style.left = fromRect.left + 'px';
    ghost.style.top = fromRect.top + 'px';
    ghost.style.width = fromRect.width + 'px';
    ghost.style.height = fromRect.height + 'px';
    ghost.style.transition = 'left ' + TABLE_DROP_ANIMATION_MS + 'ms ease-out, top ' + TABLE_DROP_ANIMATION_MS + 'ms ease-out, width ' + TABLE_DROP_ANIMATION_MS + 'ms ease-out, height ' + TABLE_DROP_ANIMATION_MS + 'ms ease-out';
    ghost.style.zIndex = '2000';
    document.body.appendChild(ghost);
    var completed = false;
    function finish() {
      if (completed) return;
      completed = true;
      ghost.removeEventListener('transitionend', finish);
      clearTimeout(tid);
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    }
    ghost.addEventListener('transitionend', finish);
    var tid = setTimeout(finish, TABLE_DROP_ANIMATION_MS + 50);
    void ghost.offsetHeight;
    requestAnimationFrame(function () {
      ghost.style.left = toRect.left + 'px';
      ghost.style.top = toRect.top + 'px';
      ghost.style.width = toRect.width + 'px';
      ghost.style.height = toRect.height + 'px';
    });
  }

  function renderRoundComplete(state, tableLayout, playerLayout, me, playerId, sendAction, syncCardSize) {
    if (playerId && me) {
      const wrapper = document.createElement('div');
      wrapper.className = 'player-view round-complete';
      const top = document.createElement('div');
      top.className = 'player-view-top';
      const piles = document.createElement('div');
      piles.className = 'player-view-piles';
      piles.appendChild(createStackedDrawPile(state.draw_pile_count ?? 0, { variant: 'player' }));
      piles.appendChild(createStackedDiscardPile(state.discard_pile_count ?? 0, state.discard_pile_top ?? [], { variant: 'player' }));
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
      if (syncCardSize) requestAnimationFrame(() => requestAnimationFrame(syncCardSize));
    } else {
      const wrapper = document.createElement('div');
      wrapper.className = 'full-table round-complete';
      const surface = document.createElement('div');
      surface.className = 'full-table-surface';
      const center = document.createElement('div');
      center.className = 'full-table-center';
      center.appendChild(createStackedDrawPile(state.draw_pile_count ?? 0, { variant: 'table' }));
      center.appendChild(createStackedDiscardPile(state.discard_pile_count ?? 0, state.discard_pile_top ?? [], { variant: 'table' }));
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

  let lastScoreFlyoverKey = null;

  function showScoreHistoryFlyover(state) {
    const flyover = document.getElementById('score-history-flyover');
    if (!flyover) return;
    flyover.innerHTML = '';
    const players = state.players || [];
    const scoreHistory = state.score_history || [];
    const roundScores = state.round_scores || {};
    const totals = state.scores || {};

    const table = document.createElement('table');
    table.className = 'score-history-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const roundTh = document.createElement('th');
    roundTh.textContent = '';
    roundTh.className = 'score-history-round-col';
    headerRow.appendChild(roundTh);
    players.forEach(p => {
      const th = document.createElement('th');
      th.textContent = escapeHtml(p.name);
      th.className = 'score-history-player-col';
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const allRounds = scoreHistory.concat([{ round: state.round_num, scores: roundScores }]);
    allRounds.forEach(entry => {
      const tr = document.createElement('tr');
      const roundTd = document.createElement('td');
      roundTd.textContent = 'Round ' + entry.round;
      roundTd.className = 'score-history-round-col';
      tr.appendChild(roundTd);
      players.forEach(p => {
        const td = document.createElement('td');
        td.textContent = String(entry.scores?.[p.id] ?? '—');
        td.className = 'score-history-player-col';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.className = 'score-history-total-row';
    const totalLabel = document.createElement('td');
    totalLabel.textContent = 'Total';
    totalLabel.className = 'score-history-round-col';
    totalRow.appendChild(totalLabel);
    players.forEach(p => {
      const td = document.createElement('td');
      td.textContent = String(totals[p.id] ?? '—');
      td.className = 'score-history-player-col';
      totalRow.appendChild(td);
    });
    tbody.appendChild(totalRow);
    table.appendChild(tbody);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'score-history-close-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => { flyover.hidden = true; });

    flyover.appendChild(table);
    flyover.appendChild(closeBtn);
    flyover.hidden = false;
  }

  function showScoreFlyover(state, sendAction) {
    const flyover = document.getElementById('score-flyover');
    if (!flyover) return;
    const key = JSON.stringify({ round_num: state.round_num, round_scores: state.round_scores, scores: state.scores });
    if (key === lastScoreFlyoverKey) {
      flyover.hidden = false;
      return;
    }
    lastScoreFlyoverKey = key;
    flyover.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'score-flyover-header';
    const logo = document.createElement('img');
    logo.src = '/play9/static/play9.webp';
    logo.alt = '';
    logo.className = 'score-flyover-logo';
    const trophyBtn = document.createElement('button');
    trophyBtn.className = 'score-trophy-btn icon-btn';
    trophyBtn.title = 'Scores by round';
    trophyBtn.setAttribute('aria-label', 'Scores by round');
    trophyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';
    trophyBtn.addEventListener('click', () => showScoreHistoryFlyover(state));
    header.appendChild(logo);
    header.appendChild(trophyBtn);
    flyover.appendChild(header);

    const title = document.createElement('h3');
    title.textContent = state.round_num >= 9 ? 'Game Over' : `Round ${state.round_num} complete`;
    const scores = (state.players || [])
      .map(p => ({ rank: 0, name: p.name, round: state.round_scores?.[p.id] ?? 0, total: state.scores?.[p.id] ?? 0 }))
      .sort((a, b) => a.total - b.total);
    scores.forEach((s, i) => { s.rank = i + 1; });
    const table = document.createElement('div');
    table.className = 'score-table';
    scores.forEach(s => {
      const row = document.createElement('div');
      row.className = 'score-table-row';
      row.innerHTML = `<span class="score-rank">${s.rank}</span><span class="score-name">${escapeHtml(s.name)}</span><span class="score-round">${s.round}</span><span class="score-total">${s.total}</span>`;
      table.appendChild(row);
    });
    const nextBtn = document.createElement('button');
    nextBtn.className = 'next-round-btn';
    nextBtn.textContent = state.round_num >= 9 ? 'Back to Lobby' : 'Next Round';
    nextBtn.addEventListener('click', () => sendAction({ type: 'advance_scoring' }));
    flyover.appendChild(title);
    flyover.appendChild(table);
    flyover.appendChild(nextBtn);
    flyover.hidden = false;
  }

  function updateGameTitle(state) {
    const el = document.getElementById('game-title');
    if (!el) return;
    if (!state.players || state.players.length === 0 || state.phase === 'empty') {
      el.textContent = 'Waiting for Players';
    } else if (state.phase === 'waiting') {
      el.textContent = '';
    } else if (state.phase === 'scoring') {
      el.textContent = state.round_num >= 9 ? 'Game Over' : `Round ${state.round_num} Done`;
    } else {
      el.textContent = state.round_num >= 9 ? 'Game Over' : `Round ${state.round_num}`;
    }
  }

  return {
    escapeHtml,
    playerDisplayName,
    pileRotation,
    isCardValueKnown,
    scoreHand,
    createStackedDrawPile,
    createStackedDiscardPile,
    slotPositionForPlayer,
    isLastAffectedCard,
    renderTableView,
    renderRoundComplete,
    showScoreFlyover,
    updateGameTitle,
  };
})();
