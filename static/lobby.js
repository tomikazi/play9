(function () {
  const form = document.getElementById('join-form');
  const tableInput = document.getElementById('table-name');
  const playerInput = document.getElementById('player-name');
  const errorEl = document.getElementById('error');

  const LAST_TABLE_KEY = 'play9_last_table';
  const lastTable = localStorage.getItem(LAST_TABLE_KEY);
  if (lastTable) {
    tableInput.value = lastTable;
  }

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
        errorEl.textContent = data.detail || 'Failed to join table.';
        errorEl.hidden = false;
        return;
      }
      localStorage.setItem(LAST_TABLE_KEY, data.table_name);
      const url = new URL(`/play9/table/${data.table_name}`, window.location.origin);
      if (data.player_id) {
        url.searchParams.set('id', data.player_id);
      }
      window.location.href = url.toString();
    } catch (err) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.hidden = false;
    }
  });
})();
