(function () {
  const form = document.getElementById('join-form');
  const tableInput = document.getElementById('table-name');
  const playerInput = document.getElementById('player-name');
  const errorEl = document.getElementById('error');

  const LAST_TABLE_KEY = 'play9_last_table';
  const LAST_PLAYER_KEY = 'play9_last_player';
  const lastTable = localStorage.getItem(LAST_TABLE_KEY);
  if (lastTable) {
    tableInput.value = lastTable;
  }
  const lastPlayer = localStorage.getItem(LAST_PLAYER_KEY);
  if (lastPlayer) {
    playerInput.value = lastPlayer;
  }

  const enterBtn = document.getElementById('enter-btn');
  function updateEnterButton() {
    enterBtn.textContent = playerInput.value.trim() ? 'Enter as Player' : 'Enter Table View';
  }
  updateEnterButton();
  playerInput.addEventListener('input', updateEnterButton);

  // Force table name to lowercase on input
  tableInput.addEventListener('input', function () {
    this.value = this.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    const tableName = tableInput.value.trim().toLowerCase();
    const playerName = playerInput.value.trim();

    if (!tableName) {
      errorEl.textContent = 'Please enter a table name.';
      errorEl.hidden = false;
      return;
    }

    try {
      const body = { table_name: tableName };
      if (playerName) body.player_name = playerName;
      const res = await fetch('/play9/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.detail === 'Player already connected elsewhere') {
          document.getElementById('already-connected-dialog').hidden = false;
          return;
        }
        errorEl.textContent = data.detail || 'Failed to join table.';
        errorEl.hidden = false;
        return;
      }
      localStorage.setItem(LAST_TABLE_KEY, data.table_name);
      if (playerName) {
        localStorage.setItem(LAST_PLAYER_KEY, playerName);
        const id = data.player_id;
        if (!id) {
          errorEl.textContent = 'Invalid response from server.';
          errorEl.hidden = false;
          return;
        }
        const url = new URL(`/play9/player/${data.table_name}`, window.location.origin);
        url.searchParams.set('id', id);
        window.location.href = url.toString();
      } else {
        window.location.href = `/play9/table/${data.table_name}`;
      }
    } catch (err) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.hidden = false;
    }
  });

  const alreadyConnectedDialog = document.getElementById('already-connected-dialog');
  document.getElementById('already-connected-ok').addEventListener('click', function () {
    alreadyConnectedDialog.hidden = true;
  });
  alreadyConnectedDialog?.querySelector('.confirm-dialog-backdrop')?.addEventListener('click', function () {
    alreadyConnectedDialog.hidden = true;
  });
})();
