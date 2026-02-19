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

  function renderTableView(state, container) {
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
    const logo = document.createElement('img');
    logo.src = '/play9/static/play9.webp';
    logo.alt = '';
    logo.className = 'score-flyover-logo';
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
    flyover.appendChild(logo);
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
