/* ═══════════════════════════════════════════
   STOCKYARD — app.js  v6
   Local-only (IndexedDB). No Firebase.
   + GST/Discount price calculator
═══════════════════════════════════════════ */

'use strict';

// ─── DEFAULT CATEGORIES ───────────────────
const DEFAULT_CATEGORIES = [
  "FASTENERS & FIXINGS",
  "CUTTING, DRILLING & ABRASIVES",
  "POWER TOOLS & MACHINES",
  "WELDING & GAS EQUIPMENT",
  "CHEMICALS & SPRAYS",
  "SAFETY & PPE",
  "ADHESIVES, TAPES & SEALING",
  "BRUSHES, CLEANING & MISC",
  "PNEUMATIC TOOLS",
  "MISCELLANEOUS ITEMS"
];

// ─── STATE ────────────────────────────────
let idb          = null;
let items        = [];
let categories   = [];
let activity     = [];
let activeItemId = null;
let activeUnit   = 'Nos';
let currentSort  = 'name';
let searchQuery  = '';
let editingCatId = null;
let openCatGroups = new Set();

// ─── IDB ──────────────────────────────────
function openIDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('stockyard_db', 5);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('items'))      d.createObjectStore('items',      { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta'))       d.createObjectStore('meta',       { keyPath: 'key' });
      if (!d.objectStoreNames.contains('categories')) d.createObjectStore('categories', { keyPath: 'id' });
    };
    r.onsuccess = e => { idb = e.target.result; res(); };
    r.onerror   = () => rej(r.error);
  });
}

const idbTx      = (store, mode, fn) => new Promise((res, rej) => {
  const tx = idb.transaction(store, mode), req = fn(tx.objectStore(store));
  req.onsuccess = () => res(req.result);
  req.onerror   = () => rej(req.error);
});
const idbGetAll  = store       => idbTx(store, 'readonly',  s => s.getAll());
const idbPut     = (store, obj)=> idbTx(store, 'readwrite', s => s.put(obj));
const idbDel     = (store, id) => idbTx(store, 'readwrite', s => s.delete(id));
const idbMetaGet = key         => idbTx('meta', 'readonly',  s => s.get(key)).then(r => r ? r.value : null);
const idbMetaSet = (key, val)  => idbTx('meta', 'readwrite', s => s.put({ key, value: val }));

// ─── INIT ─────────────────────────────────
async function init() {
  await openIDB();
  items      = await idbGetAll('items');
  categories = await idbGetAll('categories');

  // Migrate old items
  for (const item of items) {
    let changed = false;
    if (!item.unit)     { item.unit = 'Nos'; changed = true; }
    if (!item.price)    { item.price = 0;    changed = true; }
    if (!item.category) { item.category = ''; changed = true; }
    if (changed) await idbPut('items', item);
  }

  if (!categories.length) await initDefaultCategories();

  const saved = await idbMetaGet('activity').catch(() => null);
  if (saved) activity = saved;

  const theme = await idbMetaGet('theme').catch(() => null);
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');

  render();
  setupEvents();
  setupAllCalcs();
  registerSW();
}

async function initDefaultCategories() {
  categories = DEFAULT_CATEGORIES.map((name, i) => ({ id: 'cat_' + i, name }));
  for (const c of categories) await idbPut('categories', c);
}

// ─── SAVE HELPERS ─────────────────────────
async function saveItem(item)   { await idbPut('items', item);      render(); }
async function createItem(item) { await idbPut('items', item); items.push(item); render(); }
async function removeItem(id)   { await idbDel('items', id); items = items.filter(i => i.id !== id); render(); }
async function saveCat(cat) {
  await idbPut('categories', cat);
  const idx = categories.findIndex(c => c.id === cat.id);
  if (idx >= 0) categories[idx] = cat; else categories.push(cat);
  populateCategorySelects(); renderCategoryList();
}
async function removeCat(id) {
  await idbDel('categories', id);
  categories = categories.filter(c => c.id !== id);
  for (const item of items.filter(i => i.category === id)) {
    item.category = ''; await idbPut('items', item);
  }
  populateCategorySelects(); renderCategoryList(); render();
}
async function saveActivity() { await idbMetaSet('activity', activity); }

// ─── GST / DISCOUNT CALCULATOR ────────────────────────────
/*
  Formula (100% accurate):
    after_discount = base × (1 − discount/100)
    final          = after_discount × (1 + gst/100)

  Example: base=100, disc=20%, gst=18%
    after_discount = 100 × 0.80 = 80.00
    final          = 80 × 1.18  = 94.40  ✓
*/
function calcFinalPrice(base, discPct, gstPct) {
  const b = parseFloat(base)    || 0;
  const d = parseFloat(discPct) || 0;
  const g = parseFloat(gstPct)  || 0;
  const afterDiscount = b * (1 - d / 100);
  const gstAmount     = afterDiscount * (g / 100);
  const final         = afterDiscount + gstAmount;
  return {
    base:          b,
    discPct:       d,
    discAmount:    parseFloat((b - afterDiscount).toFixed(10)),
    afterDiscount: parseFloat(afterDiscount.toFixed(10)),
    gstPct:        g,
    gstAmount:     parseFloat(gstAmount.toFixed(10)),
    final:         parseFloat(final.toFixed(10))
  };
}

function renderBreakdown(blockId, result) {
  const el = qs('#' + blockId.replace('PriceCalc','CalcBreakdown').replace('Calc','CalcBreakdown'));
  if (!el) return;

  if (!result.base) {
    el.innerHTML = '<div class="calc-row"><span class="calc-label">Enter base price above</span></div>';
    return;
  }

  const fmt = n => '₹' + parseFloat(n.toFixed(2)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  el.innerHTML = `
    <div class="calc-row">
      <span class="calc-label">Base price</span>
      <span class="calc-val">${fmt(result.base)}</span>
    </div>
    ${result.discPct > 0 ? `
    <div class="calc-row">
      <span class="calc-label">Discount (${result.discPct}%)</span>
      <span class="calc-val" style="color:var(--green)">− ${fmt(result.discAmount)}</span>
    </div>
    <div class="calc-row">
      <span class="calc-label">After discount</span>
      <span class="calc-val">${fmt(result.afterDiscount)}</span>
    </div>` : ''}
    ${result.gstPct > 0 ? `
    <div class="calc-row">
      <span class="calc-label">GST (${result.gstPct}%)</span>
      <span class="calc-val" style="color:var(--warn)">+ ${fmt(result.gstAmount)}</span>
    </div>` : ''}
    <hr class="calc-divider" />
    <div class="calc-row total">
      <span class="calc-label">FINAL BUYING PRICE</span>
      <span class="calc-val ${result.final === 0 ? 'zero' : ''}">${fmt(result.final)}</span>
    </div>`;
}

function setupCalcBlock(blockId, hiddenInputId) {
  const block      = qs('#' + blockId);
  if (!block) return;

  const baseInput  = block.querySelector('.calc-base');
  const discInput  = block.querySelector('.calc-disc');
  const discBtns   = block.querySelectorAll('.disc-btn');
  const gstBtns    = block.querySelectorAll('.gst-btn');
  const hidden     = hiddenInputId ? qs('#' + hiddenInputId) : null;

  let discPct = 0, gstPct = 0;

  function recalc() {
    const result = calcFinalPrice(baseInput.value, discPct, gstPct);
    // Map blockId to breakdown id
    const breakdownId = blockId === 'addPriceCalc'     ? 'addCalcBreakdown'
                      : blockId === 'editPriceCalc'    ? 'editCalcBreakdown'
                      : blockId === 'restockPriceCalc' ? 'restockCalcBreakdown'
                      : null;
    if (breakdownId) renderBreakdown(breakdownId, result);
    if (hidden) hidden.value = result.final.toFixed(10);
  }

  baseInput.addEventListener('input', recalc);
  discInput.addEventListener('input', e => {
    discPct = Math.min(100, Math.max(0, parseFloat(e.target.value) || 0));
    discBtns.forEach(b => b.classList.toggle('active', +b.dataset.val === discPct));
    recalc();
  });

  discBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      discPct = +btn.dataset.val;
      discInput.value = discPct || '';
      discBtns.forEach(b => b.classList.toggle('active', b === btn));
      recalc();
    });
  });

  gstBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      gstPct = +btn.dataset.val;
      gstBtns.forEach(b => b.classList.toggle('active', b === btn));
      recalc();
    });
  });

  // Expose reset function
  block._reset = (existingPrice) => {
    discPct = 0; gstPct = 0;
    discInput.value = '';
    baseInput.value = existingPrice > 0 ? existingPrice : '';
    discBtns.forEach(b => b.classList.toggle('active', +b.dataset.val === 0));
    gstBtns.forEach(b => b.classList.toggle('active', +b.dataset.val === 0));
    recalc();
  };

  recalc();
}

function setupAllCalcs() {
  setupCalcBlock('addPriceCalc',     'newPrice');
  setupCalcBlock('editPriceCalc',    'editFinalPrice');
  setupCalcBlock('restockPriceCalc', 'restockFinalPrice');
}

// ─── HELPERS ──────────────────────────────
function getCatName(id)       { const c=categories.find(c=>c.id===id); return c?c.name:''; }
function formatStock(s, unit) { return unit==='Kgs'?parseFloat((+s).toFixed(3)).toString():Math.floor(+s).toString(); }
function parseQty(val, unit)  { if(unit==='Kgs'){const n=parseFloat(val);return isNaN(n)||n<=0?null:n;} const n=parseInt(val,10);return isNaN(n)||n<=0?null:n; }
function stepValue(unit)      { return unit==='Kgs'?0.5:1; }
function formatPrice(price)   { if(!price||price===0)return '—'; return '₹'+parseFloat((+price).toFixed(2)).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function totalValue(item)     { return (!item.price||item.price===0)?0:item.stock*item.price; }
function getStatus(item)      { if(item.stock<=0)return 'out';if(item.stock<=item.min)return 'warn';return 'ok'; }
function qs(s)                { return document.querySelector(s); }
function qsAll(s)             { return document.querySelectorAll(s); }
function escHtml(s)           { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function dateStamp()          { return new Date().toISOString().slice(0,10); }
function genId()              { return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2); }

function populateCategorySelects() {
  const sorted = [...categories].sort((a,b)=>a.name.localeCompare(b.name));
  const opts   = '<option value="">— No category —</option>'+sorted.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  qs('#newCategory').innerHTML  = opts;
  qs('#editCategory').innerHTML = opts;
}

// ─── RENDER ───────────────────────────────
function render() {
  renderDashboard(); renderInventory(); renderAlerts();
  updateAlertBadge(); populateCategorySelects(); renderCategoryList();
}

function getSortedFiltered() {
  let list = items.filter(i=>i.name.toLowerCase().includes(searchQuery.toLowerCase()));
  if (currentSort==='name')        list.sort((a,b)=>a.name.localeCompare(b.name));
  else if (currentSort==='stock-asc')  list.sort((a,b)=>a.stock-b.stock);
  else if (currentSort==='stock-desc') list.sort((a,b)=>b.stock-a.stock);
  return list;
}

function renderDashboard() {
  const total=items.length,low=items.filter(i=>i.stock>0&&i.stock<=i.min).length,
        out=items.filter(i=>i.stock<=0).length,ok=total-low-out;
  qs('#statTotal').textContent=total; qs('#statOk').textContent=ok;
  qs('#statLow').textContent=low;     qs('#statOut').textContent=out;
  const totalVal=items.reduce((s,i)=>s+totalValue(i),0);
  const valEl=qs('#statValue');
  if(valEl) valEl.textContent=totalVal>0?'₹'+totalVal.toLocaleString('en-IN',{maximumFractionDigits:0}):'—';
  const log=qs('#activityLog');
  if(!activity.length){log.innerHTML='<li class="empty-state">No activity yet.</li>';return;}
  log.innerHTML=activity.slice().reverse().slice(0,20).map(a=>
    `<li><span class="act-icon">${a.icon}</span><span class="act-text">${escHtml(a.text)}</span><span class="act-time">${a.time}</span></li>`
  ).join('');
}

function renderInventory() {
  const container=qs('#inventoryList');
  const filtered=getSortedFiltered();
  if (!filtered.length) {
    container.innerHTML=items.length===0
      ?'<ul class="item-list"><li class="empty-state">No items yet. Tap + ADD to start.</li></ul>'
      :'<ul class="item-list"><li class="empty-state">No items match your search.</li></ul>';
    return;
  }
  if (searchQuery) {
    container.innerHTML=`<ul class="item-list">${filtered.map(i=>itemRowHTML(i,true)).join('')}</ul>`;
    attachItemRowEvents(container); return;
  }
  // Group by category
  const grouped={}, noCat='__none__';
  for (const item of filtered) {
    const key=item.category||noCat;
    if(!grouped[key]) grouped[key]=[];
    grouped[key].push(item);
  }
  const sortedCats=[...categories].sort((a,b)=>a.name.localeCompare(b.name));
  let html='';
  for (const cat of sortedCats) {
    const catItems=grouped[cat.id];
    if(!catItems||!catItems.length) continue;
    const isOpen=openCatGroups.has(cat.id);
    const lowCount=catItems.filter(i=>getStatus(i)!=='ok').length;
    html+=`
      <div class="cat-group">
        <div class="cat-group-header ${isOpen?'open':''}" data-catid="${cat.id}">
          <span class="cat-group-title">${escHtml(cat.name)}</span>
          <span class="cat-group-meta">${catItems.length} items${lowCount?` · <span style="color:var(--warn)">${lowCount} low</span>`:''}</span>
          <span class="cat-group-chevron">›</span>
        </div>
        <ul class="cat-group-items ${isOpen?'open':''}">${catItems.map(i=>itemRowHTML(i,false)).join('')}</ul>
      </div>`;
  }
  if (grouped[noCat]?.length) {
    const uncatItems=grouped[noCat], isOpen=openCatGroups.has(noCat);
    html+=`
      <div class="cat-group">
        <div class="cat-group-header ${isOpen?'open':''}" data-catid="${noCat}">
          <span class="cat-group-title">UNCATEGORIZED</span>
          <span class="cat-group-meta">${uncatItems.length} items</span>
          <span class="cat-group-chevron">›</span>
        </div>
        <ul class="cat-group-items ${isOpen?'open':''}">${uncatItems.map(i=>itemRowHTML(i,false)).join('')}</ul>
      </div>`;
  }
  container.innerHTML=html||'<ul class="item-list"><li class="empty-state">No items yet.</li></ul>';
  container.querySelectorAll('.cat-group-header').forEach(header=>{
    header.addEventListener('click',()=>{
      const catId=header.dataset.catid;
      if(openCatGroups.has(catId)) openCatGroups.delete(catId); else openCatGroups.add(catId);
      renderInventory();
    });
  });
  attachItemRowEvents(container);
}

function itemRowHTML(item, showCat=true) {
  const status=getStatus(item), unit=item.unit||'Nos';
  const cat=showCat&&item.category?getCatName(item.category):'';
  return `
    <li class="item-row status-${status}" data-id="${item.id}" role="button" tabindex="0">
      <div style="flex:1;min-width:0;">
        <div class="item-name">${escHtml(item.name)}</div>
        ${cat?`<div class="item-cat-tag">${escHtml(cat)}</div>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="item-stock">${formatStock(item.stock,unit)}</span>
        <span class="item-unit">${unit}</span>
      </div>
      <span class="item-chevron">›</span>
    </li>`;
}

function attachItemRowEvents(container) {
  container.querySelectorAll('.item-row').forEach(row=>{
    row.addEventListener('click',()=>openModal(row.dataset.id));
    row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')openModal(row.dataset.id);});
  });
}

function renderAlerts() {
  const alertItems=items.filter(i=>i.stock<=i.min);
  const list=qs('#alertList');
  if(!alertItems.length){list.innerHTML='<li class="empty-state">All stock levels OK ✓</li>';return;}
  alertItems.sort((a,b)=>a.stock-b.stock);
  list.innerHTML=alertItems.map(item=>{
    const status=getStatus(item),unit=item.unit||'Nos';
    return `
      <li class="item-row status-${status}" data-id="${item.id}" role="button" tabindex="0">
        <div style="flex:1;min-width:0;">
          <div class="item-name">${escHtml(item.name)}</div>
          ${item.category?`<div class="item-cat-tag">${escHtml(getCatName(item.category))}</div>`:''}
        </div>
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

function renderCategoryList() {
  const list=qs('#catList');
  if(!list) return;
  if(!categories.length){list.innerHTML='<li class="empty-state">No categories yet.</li>';return;}
  const sorted=[...categories].sort((a,b)=>a.name.localeCompare(b.name));
  list.innerHTML=sorted.map(cat=>{
    const count=items.filter(i=>i.category===cat.id).length;
    return `
      <li class="cat-row">
        <span class="cat-row-name">${escHtml(cat.name)}</span>
        <span class="cat-row-count">${count} items</span>
        <button class="cat-row-edit" data-catid="${cat.id}" aria-label="Edit category">✎</button>
      </li>`;
  }).join('');
  list.querySelectorAll('.cat-row-edit').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();openCatModal(btn.dataset.catid);});
  });
}

function updateAlertBadge() {
  const count=items.filter(i=>i.stock<=i.min).length;
  qs('#alertBadge').textContent=count;
  qs('#alertBadge').classList.toggle('visible',count>0);
}

// ─── MODAL ────────────────────────────────
function openModal(id) {
  const item=items.find(i=>i.id===id);
  if(!item) return;
  activeItemId=id; activeUnit=item.unit||'Nos';
  showAdjustView();
  setActiveUnitBtn(activeUnit); updateQtyInputMode(activeUnit);
  qs('#modalTitle').textContent    = item.name;
  qs('#modalCatTag').textContent   = item.category?getCatName(item.category):'';
  qs('#modalMinStock').textContent = formatStock(item.min,activeUnit);
  qs('#modalPrice').textContent    = formatPrice(item.price||0);
  qs('#modalItemValue').textContent= item.price&&item.stock
    ?'₹'+(item.stock*item.price).toLocaleString('en-IN',{maximumFractionDigits:0}):'—';
  updateModalStock(item.stock);
  // Reset restock calc
  const rc=qs('#restockPriceCalc');
  if(rc&&rc._reset) rc._reset(item.price||0);
  hideRestockPrice();
  qs('#modalOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}

function hideRestockPrice() {
  qs('#restockPriceCalc').style.display='none';
  qs('#toggleRestockPrice').classList.remove('open');
}

function showAdjustView() {
  qs('#adjustView').style.display='block';
  qs('#editView').style.display='none';
  qs('#modalTag').textContent='ADJUST STOCK';
}

function showEditView() {
  const item=items.find(i=>i.id===activeItemId);
  if(!item) return;
  qs('#adjustView').style.display='none';
  qs('#editView').style.display='block';
  qs('#modalTag').textContent='EDIT ITEM';
  qs('#editName').value=item.name;
  qs('#editMin').value=formatStock(item.min,item.unit||'Nos');
  qs('#editUnit').value=item.unit||'Nos';
  qs('#editCategory').value=item.category||'';
  qsAll('#editUnitSelector .unit-btn-form').forEach(b=>b.classList.toggle('active',b.dataset.unit===(item.unit||'Nos')));
  // Pre-fill edit calc with current price
  const ec=qs('#editPriceCalc');
  if(ec&&ec._reset) ec._reset(item.price||0);
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
  qs('#modalCurrentStock').style.color=status==='out'?'var(--red)':status==='warn'?'var(--warn)':'var(--amber)';
}

// ─── SAVE EDIT ────────────────────────────
async function saveEdit() {
  const item=items.find(i=>i.id===activeItemId);
  if(!item) return;
  const name=qs('#editName').value.trim();
  const unit=qs('#editUnit').value||'Nos';
  const min=unit==='Kgs'?parseFloat(qs('#editMin').value)||0:parseInt(qs('#editMin').value,10)||0;
  const finalPrice=parseFloat(qs('#editFinalPrice').value)||0;
  const cat=qs('#editCategory').value||'';
  if(!name){showToast('Name cannot be empty');return;}
  if(items.some(i=>i.id!==activeItemId&&i.name.toLowerCase()===name.toLowerCase())){showToast('Another item has this name');return;}
  item.name=name; item.unit=unit; item.min=min; item.price=finalPrice;
  item.category=cat; item.updatedAt=Date.now();
  await saveItem(item);
  logActivity('✎',`Edited ${name}${finalPrice?` — price: ${formatPrice(finalPrice)}`:''}` );
  qs('#modalTitle').textContent=item.name;
  qs('#modalCatTag').textContent=cat?getCatName(cat):'';
  qs('#modalPrice').textContent=formatPrice(finalPrice);
  qs('#modalItemValue').textContent=finalPrice&&item.stock
    ?'₹'+(item.stock*finalPrice).toLocaleString('en-IN',{maximumFractionDigits:0}):'—';
  showAdjustView();
  updateModalStock(item.stock);
  showToast(`Saved: ${name}`);
}

// ─── STOCK ACTIONS ────────────────────────
async function adjustStock(delta) {
  const item=items.find(i=>i.id===activeItemId);
  if(!item) return;
  const qty=parseQty(qs('#qtyInput').value,activeUnit);
  if(qty===null){showToast('Enter a valid quantity');return;}
  if(delta>0) {
    const restockCalcVisible=qs('#restockPriceCalc').style.display!=='none';
    if(restockCalcVisible) {
      const p=parseFloat(qs('#restockFinalPrice').value)||0;
      if(p>0) item.price=p;
    }
  }
  const newStock=Math.max(0,item.stock+delta*qty);
  item.stock=newStock; item.updatedAt=Date.now();
  await saveItem(item);
  const label=delta>0?'Added':'Removed', unit=item.unit||'Nos';
  logActivity(delta>0?'＋':'−',
    `${label} ${formatStock(qty,activeUnit)} ${activeUnit} × ${item.name} → ${formatStock(newStock,unit)} ${unit}`);
  updateModalStock(newStock);
  qs('#modalPrice').textContent=formatPrice(item.price||0);
  qs('#modalItemValue').textContent=item.price&&newStock
    ?'₹'+(newStock*item.price).toLocaleString('en-IN',{maximumFractionDigits:0}):'—';
  hideRestockPrice();
  showToast(`${label} ${formatStock(qty,activeUnit)} ${activeUnit} — Stock: ${formatStock(newStock,unit)} ${unit}`);
}

async function deleteItem() {
  const item=items.find(i=>i.id===activeItemId);
  if(!item||!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
  await removeItem(activeItemId);
  logActivity('🗑',`Deleted ${item.name}`);
  closeModal(); showToast(`Deleted: ${item.name}`);
}

// ─── ADD ITEM ─────────────────────────────
async function addItem() {
  const nameEl=qs('#newName'),stockEl=qs('#newStock'),minEl=qs('#newMin');
  const unitVal=qs('#newUnit').value||'Nos';
  const finalPrice=parseFloat(qs('#newPrice').value)||0;
  const catVal=qs('#newCategory').value||'';
  const name=nameEl.value.trim();
  const stock=unitVal==='Kgs'?(parseFloat(stockEl.value)||0):(parseInt(stockEl.value,10)||0);
  const min=unitVal==='Kgs'?(parseFloat(minEl.value)||0):(parseInt(minEl.value,10)||0);
  if(!name){showToast('Enter an item name');nameEl.focus();return;}
  if(items.some(i=>i.name.toLowerCase()===name.toLowerCase())){showToast('Item already exists');nameEl.focus();return;}
  const item={id:genId(),name,stock,min,unit:unitVal,price:finalPrice,category:catVal,updatedAt:Date.now()};
  await createItem(item);
  logActivity('⊕',`Added ${name} (${formatStock(stock,unitVal)} ${unitVal}${finalPrice?` @ ${formatPrice(finalPrice)}`:''})`);
  nameEl.value='';stockEl.value='';minEl.value='';
  qs('#newUnit').value='Nos';qs('#newCategory').value='';
  qsAll('.unit-btn-form').forEach(b=>b.classList.toggle('active',b.dataset.unit==='Nos'));
  const ac=qs('#addPriceCalc');
  if(ac&&ac._reset) ac._reset(0);
  nameEl.focus();showToast(`Added: ${name}`);switchTab('inventory');
}

// ─── CATEGORY MODAL ───────────────────────
function openCatModal(catId) {
  editingCatId=catId;
  const cat=categories.find(c=>c.id===catId);
  if(!cat) return;
  qs('#editCatName').value=cat.name;
  qs('#catModalOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeCatModal() {
  qs('#catModalOverlay').classList.remove('open');
  document.body.style.overflow='';
  editingCatId=null;
}
async function saveCatEdit() {
  const name=qs('#editCatName').value.trim();
  if(!name){showToast('Enter a category name');return;}
  const cat=categories.find(c=>c.id===editingCatId);
  if(!cat) return;
  cat.name=name; await saveCat(cat);
  closeCatModal();showToast(`Category updated: ${name}`);
}
async function deleteCat() {
  const cat=categories.find(c=>c.id===editingCatId);
  if(!cat||!confirm(`Delete "${cat.name}"?\nItems will become uncategorized.`)) return;
  await removeCat(editingCatId);
  closeCatModal();showToast(`Deleted: ${cat.name}`);
}
async function addCategory() {
  const nameEl=qs('#newCatName');
  const name=nameEl.value.trim();
  if(!name){showToast('Enter a category name');nameEl.focus();return;}
  if(categories.some(c=>c.name.toLowerCase()===name.toLowerCase())){showToast('Category already exists');return;}
  const cat={id:'cat_'+genId(),name};
  await saveCat(cat);nameEl.value='';showToast(`Added: ${name}`);
}

// ─── ACTIVITY ─────────────────────────────
function logActivity(icon,text) {
  const time=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  activity.push({icon,text,time,ts:Date.now()});
  if(activity.length>50) activity.shift();
  saveActivity();renderDashboard();
}

// ─── CSV ──────────────────────────────────
function exportCSV() {
  if(!items.length){showToast('No items to export');return;}
  const rows=[['Name','Category','Stock','Unit','Min Alert','Buying Price','Stock Value','Status']];
  items.forEach(i=>{
    const u=i.unit||'Nos';
    rows.push([`"${i.name.replace(/"/g,'""')}"`,`"${getCatName(i.category)}"`,
      formatStock(i.stock,u),u,formatStock(i.min,u),
      i.price?parseFloat((+i.price).toFixed(2)):0,
      i.price?parseFloat((i.stock*i.price).toFixed(2)):0,
      getStatus(i)]);
  });
  const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`stockyard_${dateStamp()}.csv`;a.click();
  URL.revokeObjectURL(url);showToast('Exported to CSV');
}

function importCSV(file) {
  if(!file) return;
  showToast('Reading file…');
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      let text=e.target.result.replace(/^\uFEFF/,'');
      const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      if(!lines.length){showToast('CSV is empty');return;}
      const firstCols=parseCSVRow(lines[0]);
      const startRow=(isNaN(parseFloat(firstCols[1]))||firstCols[0].toLowerCase().includes('name'))?1:0;
      let added=0,skipped=0;
      for(const row of lines.slice(startRow)){
        const cols=parseCSVRow(row);
        const name=cols[0]?.replace(/^"|"$/g,'').replace(/""/g,'"').trim();
        if(!name) continue;
        if(items.some(i=>i.name.toLowerCase()===name.toLowerCase())){skipped++;continue;}
        let stock,unit,min,price=0,category='';
        if(cols.length>=4&&['Nos','Kgs','Box'].includes(cols[3]?.trim())){
          const catName=cols[1]?.replace(/^"|"$/g,'').trim()||'';
          const matchCat=categories.find(c=>c.name.toLowerCase()===catName.toLowerCase());
          category=matchCat?matchCat.id:'';
          stock=parseFloat(cols[2])||0;unit=cols[3].trim();min=parseFloat(cols[4])||0;price=parseFloat(cols[5])||0;
        } else if(cols.length>=3&&['Nos','Kgs','Box'].includes(cols[2]?.trim())){
          stock=parseFloat(cols[1])||0;unit=cols[2].trim();min=parseFloat(cols[3])||0;price=parseFloat(cols[4])||0;
        } else {
          stock=parseFloat(cols[1])||0;unit='Nos';min=parseFloat(cols[2])||0;
        }
        const item={id:genId(),name,stock,unit,min,price,category,updatedAt:Date.now()};
        await createItem(item);added++;
      }
      logActivity('↑',`Imported ${added} items (${skipped} skipped)`);
      showToast(added>0?`Imported ${added} items${skipped?`, ${skipped} skipped`:''}`:`0 imported — check format`);
    }catch(err){console.error(err);showToast('Import failed — check file format');}
  };
  reader.onerror=()=>showToast('Could not read file');
  reader.readAsText(file,'UTF-8');
}

function parseCSVRow(row){
  const cols=[];let cur='',inQ=false;
  for(let i=0;i<row.length;i++){
    if(row[i]==='"'){if(inQ&&row[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
    else if(row[i]===','&&!inQ){cols.push(cur);cur='';}
    else cur+=row[i];
  }
  cols.push(cur);return cols;
}

// ─── UI ───────────────────────────────────
function handleSearch(val){searchQuery=val;qs('#clearSearch').classList.toggle('visible',val.length>0);renderInventory();}

function switchTab(name){
  qsAll('.tab').forEach(t=>{const a=t.dataset.tab===name;t.classList.toggle('active',a);t.setAttribute('aria-selected',a);});
  qsAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===`tab-${name}`));
}

async function toggleTheme(){
  const isLight=document.documentElement.getAttribute('data-theme')==='light';
  if(isLight){document.documentElement.removeAttribute('data-theme');await idbMetaSet('theme','dark');}
  else{document.documentElement.setAttribute('data-theme','light');await idbMetaSet('theme','light');}
}

function registerSW(){if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});}

let toastTimer;
function showToast(msg){
  const t=qs('#toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2400);
}

// ─── EVENTS ───────────────────────────────
function setupEvents() {
  qsAll('.tab').forEach(tab=>tab.addEventListener('click',()=>switchTab(tab.dataset.tab)));

  qs('#addItemBtn').addEventListener('click',addItem);
  qs('#newName').addEventListener('keydown',e=>{if(e.key==='Enter')qs('#newStock').focus();});
  qs('#newStock').addEventListener('keydown',e=>{if(e.key==='Enter')qs('#newMin').focus();});

  // Unit buttons
  qsAll('.unit-btn-form').forEach(btn=>btn.addEventListener('click',()=>{
    btn.closest('.unit-selector-form').querySelectorAll('.unit-btn-form').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const h=btn.closest('.field-group').querySelector('input[type=hidden]');
    if(h) h.value=btn.dataset.unit;
  }));
  qsAll('#editUnitSelector .unit-btn-form').forEach(btn=>btn.addEventListener('click',()=>{
    qsAll('#editUnitSelector .unit-btn-form').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');qs('#editUnit').value=btn.dataset.unit;
  }));
  qsAll('#unitSelector .unit-btn').forEach(btn=>btn.addEventListener('click',()=>{
    activeUnit=btn.dataset.unit;setActiveUnitBtn(activeUnit);updateQtyInputMode(activeUnit);
  }));

  // Search / sort
  qs('#searchInput').addEventListener('input',e=>handleSearch(e.target.value));
  qs('#clearSearch').addEventListener('click',()=>{qs('#searchInput').value='';handleSearch('');qs('#searchInput').focus();});
  qsAll('.sort-btn').forEach(btn=>btn.addEventListener('click',()=>{
    qsAll('.sort-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');currentSort=btn.dataset.sort;renderInventory();
  }));

  // Adjust modal
  qs('#modalClose').addEventListener('click',closeModal);
  qs('#modalOverlay').addEventListener('click',e=>{if(e.target===qs('#modalOverlay'))closeModal();});
  qs('#btnAdd').addEventListener('click',()=>adjustStock(1));
  qs('#btnRemove').addEventListener('click',()=>adjustStock(-1));
  qs('#btnDelete').addEventListener('click',deleteItem);
  qs('#btnEditItem').addEventListener('click',showEditView);
  qs('#btnSaveEdit').addEventListener('click',saveEdit);
  qs('#btnCancelEdit').addEventListener('click',showAdjustView);

  // Restock price toggle
  qs('#toggleRestockPrice').addEventListener('click',()=>{
    const calc=qs('#restockPriceCalc');
    const isOpen=calc.style.display!=='none';
    calc.style.display=isOpen?'none':'block';
    qs('#toggleRestockPrice').classList.toggle('open',!isOpen);
  });

  // Qty steppers
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
    if(e.key==='Escape'){
      if(qs('#catModalOverlay').classList.contains('open')) closeCatModal();
      else if(qs('#modalOverlay').classList.contains('open')) closeModal();
    }
  });

  // Category modal
  qs('#catModalClose').addEventListener('click',closeCatModal);
  qs('#catModalOverlay').addEventListener('click',e=>{if(e.target===qs('#catModalOverlay'))closeCatModal();});
  qs('#btnSaveCat').addEventListener('click',saveCatEdit);
  qs('#btnDeleteCat').addEventListener('click',deleteCat);
  qs('#addCatBtn').addEventListener('click',addCategory);
  qs('#newCatName').addEventListener('keydown',e=>{if(e.key==='Enter')addCategory();});

  // CSV
  qs('#exportBtn').addEventListener('click',exportCSV);
  qs('#importBtn').addEventListener('click',()=>qs('#importFile').click());
  qs('#importFile').addEventListener('change',e=>{if(e.target.files[0])importCSV(e.target.files[0]);e.target.value='';});

  // Theme
  qs('#darkToggle').addEventListener('click',toggleTheme);
}

// ─── BOOT ─────────────────────────────────
init().catch(err=>{console.error('STOCKYARD init failed:',err);alert('Failed to initialize. Please refresh.');});
