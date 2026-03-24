/* ═══════════════════════════════════════════
   STOCKYARD — app.js  v4
   + Buying price (per restock, latest stored)
   + Total stock value on dashboard
═══════════════════════════════════════════ */

import { initializeApp }              from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, onSnapshot,
         updateDoc, deleteDoc, setDoc, query, orderBy }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─────────────────────────────────────────────────────────
//  🔧 PASTE YOUR FIREBASE CONFIG HERE
// ─────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "PASTE_HERE",
  authDomain:        "PASTE_HERE",
  projectId:         "PASTE_HERE",
  storageBucket:     "PASTE_HERE",
  messagingSenderId: "PASTE_HERE",
  appId:             "PASTE_HERE"
};

const FIREBASE_READY = FIREBASE_CONFIG.apiKey !== "PASTE_HERE";

// ─── STATE ───────────────────────────────────────────────
let firestoreDB  = null;
let items        = [];
let activity     = [];
let activeItemId = null;
let activeUnit   = 'Nos';
let currentSort  = 'name';
let searchQuery  = '';

// ─── LOCAL FALLBACK (IndexedDB) ───────────────────────────
let idb = null;

function openIDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('stockyard_db', 3);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta'))  d.createObjectStore('meta',  { keyPath: 'key' });
    };
    r.onsuccess = e => { idb = e.target.result; res(); };
    r.onerror   = () => rej(r.error);
  });
}
const idbTx      = (store, mode, fn) => new Promise((res, rej) => {
  const tx = idb.transaction(store, mode), req = fn(tx.objectStore(store));
  req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
});
const idbGetAll  = ()         => idbTx('items','readonly', s=>s.getAll());
const idbPut     = item       => idbTx('items','readwrite',s=>s.put(item));
const idbDel     = id         => idbTx('items','readwrite',s=>s.delete(id));
const idbMetaGet = key        => idbTx('meta', 'readonly', s=>s.get(key)).then(r=>r?r.value:null);
const idbMetaSet = (key, val) => idbTx('meta', 'readwrite',s=>s.put({key,value:val}));

// ─── INIT ─────────────────────────────────────────────────
async function init() {
  await openIDB();
  setSyncDot('syncing');

  if (FIREBASE_READY) {
    try {
      const app = initializeApp(FIREBASE_CONFIG);
      firestoreDB = getFirestore(app);
      qs('#setupBanner').classList.remove('visible');
      startFirestoreListener();
    } catch(e) {
      console.error('Firebase init failed:', e);
      await fallbackToLocal();
    }
  } else {
    qs('#setupBanner').classList.add('visible');
    await fallbackToLocal();
  }

  const theme = await idbMetaGet('theme').catch(()=>null);
  if (theme === 'light') document.documentElement.setAttribute('data-theme','light');
  setupEvents();
  registerSW();
}

async function fallbackToLocal() {
  items = await idbGetAll();
  for (const item of items) {
    if (!item.unit)  { item.unit  = 'Nos'; await idbPut(item); }
    if (!item.price) { item.price = 0;     await idbPut(item); }
  }
  const saved = await idbMetaGet('activity').catch(()=>null);
  if (saved) activity = saved;
  render();
  setSyncDot('offline');
}

// ─── FIRESTORE ────────────────────────────────────────────
function startFirestoreListener() {
  const q = query(collection(firestoreDB,'items'), orderBy('name'));
  onSnapshot(q,
    snap => { items = snap.docs.map(d=>({id:d.id,...d.data()})); render(); setSyncDot('synced'); },
    err  => { console.error(err); setSyncDot('offline'); }
  );
  onSnapshot(doc(firestoreDB,'meta','activity'), snap => {
    if (snap.exists()) { activity = snap.data().log||[]; renderDashboard(); }
  });
}

async function fsSet(item)   { const {id,...d}=item; await setDoc(doc(firestoreDB,'items',id),d); }
async function fsUpdate(item){ const {id,...d}=item; await updateDoc(doc(firestoreDB,'items',id),d); }
async function fsDel(id)     { await deleteDoc(doc(firestoreDB,'items',id)); }
async function fsSaveActivity(){ await setDoc(doc(firestoreDB,'meta','activity'),{log:activity}); }

// ─── UNIFIED SAVE ─────────────────────────────────────────
async function saveItem(item) {
  if (FIREBASE_READY && firestoreDB) { setSyncDot('syncing'); await fsUpdate(item); }
  else { await idbPut(item); render(); }
}
async function createItem(item) {
  if (FIREBASE_READY && firestoreDB) { setSyncDot('syncing'); await fsSet(item); }
  else { await idbPut(item); items.push(item); render(); }
}
async function removeItem(id) {
  if (FIREBASE_READY && firestoreDB) { setSyncDot('syncing'); await fsDel(id); }
  else { await idbDel(id); items=items.filter(i=>i.id!==id); render(); }
}
async function saveActivity() {
  if (FIREBASE_READY && firestoreDB) await fsSaveActivity();
  else await idbMetaSet('activity', activity);
}

// ─── UNIT / PRICE HELPERS ────────────────────────────────
function formatStock(stock, unit) {
  if (unit==='Kgs') return parseFloat((+stock).toFixed(3)).toString();
  return Math.floor(+stock).toString();
}
function parseQty(val, unit) {
  if (unit==='Kgs') { const n=parseFloat(val); return isNaN(n)||n<=0?null:n; }
  const n=parseInt(val,10); return isNaN(n)||n<=0?null:n;
}
function stepValue(unit) { return unit==='Kgs'?0.5:1; }

function formatPrice(price) {
  if (!price || price===0) return '—';
  return '₹' + parseFloat((+price).toFixed(2)).toLocaleString('en-IN');
}

function totalValue(item) {
  if (!item.price || item.price===0) return 0;
  return item.stock * item.price;
}

// ─── RENDER ───────────────────────────────────────────────
function render() {
  renderDashboard();
  renderInventory();
  renderAlerts();
  updateAlertBadge();
}

function getStatus(item) {
  if (item.stock<=0)        return 'out';
  if (item.stock<=item.min) return 'warn';
  return 'ok';
}

function getSortedFiltered() {
  let list = items.filter(i=>i.name.toLowerCase().includes(searchQuery.toLowerCase()));
  if (currentSort==='name')       list.sort((a,b)=>a.name.localeCompare(b.name));
  else if (currentSort==='stock-asc')  list.sort((a,b)=>a.stock-b.stock);
  else if (currentSort==='stock-desc') list.sort((a,b)=>b.stock-a.stock);
  return list;
}

function renderDashboard() {
  const total = items.length;
  const low   = items.filter(i=>i.stock>0&&i.stock<=i.min).length;
  const out   = items.filter(i=>i.stock<=0).length;
  const ok    = total-low-out;
  qs('#statTotal').textContent = total;
  qs('#statOk').textContent    = ok;
  qs('#statLow').textContent   = low;
  qs('#statOut').textContent   = out;

  // Total inventory value
  const totalVal = items.reduce((sum,i)=>sum+totalValue(i),0);
  const valEl = qs('#statValue');
  if (valEl) valEl.textContent = totalVal > 0
    ? '₹' + totalVal.toLocaleString('en-IN', {maximumFractionDigits:0})
    : '—';

  const log = qs('#activityLog');
  if (!activity.length) { log.innerHTML='<li class="empty-state">No activity yet.</li>'; return; }
  log.innerHTML = activity.slice().reverse().slice(0,20).map(a=>`
    <li>
      <span class="act-icon">${a.icon}</span>
      <span class="act-text">${escHtml(a.text)}</span>
      <span class="act-time">${a.time}</span>
    </li>`).join('');
}

function renderInventory() {
  const list     = qs('#itemList');
  const filtered = getSortedFiltered();
  if (!filtered.length) {
    list.innerHTML = items.length===0
      ? '<li class="empty-state">No items yet. Tap + ADD to start.</li>'
      : '<li class="empty-state">No items match your search.</li>';
    return;
  }
  list.innerHTML = filtered.map(item=>{
    const status = getStatus(item);
    const unit   = item.unit||'Nos';
    return `
      <li class="item-row status-${status}" data-id="${item.id}" role="button" tabindex="0">
        <span class="item-name">${escHtml(item.name)}</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="item-stock">${formatStock(item.stock,unit)}</span>
          <span class="item-unit">${unit}</span>
        </div>
        <span class="item-chevron">›</span>
      </li>`;
  }).join('');
  list.querySelectorAll('.item-row').forEach(row=>{
    row.addEventListener('click',()=>openModal(row.dataset.id));
    row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')openModal(row.dataset.id);});
  });
}

function renderAlerts() {
  const alertItems = items.filter(i=>i.stock<=i.min);
  const list = qs('#alertList');
  if (!alertItems.length) { list.innerHTML='<li class="empty-state">All stock levels OK ✓</li>'; return; }
  alertItems.sort((a,b)=>a.stock-b.stock);
  list.innerHTML = alertItems.map(item=>{
    const status=getStatus(item), unit=item.unit||'Nos';
    return `
      <li class="item-row status-${status}" data-id="${item.id}" role="button" tabindex="0">
        <span class="item-name">${escHtml(item.name)}</span>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="item-stock">${formatStock(item.stock,unit)}</span>
            <span class="item-unit">${unit}</span>
          </div>
          <span class="alert-min-label">min: ${formatStock(item.min,unit)}</span>
        </div>
        <span class="item-chevron">›</span>
      </li>`;
  }).join('');
  list.querySelectorAll('.item-row').forEach(row=>row.addEventListener('click',()=>openModal(row.dataset.id)));
}

function updateAlertBadge() {
  const count=items.filter(i=>i.stock<=i.min).length;
  const badge=qs('#alertBadge');
  badge.textContent=count;
  badge.classList.toggle('visible',count>0);
}

// ─── SYNC DOT ─────────────────────────────────────────────
function setSyncDot(state) {
  const dot=qs('#syncDot');
  dot.className='sync-dot '+state;
  dot.title=state==='synced'?'Live — synced':state==='syncing'?'Syncing…':'Offline — local only';
}

// ─── MODAL ────────────────────────────────────────────────
function openModal(id) {
  const item=items.find(i=>i.id===id);
  if (!item) return;
  activeItemId=id;
  activeUnit=item.unit||'Nos';
  setActiveUnitBtn(activeUnit);
  updateQtyInputMode(activeUnit);
  qs('#modalTitle').textContent    = item.name;
  qs('#modalMinStock').textContent = formatStock(item.min,activeUnit);
  qs('#modalPrice').textContent    = formatPrice(item.price||0);
  qs('#modalItemValue').textContent= item.price && item.stock
    ? '₹'+(item.stock*item.price).toLocaleString('en-IN',{maximumFractionDigits:0})
    : '—';
  updateModalStock(item.stock);
  // Reset price input
  qs('#priceInput').value = item.price && item.price > 0 ? item.price : '';
  // Show price row only in add mode
  showPriceInput(false);
  qs('#modalOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}

function showPriceInput(show) {
  qs('#priceRow').style.display = show ? 'flex' : 'none';
}

function closeModal() {
  qs('#modalOverlay').classList.remove('open');
  document.body.style.overflow='';
  activeItemId=null;
}

function setActiveUnitBtn(unit) {
  qsAll('#unitSelector .unit-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.unit===unit));
}

function updateQtyInputMode(unit) {
  const input=qs('#qtyInput');
  input.step=unit==='Kgs'?'0.5':'1';
  input.value=unit==='Kgs'?'0.5':'1';
}

function updateModalStock(val) {
  const item=items.find(i=>i.id===activeItemId);
  const unit=item?(item.unit||'Nos'):'Nos';
  const status=item?getStatus(item):'ok';
  qs('#modalCurrentStock').textContent=formatStock(val,unit);
  qs('#modalCurrentStock').style.color=
    status==='out'?'var(--red)':status==='warn'?'var(--warn)':'var(--amber)';
}

// ─── STOCK ACTIONS ────────────────────────────────────────
async function adjustStock(delta) {
  const item=items.find(i=>i.id===activeItemId);
  if (!item) return;
  const qty=parseQty(qs('#qtyInput').value, activeUnit);
  if (qty===null) { showToast('Enter a valid quantity'); return; }

  // If adding stock, capture buying price
  if (delta > 0) {
    const priceVal = parseFloat(qs('#priceInput').value);
    if (!isNaN(priceVal) && priceVal > 0) {
      item.price = priceVal;
    }
  }

  const newStock=Math.max(0, item.stock+delta*qty);
  item.stock=newStock;
  item.updatedAt=Date.now();
  await saveItem(item);

  const label=delta>0?'Added':'Removed';
  const unit=item.unit||'Nos';
  const priceNote = delta>0 && item.price ? ` @ ${formatPrice(item.price)}` : '';
  logActivity(delta>0?'＋':'−',
    `${label} ${formatStock(qty,activeUnit)} ${activeUnit} × ${item.name}${priceNote} → ${formatStock(newStock,unit)} ${unit}`);

  // Update modal display
  updateModalStock(newStock);
  qs('#modalPrice').textContent = formatPrice(item.price||0);
  qs('#modalItemValue').textContent = item.price && newStock
    ? '₹'+(newStock*item.price).toLocaleString('en-IN',{maximumFractionDigits:0})
    : '—';
  showPriceInput(false);
  showToast(`${label} ${formatStock(qty,activeUnit)} ${activeUnit} — Stock: ${formatStock(newStock,unit)} ${unit}`);
}

async function deleteItem() {
  if (!activeItemId) return;
  const item=items.find(i=>i.id===activeItemId);
  if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
  await removeItem(activeItemId);
  logActivity('🗑',`Deleted ${item.name}`);
  closeModal();
  showToast(`Deleted: ${item.name}`);
}

// ─── ADD ITEM ─────────────────────────────────────────────
async function addItem() {
  const nameEl=qs('#newName'), stockEl=qs('#newStock'), minEl=qs('#newMin');
  const unitVal=qs('#newUnit').value||'Nos';
  const priceVal=parseFloat(qs('#newPrice').value)||0;
  const name=nameEl.value.trim();
  const stock=unitVal==='Kgs'?(parseFloat(stockEl.value)||0):(parseInt(stockEl.value,10)||0);
  const min=unitVal==='Kgs'?(parseFloat(minEl.value)||0):(parseInt(minEl.value,10)||0);
  if (!name) { showToast('Enter an item name'); nameEl.focus(); return; }
  if (items.some(i=>i.name.toLowerCase()===name.toLowerCase())) {
    showToast('Item already exists'); nameEl.focus(); return;
  }
  const item={
    id: crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2),
    name, stock, min, unit:unitVal, price:priceVal, updatedAt:Date.now()
  };
  await createItem(item);
  logActivity('⊕',`Added ${name} (${formatStock(stock,unitVal)} ${unitVal}${priceVal?` @ ${formatPrice(priceVal)}`:''})`);
  nameEl.value=''; stockEl.value=''; minEl.value=''; qs('#newPrice').value='';
  qs('#newUnit').value='Nos';
  qsAll('.unit-btn-form').forEach(b=>b.classList.toggle('active',b.dataset.unit==='Nos'));
  nameEl.focus();
  showToast(`Added: ${name}`);
  switchTab('inventory');
}

// ─── ACTIVITY LOG ─────────────────────────────────────────
function logActivity(icon, text) {
  const time=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  activity.push({icon,text,time,ts:Date.now()});
  if (activity.length>50) activity.shift();
  saveActivity();
  renderDashboard();
}

// ─── CSV EXPORT ───────────────────────────────────────────
function exportCSV() {
  if (!items.length) { showToast('No items to export'); return; }
  const rows=[['Name','Stock','Unit','Min Alert','Buying Price','Stock Value','Status']];
  items.forEach(i=>{
    const u=i.unit||'Nos';
    rows.push([
      `"${i.name.replace(/"/g,'""')}"`,
      formatStock(i.stock,u), u, formatStock(i.min,u),
      i.price||0,
      i.price?(i.stock*i.price).toFixed(2):0,
      getStatus(i)
    ]);
  });
  const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`stockyard_${dateStamp()}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast('Exported to CSV');
}

// ─── CSV IMPORT ───────────────────────────────────────────
function importCSV(file) {
  if (!file) return;
  showToast('Reading file…');
  const reader=new FileReader();
  reader.onload=async e=>{
    try {
      // Strip BOM if present (common in Excel-saved CSVs)
      let text = e.target.result.replace(/^\uFEFF/, '');
      // Support both comma and semicolon delimiters
      const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      if (lines.length<1) { showToast('CSV is empty'); return; }
      // Auto-detect if first row is a header (contains non-numeric in col 2)
      const firstCols = parseCSVRow(lines[0]);
      const startRow = (isNaN(parseFloat(firstCols[1])) || firstCols[0].toLowerCase().includes('name')) ? 1 : 0;
      let added=0,skipped=0;
      for (const row of lines.slice(startRow)) {
        const cols=parseCSVRow(row);
        const name=cols[0]?.replace(/^"|"$/g,'').replace(/""/g,'"').trim();
        if (!name) continue;
        if (items.some(i=>i.name.toLowerCase()===name.toLowerCase())) { skipped++; continue; }
        let stock,unit,min,price=0;
        if (cols.length>=4&&['Nos','Kgs','Box'].includes(cols[2]?.trim())) {
          stock=parseFloat(cols[1])||0; unit=cols[2].trim(); min=parseFloat(cols[3])||0; price=parseFloat(cols[4])||0;
        } else {
          stock=parseFloat(cols[1])||0; unit='Nos'; min=parseFloat(cols[2])||0; price=parseFloat(cols[3])||0;
        }
        const item={
          id:crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2),
          name,stock,unit,min,price,updatedAt:Date.now()
        };
        await createItem(item); added++;
      }
      logActivity('↑',`Imported ${added} items (${skipped} skipped)`);
      showToast(added>0?`Imported ${added} items${skipped?`, ${skipped} skipped`:''}`: `0 items imported — check CSV format`);
    } catch(err) {
      console.error('Import error:',err);
      showToast('Import failed — check file format');
    }
  };
  reader.onerror = () => showToast('Could not read file');
  reader.readAsText(file, 'UTF-8');
}

function parseCSVRow(row) {
  const cols=[]; let cur='',inQ=false;
  for(let i=0;i<row.length;i++){
    if(row[i]==='"'){if(inQ&&row[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
    else if(row[i]===','&&!inQ){cols.push(cur);cur='';}
    else cur+=row[i];
  }
  cols.push(cur); return cols;
}

// ─── EDIT MIN STOCK ───────────────────────────────────────
async function editMinStock() {
  const item=items.find(i=>i.id===activeItemId);
  if (!item) return;
  const unit=item.unit||'Nos';
  const val=prompt(`Alert threshold for "${item.name}" (${unit}):`, formatStock(item.min,unit));
  if (val===null) return;
  const num=unit==='Kgs'?parseFloat(val):parseInt(val,10);
  if (isNaN(num)||num<0) { showToast('Invalid number'); return; }
  item.min=num; item.updatedAt=Date.now();
  await saveItem(item);
  qs('#modalMinStock').textContent=formatStock(num,unit);
  updateModalStock(item.stock);
  showToast(`Threshold: ${formatStock(num,unit)} ${unit}`);
}

// ─── SEARCH / SORT / TABS / THEME ─────────────────────────
function handleSearch(val) {
  searchQuery=val;
  qs('#clearSearch').classList.toggle('visible',val.length>0);
  renderInventory();
}

function switchTab(name) {
  qsAll('.tab').forEach(t=>{const a=t.dataset.tab===name;t.classList.toggle('active',a);t.setAttribute('aria-selected',a);});
  qsAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===`tab-${name}`));
}

async function toggleTheme() {
  const isLight=document.documentElement.getAttribute('data-theme')==='light';
  if(isLight){document.documentElement.removeAttribute('data-theme');await idbMetaSet('theme','dark');}
  else{document.documentElement.setAttribute('data-theme','light');await idbMetaSet('theme','light');}
}

function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}

// ─── EVENTS ───────────────────────────────────────────────
function setupEvents() {
  qsAll('.tab').forEach(tab=>tab.addEventListener('click',()=>switchTab(tab.dataset.tab)));

  qs('#addItemBtn').addEventListener('click',addItem);
  qs('#newName').addEventListener('keydown',e=>{if(e.key==='Enter')qs('#newStock').focus();});
  qs('#newStock').addEventListener('keydown',e=>{if(e.key==='Enter')qs('#newMin').focus();});
  qs('#newMin').addEventListener('keydown',e=>{if(e.key==='Enter')qs('#newPrice').focus();});
  qs('#newPrice').addEventListener('keydown',e=>{if(e.key==='Enter')addItem();});

  qsAll('.unit-btn-form').forEach(btn=>btn.addEventListener('click',()=>{
    qsAll('.unit-btn-form').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); qs('#newUnit').value=btn.dataset.unit;
  }));

  qsAll('#unitSelector .unit-btn').forEach(btn=>btn.addEventListener('click',()=>{
    activeUnit=btn.dataset.unit; setActiveUnitBtn(activeUnit); updateQtyInputMode(activeUnit);
  }));

  // Show price input when ADD STOCK is about to be tapped
  qs('#btnAdd').addEventListener('click', async ()=>{
    const priceRow=qs('#priceRow');
    if (priceRow.style.display==='none'||!priceRow.style.display) {
      showPriceInput(true);
      qs('#priceInput').focus();
      showToast('Enter buying price, then tap ＋ again');
      return;
    }
    await adjustStock(1);
  });
  qs('#btnRemove').addEventListener('click',()=>adjustStock(-1));
  qs('#btnDelete').addEventListener('click',deleteItem);
  qs('#editMinBtn').addEventListener('click',editMinStock);

  qs('#searchInput').addEventListener('input',e=>handleSearch(e.target.value));
  qs('#clearSearch').addEventListener('click',()=>{qs('#searchInput').value='';handleSearch('');qs('#searchInput').focus();});

  qsAll('.sort-btn').forEach(btn=>btn.addEventListener('click',()=>{
    qsAll('.sort-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); currentSort=btn.dataset.sort; renderInventory();
  }));

  qs('#modalClose').addEventListener('click',closeModal);
  qs('#modalOverlay').addEventListener('click',e=>{if(e.target===qs('#modalOverlay'))closeModal();});

  qs('#qtyDown').addEventListener('click',()=>{
    const input=qs('#qtyInput'),step=stepValue(activeUnit);
    const val=Math.max(step,parseFloat(input.value)-step);
    input.value=activeUnit==='Kgs'?val.toFixed(1):Math.round(val);
  });
  qs('#qtyUp').addEventListener('click',()=>{
    const input=qs('#qtyInput'),step=stepValue(activeUnit);
    const val=(parseFloat(input.value)||0)+step;
    input.value=activeUnit==='Kgs'?val.toFixed(1):Math.round(val);
  });

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&qs('#modalOverlay').classList.contains('open'))closeModal();
  });

  qs('#exportBtn').addEventListener('click',exportCSV);
  qs('#importBtn').addEventListener('click',()=>qs('#importFile').click());
  qs('#importFile').addEventListener('change',e=>{
    if(e.target.files[0]) importCSV(e.target.files[0]);
    e.target.value='';
  });
  qs('#darkToggle').addEventListener('click',toggleTheme);
}

// ─── HELPERS ──────────────────────────────────────────────
function qs(s)    { return document.querySelector(s); }
function qsAll(s) { return document.querySelectorAll(s); }
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function dateStamp(){return new Date().toISOString().slice(0,10);}

let toastTimer;
function showToast(msg){
  const t=qs('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2400);
}

init().catch(err=>{ console.error('STOCKYARD init failed:',err); alert('Failed to initialize. Please refresh.'); });
