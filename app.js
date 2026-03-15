/* ═══════════════════════════════════════════
   STOCKYARD — app.js
   Storage: IndexedDB (with localStorage fallback)
═══════════════════════════════════════════ */

'use strict';

// ─── STATE ───────────────────────────────────────────────
let db = null;
let items = [];         // { id, name, stock, min, updatedAt }
let activity = [];      // last 20 actions
let activeItemId = null;
let currentSort = 'name';
let searchQuery = '';

// ─── IDB SETUP ───────────────────────────────────────────
function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('stockyard_db', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('items')) {
        const store = d.createObjectStore('items', { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readonly');
    const req = tx.objectStore('items').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readwrite');
    const req = tx.objectStore('items').put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readwrite');
    const req = tx.objectStore('items').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbPutMeta(key, value) {
  return new Promise((resolve) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    tx.oncomplete = () => resolve();
  });
}

function dbGetMeta(key) {
  return new Promise((resolve) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => resolve(null);
  });
}

// ─── INIT ─────────────────────────────────────────────────
async function init() {
  await initDB();
  items = await dbGetAll();
  const saved = await dbGetMeta('activity');
  if (saved) activity = saved;

  // Dark mode
  const theme = await dbGetMeta('theme');
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');

  render();
  setupEvents();
  registerSW();
}

// ─── RENDER ───────────────────────────────────────────────
function render() {
  renderDashboard();
  renderInventory();
  renderAlerts();
  updateAlertBadge();
}

function getStatus(item) {
  if (item.stock <= 0) return 'out';
  if (item.stock <= item.min) return 'warn';
  return 'ok';
}

function getSortedFiltered() {
  let list = items.filter(i =>
    i.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  if (currentSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (currentSort === 'stock-asc') list.sort((a, b) => a.stock - b.stock);
  else if (currentSort === 'stock-desc') list.sort((a, b) => b.stock - a.stock);
  return list;
}

function renderDashboard() {
  const total = items.length;
  const low = items.filter(i => i.stock > 0 && i.stock <= i.min).length;
  const out = items.filter(i => i.stock <= 0).length;
  const ok = total - low - out;

  qs('#statTotal').textContent = total;
  qs('#statOk').textContent = ok;
  qs('#statLow').textContent = low;
  qs('#statOut').textContent = out;

  const log = qs('#activityLog');
  if (activity.length === 0) {
    log.innerHTML = '<li class="empty-state">No activity yet.</li>';
    return;
  }
  log.innerHTML = activity.slice().reverse().slice(0, 20).map(a => `
    <li>
      <span class="act-icon">${a.icon}</span>
      <span class="act-text">${escHtml(a.text)}</span>
      <span class="act-time">${a.time}</span>
    </li>
  `).join('');
}

function renderInventory() {
  const list = qs('#itemList');
  const filtered = getSortedFiltered();

  if (filtered.length === 0) {
    list.innerHTML = items.length === 0
      ? '<li class="empty-state">No items yet. Tap + ADD to start.</li>'
      : '<li class="empty-state">No items match your search.</li>';
    return;
  }

  list.innerHTML = filtered.map(item => {
    const status = getStatus(item);
    return `
      <li class="item-row status-${status}" data-id="${item.id}" role="button" tabindex="0" aria-label="${escHtml(item.name)}, stock: ${item.stock}">
        <span class="item-name">${escHtml(item.name)}</span>
        <span class="item-stock">${item.stock}</span>
        <span class="item-chevron">›</span>
      </li>
    `;
  }).join('');

  // Attach click events
  list.querySelectorAll('.item-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openModal(row.dataset.id); });
  });
}

function renderAlerts() {
  const alertItems = items.filter(i => i.stock <= i.min);
  const list = qs('#alertList');

  if (alertItems.length === 0) {
    list.innerHTML = '<li class="empty-state">All stock levels OK ✓</li>';
    return;
  }

  alertItems.sort((a, b) => a.stock - b.stock);

  list.innerHTML = alertItems.map(item => {
    const status = getStatus(item);
    return `
      <li class="item-row status-${status}" data-id="${item.id}" role="button" tabindex="0">
        <span class="item-name">${escHtml(item.name)}</span>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
          <span class="item-stock">${item.stock}</span>
          <span class="alert-min-label">min: ${item.min}</span>
        </div>
        <span class="item-chevron">›</span>
      </li>
    `;
  }).join('');

  list.querySelectorAll('.item-row').forEach(row => {
    row.addEventListener('click', () => {
      openModal(row.dataset.id);
    });
  });
}

function updateAlertBadge() {
  const count = items.filter(i => i.stock <= i.min).length;
  const badge = qs('#alertBadge');
  badge.textContent = count;
  badge.classList.toggle('visible', count > 0);
}

// ─── MODAL ────────────────────────────────────────────────
function openModal(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  activeItemId = id;

  qs('#modalTitle').textContent = item.name;
  updateModalStock(item.stock);
  qs('#modalMinStock').textContent = item.min;
  qs('#qtyInput').value = 1;

  const overlay = qs('#modalOverlay');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  qs('#modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  activeItemId = null;
}

function updateModalStock(val) {
  qs('#modalCurrentStock').textContent = val;
  const item = items.find(i => i.id === activeItemId);
  const status = item ? getStatus(item) : 'ok';
  const el = qs('#modalCurrentStock');
  el.style.color = status === 'out' ? 'var(--red)'
    : status === 'warn' ? 'var(--warn)'
    : 'var(--amber)';
}

// ─── STOCK ACTIONS ────────────────────────────────────────
async function adjustStock(delta) {
  const item = items.find(i => i.id === activeItemId);
  if (!item) return;

  const qty = parseInt(qs('#qtyInput').value, 10);
  if (isNaN(qty) || qty <= 0) { showToast('Enter a valid quantity'); return; }

  const newStock = Math.max(0, item.stock + delta * qty);
  item.stock = newStock;
  item.updatedAt = Date.now();

  await dbPut(item);

  const icon = delta > 0 ? '＋' : '−';
  const label = delta > 0 ? 'Added' : 'Removed';
  logActivity(icon, `${label} ${qty} × ${item.name} → ${newStock}`, item);

  updateModalStock(newStock);
  qs('#modalMinStock').textContent = item.min;
  render();
  showToast(`${label} ${qty} — Stock: ${newStock}`);
}

async function deleteItem() {
  if (!activeItemId) return;
  const item = items.find(i => i.id === activeItemId);
  if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;

  await dbDelete(activeItemId);
  items = items.filter(i => i.id !== activeItemId);
  logActivity('🗑', `Deleted ${item.name}`);

  closeModal();
  render();
  showToast(`Deleted: ${item.name}`);
}

// ─── ADD ITEM ─────────────────────────────────────────────
async function addItem() {
  const nameEl = qs('#newName');
  const stockEl = qs('#newStock');
  const minEl = qs('#newMin');

  const name = nameEl.value.trim();
  const stock = parseInt(stockEl.value, 10) || 0;
  const min = parseInt(minEl.value, 10) || 0;

  if (!name) { showToast('Enter an item name'); nameEl.focus(); return; }
  if (items.some(i => i.name.toLowerCase() === name.toLowerCase())) {
    showToast('Item already exists'); nameEl.focus(); return;
  }

  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    name,
    stock,
    min,
    updatedAt: Date.now()
  };

  await dbPut(item);
  items.push(item);
  logActivity('⊕', `Added ${name} (stock: ${stock})`, item);

  nameEl.value = '';
  stockEl.value = '';
  minEl.value = '';
  nameEl.focus();

  render();
  showToast(`Added: ${name}`);
  switchTab('inventory');
}

// ─── ACTIVITY LOG ─────────────────────────────────────────
function logActivity(icon, text, item) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  activity.push({ icon, text, time, ts: Date.now() });
  if (activity.length > 50) activity.shift();
  dbPutMeta('activity', activity);
}

// ─── CSV EXPORT ───────────────────────────────────────────
function exportCSV() {
  if (items.length === 0) { showToast('No items to export'); return; }
  const rows = [['Name', 'Stock', 'Min Alert', 'Status']];
  items.forEach(i => rows.push([
    `"${i.name.replace(/"/g, '""')}"`,
    i.stock,
    i.min,
    getStatus(i)
  ]));
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stockyard_${dateStamp()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported to CSV');
}

// ─── CSV IMPORT ───────────────────────────────────────────
function importCSV(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const lines = e.target.result.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) { showToast('CSV is empty or invalid'); return; }

    // Skip header row
    const rows = lines.slice(1);
    let added = 0, skipped = 0;

    for (const row of rows) {
      const cols = parseCSVRow(row);
      if (!cols[0]) continue;
      const name = cols[0].replace(/^"|"$/g, '').replace(/""/g, '"').trim();
      const stock = parseInt(cols[1], 10) || 0;
      const min = parseInt(cols[2], 10) || 0;

      if (!name) continue;
      if (items.some(i => i.name.toLowerCase() === name.toLowerCase())) { skipped++; continue; }

      const item = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
        name, stock, min, updatedAt: Date.now()
      };
      await dbPut(item);
      items.push(item);
      added++;
    }

    logActivity('↑', `Imported ${added} items (${skipped} skipped)`);
    render();
    showToast(`Imported ${added} items${skipped ? `, ${skipped} skipped` : ''}`);
  };
  reader.readAsText(file);
}

function parseCSVRow(row) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '"') {
      if (inQuotes && row[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (row[i] === ',' && !inQuotes) {
      cols.push(current); current = '';
    } else {
      current += row[i];
    }
  }
  cols.push(current);
  return cols;
}

// ─── EDIT MIN STOCK ───────────────────────────────────────
async function editMinStock() {
  const item = items.find(i => i.id === activeItemId);
  if (!item) return;
  const val = prompt(`Set low stock alert threshold for "${item.name}":`, item.min);
  if (val === null) return;
  const num = parseInt(val, 10);
  if (isNaN(num) || num < 0) { showToast('Invalid number'); return; }
  item.min = num;
  item.updatedAt = Date.now();
  await dbPut(item);
  qs('#modalMinStock').textContent = num;
  updateModalStock(item.stock);
  render();
  showToast(`Alert threshold set to ${num}`);
}

// ─── SEARCH ───────────────────────────────────────────────
function handleSearch(val) {
  searchQuery = val;
  qs('#clearSearch').classList.toggle('visible', val.length > 0);
  renderInventory();
}

// ─── TABS ─────────────────────────────────────────────────
function switchTab(name) {
  qsAll('.tab').forEach(t => {
    const active = t.dataset.tab === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });
  qsAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${name}`);
  });
}

// ─── DARK MODE ────────────────────────────────────────────
async function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    document.documentElement.removeAttribute('data-theme');
    await dbPutMeta('theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    await dbPutMeta('theme', 'light');
  }
}

// ─── SERVICE WORKER (PWA) ─────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ─── EVENTS ───────────────────────────────────────────────
function setupEvents() {
  // Tabs
  qsAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Add item
  qs('#addItemBtn').addEventListener('click', addItem);
  qs('#newName').addEventListener('keydown', e => { if (e.key === 'Enter') qs('#newStock').focus(); });
  qs('#newStock').addEventListener('keydown', e => { if (e.key === 'Enter') qs('#newMin').focus(); });
  qs('#newMin').addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });

  // Search
  qs('#searchInput').addEventListener('input', e => handleSearch(e.target.value));
  qs('#clearSearch').addEventListener('click', () => {
    qs('#searchInput').value = '';
    handleSearch('');
    qs('#searchInput').focus();
  });

  // Sort
  qsAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qsAll('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSort = btn.dataset.sort;
      renderInventory();
    });
  });

  // Modal
  qs('#modalClose').addEventListener('click', closeModal);
  qs('#modalOverlay').addEventListener('click', e => {
    if (e.target === qs('#modalOverlay')) closeModal();
  });
  qs('#btnAdd').addEventListener('click', () => adjustStock(1));
  qs('#btnRemove').addEventListener('click', () => adjustStock(-1));
  qs('#btnDelete').addEventListener('click', deleteItem);
  qs('#editMinBtn').addEventListener('click', editMinStock);

  // Qty steppers
  qs('#qtyDown').addEventListener('click', () => {
    const input = qs('#qtyInput');
    const val = Math.max(1, parseInt(input.value, 10) - 1);
    input.value = val;
  });
  qs('#qtyUp').addEventListener('click', () => {
    const input = qs('#qtyInput');
    const val = (parseInt(input.value, 10) || 0) + 1;
    input.value = val;
  });

  // Keyboard: close modal on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && qs('#modalOverlay').classList.contains('open')) closeModal();
  });

  // Export/Import
  qs('#exportBtn').addEventListener('click', exportCSV);
  qs('#importFile').addEventListener('change', e => {
    importCSV(e.target.files[0]);
    e.target.value = '';
  });

  // Dark mode
  qs('#darkToggle').addEventListener('click', toggleTheme);
}

// ─── HELPERS ──────────────────────────────────────────────
function qs(sel) { return document.querySelector(sel); }
function qsAll(sel) { return document.querySelectorAll(sel); }
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

let toastTimer;
function showToast(msg) {
  const toast = qs('#toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ─── BOOT ─────────────────────────────────────────────────
init().catch(err => {
  console.error('STOCKYARD init failed:', err);
  alert('Failed to initialize database. Please refresh.');
});
