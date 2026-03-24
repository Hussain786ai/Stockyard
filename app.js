/* ═══════════════════════════════════════════
   STOCKYARD v6 — Full Featured
   Quick Sale · Cart · Undo · Favorites
   Categories · Suppliers · GST Calc · Daily Mode
═══════════════════════════════════════════ */
'use strict';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, onSnapshot,
         updateDoc, deleteDoc, setDoc, query, orderBy }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey:"PASTE_HERE", authDomain:"PASTE_HERE", projectId:"PASTE_HERE",
  storageBucket:"PASTE_HERE", messagingSenderId:"PASTE_HERE", appId:"PASTE_HERE"
};
const FIREBASE_READY = FIREBASE_CONFIG.apiKey !== "PASTE_HERE";

const DEFAULT_CATEGORIES = [
  "FASTENERS & FIXINGS","CUTTING, DRILLING & ABRASIVES","POWER TOOLS & MACHINES",
  "WELDING & GAS EQUIPMENT","CHEMICALS & SPRAYS","SAFETY & PPE",
  "ADHESIVES, TAPES & SEALING","BRUSHES, CLEANING & MISC","PNEUMATIC TOOLS","MISCELLANEOUS ITEMS"
];

// ─── STATE ────────────────────────────────
let firestoreDB=null, idb=null;
let items=[], categories=[], suppliers=[], activity=[];
let activeItemId=null, activeUnit='Nos';
let currentSort='name', searchQuery='', activeCatFilter='ALL';
let openCatGroups=new Set();
let editingCatId=null, editingSupId=null;
// Cart
let cart={};  // {itemId: qty}
// Undo
let lastAction=null;
// Day
let dayStarted=false, dayStartTime=null;
// Sale search
let saleSearch='';

// ─── IDB ──────────────────────────────────
function openIDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open('stockyard_db',5);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      ['items','meta','categories','suppliers'].forEach(s=>{
        if(!d.objectStoreNames.contains(s)) d.createObjectStore(s,{keyPath:'id'});
      });
    };
    r.onsuccess=e=>{idb=e.target.result;res();};
    r.onerror=()=>rej(r.error);
  });
}
const idbTx=(store,mode,fn)=>new Promise((res,rej)=>{
  const tx=idb.transaction(store,mode),req=fn(tx.objectStore(store));
  req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);
});
const idbAll=(s)=>idbTx(s,'readonly',st=>st.getAll());
const idbPut=(s,o)=>idbTx(s,'readwrite',st=>st.put(o));
const idbDel=(s,id)=>idbTx(s,'readwrite',st=>st.delete(id));
const idbMetaGet=k=>idbTx('meta','readonly',s=>s.get(k)).then(r=>r?r.value:null);
const idbMetaSet=(k,v)=>idbTx('meta','readwrite',s=>s.put({id:k,value:v}));

// ─── INIT ─────────────────────────────────
async function init(){
  await openIDB();
  setSyncDot('syncing');
  if(FIREBASE_READY){
    try{
      const app=initializeApp(FIREBASE_CONFIG);
      firestoreDB=getFirestore(app);
      qs('#setupBanner').classList.remove('visible');
      startFirestoreListener();
    }catch(e){console.error(e);await localInit();}
  }else{
    qs('#setupBanner').classList.add('visible');
    await localInit();
  }
  const theme=await idbMetaGet('theme').catch(()=>null);
  if(theme==='light') document.documentElement.setAttribute('data-theme','light');
  const day=await idbMetaGet('dayState').catch(()=>null);
  if(day){dayStarted=day.started;dayStartTime=day.startTime;}
  setupEvents();
  registerSW();
}

async function localInit(){
  items=await idbAll('items');
  categories=await idbAll('categories');
  suppliers=await idbAll('suppliers');
  for(const i of items){if(!i.unit){i.unit='Nos';await idbPut('items',i);}}
  if(!categories.length) await initDefaultCats();
  const saved=await idbMetaGet('activity').catch(()=>null);
  if(saved) activity=saved;
  render(); setSyncDot('offline');
}

async function initDefaultCats(){
  categories=DEFAULT_CATEGORIES.map((name,i)=>({id:'cat_'+i,name}));
  for(const c of categories) await idbPut('categories',c);
}

// ─── FIRESTORE ────────────────────────────
function startFirestoreListener(){
  onSnapshot(query(collection(firestoreDB,'items'),orderBy('name')),
    s=>{items=s.docs.map(d=>({id:d.id,...d.data()}));render();setSyncDot('synced');},
    e=>{console.error(e);setSyncDot('offline');}
  );
  onSnapshot(query(collection(firestoreDB,'categories'),orderBy('name')),
    s=>{
      if(s.empty&&!categories.length){fsInitDefaultCats();return;}
      if(!s.empty) categories=s.docs.map(d=>({id:d.id,...d.data()}));
      populateSelects();renderCatList();
    }
  );
  onSnapshot(query(collection(firestoreDB,'suppliers'),orderBy('name')),
    s=>{suppliers=s.docs.map(d=>({id:d.id,...d.data()}));populateSelects();renderSupList();}
  );
  onSnapshot(doc(firestoreDB,'meta','activity'),
    s=>{if(s.exists()){activity=s.data().log||[];renderDashboard();}}
  );
}
async function fsInitDefaultCats(){
  categories=DEFAULT_CATEGORIES.map((n,i)=>({id:'cat_'+i,name:n}));
  for(const c of categories) await setDoc(doc(firestoreDB,'categories',c.id),{name:c.name});
}
const fsSet=(col,obj)=>{const{id,...d}=obj;return setDoc(doc(firestoreDB,col,id),d);};
const fsDel=(col,id)=>deleteDoc(doc(firestoreDB,col,id));
const fsUpdate=(col,obj)=>{const{id,...d}=obj;return updateDoc(doc(firestoreDB,col,id),d);};

// ─── SAVE WRAPPERS ────────────────────────
async function saveItem(item){
  if(FIREBASE_READY&&firestoreDB){setSyncDot('syncing');await fsUpdate('items',item);}
  else{await idbPut('items',item);render();}
}
async function createItem(item){
  if(FIREBASE_READY&&firestoreDB){setSyncDot('syncing');await fsSet('items',item);}
  else{await idbPut('items',item);items.push(item);render();}
}
async function removeItem(id){
  if(FIREBASE_READY&&firestoreDB){setSyncDot('syncing');await fsDel('items',id);}
  else{await idbDel('items',id);items=items.filter(i=>i.id!==id);render();}
}
async function saveCat(cat){
  if(FIREBASE_READY&&firestoreDB) await fsSet('categories',cat);
  else{await idbPut('categories',cat);const i=categories.findIndex(c=>c.id===cat.id);if(i>=0)categories[i]=cat;else categories.push(cat);}
  populateSelects();renderCatList();
}
async function removeCat(id){
  if(FIREBASE_READY&&firestoreDB) await fsDel('categories',id);
  else{await idbDel('categories',id);categories=categories.filter(c=>c.id!==id);}
  for(const item of items.filter(i=>i.category===id)){item.category='';await saveItem(item);}
  populateSelects();renderCatList();render();
}
async function saveSup(sup){
  if(FIREBASE_READY&&firestoreDB) await fsSet('suppliers',sup);
  else{await idbPut('suppliers',sup);const i=suppliers.findIndex(s=>s.id===sup.id);if(i>=0)suppliers[i]=sup;else suppliers.push(sup);}
  populateSelects();renderSupList();
}
async function removeSup(id){
  if(FIREBASE_READY&&firestoreDB) await fsDel('suppliers',id);
  else{await idbDel('suppliers',id);suppliers=suppliers.filter(s=>s.id!==id);}
  for(const item of items.filter(i=>i.supplier===id)){item.supplier='';await saveItem(item);}
  populateSelects();renderSupList();render();
}
async function saveActivity(){
  if(FIREBASE_READY&&firestoreDB) await setDoc(doc(firestoreDB,'meta','activity'),{log:activity});
  else await idbMetaSet('activity',activity);
}

// ─── HELPERS ──────────────────────────────
const qs=s=>document.querySelector(s);
const qsAll=s=>document.querySelectorAll(s);
const escHtml=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const dateStamp=()=>new Date().toISOString().slice(0,10);
const genId=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
const getCatName=id=>(categories.find(c=>c.id===id)||{}).name||'';
const getSupName=id=>(suppliers.find(s=>s.id===id)||{}).name||'';
const getStatus=item=>item.stock<=0?'out':item.stock<=item.min?'warn':'ok';
function formatStock(stock,unit){
  if(unit==='Kgs') return parseFloat((+stock).toFixed(3)).toString();
  return Math.floor(+stock).toString();
}
function parseQty(val,unit){
  if(unit==='Kgs'){const n=parseFloat(val);return isNaN(n)||n<=0?null:n;}
  const n=parseInt(val,10);return isNaN(n)||n<=0?null:n;
}
function stepValue(unit){return unit==='Kgs'?0.5:1;}
function formatPrice(p){if(!p||p===0)return'—';return'₹'+parseFloat((+p).toFixed(2)).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function totalValue(item){if(!item.price||item.price===0)return 0;return item.stock*item.price;}

// ─── PRICE CALCULATOR ─────────────────────
function calcFinalPrice(base,discPct,gstPct){
  const b=parseFloat(base)||0;
  const d=parseFloat(discPct)||0;
  const g=parseFloat(gstPct)||0;
  const afterDisc=b*(1-d/100);
  const gstAmt=afterDisc*(g/100);
  const final=afterDisc+gstAmt;
  return{base:b,discAmt:b*d/100,afterDisc,gstAmt,final};
}

function updatePriceCalc(prefix){
  const base=parseFloat(qs(`#${prefix}BasePrice`).value)||0;
  const disc=parseFloat(qs(`#${prefix}Discount`).value)||0;
  const gst=parseFloat(qs(`#${prefix}Gst`).value)||0;
  const r=calcFinalPrice(base,disc,gst);
  const fmt=v=>'₹'+v.toFixed(2);
  if(prefix==='new'){
    qs('#calcBase').textContent=fmt(r.base);
    qs('#calcDiscount').textContent='-'+fmt(r.discAmt);
    qs('#calcAfterDisc').textContent=fmt(r.afterDisc);
    qs('#calcGst').textContent='+'+fmt(r.gstAmt);
    qs('#calcFinal').textContent=fmt(r.final);
    qs('#newPrice').value=r.final.toFixed(4);
  }else{
    qs('#eCalcBase').textContent=fmt(r.base);
    qs('#eCalcDiscount').textContent='-'+fmt(r.discAmt);
    qs('#eCalcAfterDisc').textContent=fmt(r.afterDisc);
    qs('#eCalcGst').textContent='+'+fmt(r.gstAmt);
    qs('#eCalcFinal').textContent=fmt(r.final);
    qs('#editPrice').value=r.final.toFixed(4);
  }
}

// ─── POPULATE SELECTS ─────────────────────
function populateSelects(){
  const catOpts='<option value="">— No category —</option>'+
    [...categories].sort((a,b)=>a.name.localeCompare(b.name))
      .map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  const supOpts='<option value="">— No supplier —</option>'+
    [...suppliers].sort((a,b)=>a.name.localeCompare(b.name))
      .map(s=>`<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
  ['#newCategory','#editCategory'].forEach(id=>{ const el=qs(id); if(el) el.innerHTML=catOpts; });
  ['#newSupplier','#editSupplier'].forEach(id=>{ const el=qs(id); if(el) el.innerHTML=supOpts; });
}

// ─── RENDER ───────────────────────────────
function render(){
  renderDashboard();
  renderInventory();
  renderSaleTab();
  renderAlerts();
  updateAlertBadge();
  populateSelects();
  renderCatList();
  renderSupList();
  renderCatTabs();
}

function getSorted(list){
  const l=[...list];
  if(currentSort==='name') l.sort((a,b)=>a.name.localeCompare(b.name));
  else if(currentSort==='stock-asc') l.sort((a,b)=>a.stock-b.stock);
  else if(currentSort==='stock-desc') l.sort((a,b)=>b.stock-a.stock);
  return l;
}

function getFiltered(){
  return items.filter(i=>i.name.toLowerCase().includes(searchQuery.toLowerCase()));
}

// DASHBOARD
function renderDashboard(){
  const total=items.length,low=items.filter(i=>i.stock>0&&i.stock<=i.min).length,
        out=items.filter(i=>i.stock<=0).length,ok=total-low-out;
  qs('#statTotal').textContent=total;qs('#statOk').textContent=ok;
  qs('#statLow').textContent=low;qs('#statOut').textContent=out;
  const totalVal=items.reduce((s,i)=>s+totalValue(i),0);
  qs('#statValue').textContent=totalVal>0?'₹'+totalVal.toLocaleString('en-IN',{maximumFractionDigits:0}):'—';

  // Category value breakdown
  const catValEl=qs('#catValueList');
  const catVals=categories.map(c=>{
    const v=items.filter(i=>i.category===c.id).reduce((s,i)=>s+totalValue(i),0);
    return{name:c.name,value:v};
  }).filter(c=>c.value>0).sort((a,b)=>b.value-a.value);
  const maxVal=catVals[0]?.value||1;
  catValEl.innerHTML=catVals.length?catVals.map(c=>`
    <div class="cat-value-row">
      <span class="cat-value-name">${escHtml(c.name)}</span>
      <div class="cat-value-bar-wrap"><div class="cat-value-bar" style="width:${(c.value/maxVal*100).toFixed(1)}%"></div></div>
      <span class="cat-value-amt">₹${c.value.toLocaleString('en-IN',{maximumFractionDigits:0})}</span>
    </div>`).join(''):'<div class="empty-state">Add buying prices to see value breakdown.</div>';

  const log=qs('#activityLog');
  if(!activity.length){log.innerHTML='<li class="empty-state">No activity yet.</li>';return;}
  log.innerHTML=activity.slice().reverse().slice(0,25).map(a=>`
    <li><span class="act-icon">${a.icon}</span><span class="act-text">${escHtml(a.text)}</span><span class="act-time">${a.time}</span></li>`).join('');
}

// CATEGORY FILTER TABS
function renderCatTabs(){
  const el=qs('#catTabs');
  const sorted=[...categories].sort((a,b)=>a.name.localeCompare(b.name));
  el.innerHTML=`<button class="cat-tab ${activeCatFilter==='ALL'?'active':''}" data-cat="ALL">ALL</button>`+
    sorted.map(c=>`<button class="cat-tab ${activeCatFilter===c.id?'active':''}" data-cat="${c.id}">${escHtml(c.name)}</button>`).join('');
  el.querySelectorAll('.cat-tab').forEach(btn=>btn.addEventListener('click',()=>{
    activeCatFilter=btn.dataset.cat;
    renderCatTabs();renderInventory();
  }));
}

// INVENTORY
function renderInventory(){
  const container=qs('#inventoryList');
  let filtered=getFiltered();
  if(activeCatFilter!=='ALL') filtered=filtered.filter(i=>i.category===activeCatFilter);
  const sorted=getSorted(filtered);

  if(!sorted.length){
    container.innerHTML='<ul class="item-list"><li class="empty-state">'+
      (items.length===0?'No items yet. Tap MORE to add.':searchQuery?'No items match your search.':'No items in this category.')+
      '</li></ul>';return;
  }

  // Flat list when searching or filtering by category
  if(searchQuery||activeCatFilter!=='ALL'){
    container.innerHTML=`<ul class="item-list">${sorted.map(i=>itemRowHTML(i,false)).join('')}</ul>`;
    attachItemEvents(container);return;
  }

  // Grouped by category
  const grouped={};
  const NONE='__none__';
  for(const item of sorted){const k=item.category||NONE;if(!grouped[k])grouped[k]=[];grouped[k].push(item);}
  const sortedCats=[...categories].sort((a,b)=>a.name.localeCompare(b.name));
  let html='';
  for(const cat of sortedCats){
    const ci=grouped[cat.id];if(!ci?.length) continue;
    const isOpen=openCatGroups.has(cat.id);
    const lowC=ci.filter(i=>getStatus(i)!=='ok').length;
    html+=`<div class="cat-group">
      <div class="cat-group-header ${isOpen?'open':''}" data-catid="${cat.id}">
        <span class="cat-group-title">${escHtml(cat.name)}</span>
        <span class="cat-group-meta">${ci.length}${lowC?` · <span style="color:var(--warn)">${lowC}⚠</span>`:''}</span>
        <span class="cat-group-chevron">›</span>
      </div>
      <ul class="cat-group-items ${isOpen?'open':''}">${ci.map(i=>itemRowHTML(i,false)).join('')}</ul>
    </div>`;
  }
  if(grouped[NONE]?.length){
    const ci=grouped[NONE];const isOpen=openCatGroups.has(NONE);
    html+=`<div class="cat-group">
      <div class="cat-group-header ${isOpen?'open':''}" data-catid="${NONE}">
        <span class="cat-group-title">UNCATEGORIZED</span>
        <span class="cat-group-meta">${ci.length}</span>
        <span class="cat-group-chevron">›</span>
      </div>
      <ul class="cat-group-items ${isOpen?'open':''}">${ci.map(i=>itemRowHTML(i,false)).join('')}</ul>
    </div>`;
  }
  container.innerHTML=html||'<ul class="item-list"><li class="empty-state">No items yet.</li></ul>';
  container.querySelectorAll('.cat-group-header').forEach(h=>{
    h.addEventListener('click',()=>{
      const id=h.dataset.catid;
      if(openCatGroups.has(id)) openCatGroups.delete(id); else openCatGroups.add(id);
      renderInventory();
    });
  });
  attachItemEvents(container);
}

function itemRowHTML(item,showCat=true){
  const status=getStatus(item),unit=item.unit||'Nos';
  const cat=showCat&&item.category?getCatName(item.category):'';
  const isFav=item.favorite?'★':'☆';
  return `<li class="item-row status-${status}" data-id="${item.id}" role="button" tabindex="0">
    <div style="flex:1;min-width:0;">
      <div class="item-name">${escHtml(item.name)}</div>
      ${cat?`<div class="item-cat-tag">${escHtml(cat)}</div>`:''}
    </div>
    <div style="display:flex;align-items:center;gap:7px;">
      <span class="item-stock">${formatStock(item.stock,unit)}</span>
      <span class="item-unit">${unit}</span>
    </div>
    <span class="fav-star" style="color:${item.favorite?'var(--amber)':'var(--text3)'}">${isFav}</span>
    <span class="item-chevron">›</span>
  </li>`;
}

function attachItemEvents(container){
  container.querySelectorAll('.item-row').forEach(row=>{
    row.addEventListener('click',()=>openModal(row.dataset.id));
    row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')openModal(row.dataset.id);});
  });
}

// SALE TAB
function renderSaleTab(){
  renderFavGrid();
  renderSaleList();
  renderCartBar();
  renderDayBar();
}

function renderDayBar(){
  const label=qs('#dayLabel'),sub=qs('#daySub'),btn=qs('#dayBtn');
  if(dayStarted){
    const elapsed=dayStartTime?Math.floor((Date.now()-dayStartTime)/60000):0;
    const h=Math.floor(elapsed/60),m=elapsed%60;
    label.textContent='DAY IN PROGRESS';
    sub.textContent=`Started ${new Date(dayStartTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · ${h}h ${m}m`;
    btn.textContent='END DAY';btn.className='day-btn end';
  }else{
    label.textContent='DAY NOT STARTED';sub.textContent='Tap to begin tracking';
    btn.textContent='START DAY';btn.className='day-btn';
  }
}

function renderFavGrid(){
  const favItems=items.filter(i=>i.favorite);
  const el=qs('#favGrid');
  if(!favItems.length){el.innerHTML='<div class="empty-state">Pin items as favorites — tap ★ in any item.</div>';return;}
  el.innerHTML=favItems.map(item=>{
    const qty=cart[item.id]||0;
    const unit=item.unit||'Nos';
    return `<div class="fav-card ${qty?'in-cart':''}" data-id="${item.id}">
      <div>
        <div class="fav-name">${escHtml(item.name)}</div>
        <div class="fav-stock">${formatStock(item.stock,unit)} ${unit}</div>
      </div>
      ${qty?`<span class="fav-cart-badge">×${qty}</span>`:'<span style="color:var(--text3);font-size:18px;">+</span>'}
    </div>`;
  }).join('');
  el.querySelectorAll('.fav-card').forEach(card=>{
    card.addEventListener('click',()=>addToCart(card.dataset.id));
  });
}

function renderSaleList(){
  const el=qs('#saleList');
  let list=items.filter(i=>i.name.toLowerCase().includes(saleSearch.toLowerCase()));
  list=getSorted(list);
  if(!list.length){el.innerHTML='<li class="empty-state">No items found.</li>';return;}
  el.innerHTML=list.map(item=>{
    const status=getStatus(item),unit=item.unit||'Nos',qty=cart[item.id]||0;
    return `<li class="sale-row status-${status} ${qty?'in-cart':''}" data-id="${item.id}">
      <div style="flex:1;min-width:0;">
        <div class="sale-item-name">${escHtml(item.name)}</div>
      </div>
      <span class="sale-item-stock">${formatStock(item.stock,unit)}</span>
      <span class="sale-item-unit">${unit}</span>
      <div class="sale-controls">
        ${qty?`<button class="sale-btn minus" data-id="${item.id}">−</button>
               <span class="sale-qty-badge">×${qty}</span>`:''}
        <button class="sale-btn plus" data-id="${item.id}">+</button>
      </div>
    </li>`;
  }).join('');
  el.querySelectorAll('.sale-btn.plus').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();addToCart(btn.dataset.id);}));
  el.querySelectorAll('.sale-btn.minus').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();removeFromCart(btn.dataset.id);}));
}

function renderCartBar(){
  const cartEl=qs('#cartBar');
  const count=Object.values(cart).reduce((s,q)=>s+q,0);
  if(count===0){cartEl.style.display='none';return;}
  cartEl.style.display='flex';
  qs('#cartCount').textContent=Object.keys(cart).length+' types, '+count+' units';
}

// CART
function addToCart(id){
  const item=items.find(i=>i.id===id);
  if(!item) return;
  const unit=item.unit||'Nos';
  const step=stepValue(unit);
  cart[id]=(cart[id]||0)+step;
  flashEl(getItemEl(id),'green');
  renderSaleTab();
  showToast(`${item.name} → ×${formatStock(cart[id],unit)}`);
}

function removeFromCart(id){
  if(!cart[id]) return;
  const item=items.find(i=>i.id===id);
  const unit=item?item.unit||'Nos':'Nos';
  const step=stepValue(unit);
  cart[id]-=step;
  if(cart[id]<=0) delete cart[id];
  flashEl(getItemEl(id),'red');
  renderSaleTab();
}

function getItemEl(id){
  return qs(`.sale-row[data-id="${id}"]`)||qs(`.fav-card[data-id="${id}"]`);
}

function flashEl(el,color){
  if(!el) return;
  el.classList.remove('flash-green','flash-red');
  void el.offsetWidth;
  el.classList.add(color==='green'?'flash-green':'flash-red');
  setTimeout(()=>el.classList.remove('flash-green','flash-red'),500);
}

async function confirmCart(){
  const entries=Object.entries(cart);
  if(!entries.length) return;
  // Build review list
  const reviewEl=qs('#cartReviewList');
  reviewEl.innerHTML=entries.map(([id,qty])=>{
    const item=items.find(i=>i.id===id);if(!item) return '';
    const unit=item.unit||'Nos';
    return `<li class="cart-review-item">
      <span class="cart-review-name">${escHtml(item.name)}</span>
      <span class="cart-review-qty">−${formatStock(qty,unit)} ${unit}</span>
    </li>`;
  }).join('');
  qs('#cartModalOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}

async function executeCart(){
  const snapshot=[...Object.entries(cart)];
  const prevStocks={};
  for(const [id,qty] of snapshot){
    const item=items.find(i=>i.id===id);if(!item) continue;
    prevStocks[id]=item.stock;
    const newStock=Math.max(0,item.stock-qty);
    item.stock=newStock;item.updatedAt=Date.now();
    await saveItem(item);
    const unit=item.unit||'Nos';
    logActivity('⚡',`Sold ${formatStock(qty,unit)} ${unit} × ${item.name} → ${formatStock(newStock,unit)}`);
  }
  // Store undo info
  lastAction={type:'cart',snapshot,prevStocks};
  updateUndoBar(`Cart sale: ${snapshot.length} items`);
  cart={};
  closeCartModal();
  render();
  showToast(`✓ Sale confirmed — ${snapshot.length} items updated`);
}

// UNDO
function updateUndoBar(text){
  qs('#undoText').textContent='Last: '+text;
  qs('#undoBar').classList.add('visible');
}

async function undoLastAction(){
  if(!lastAction) return;
  if(lastAction.type==='cart'){
    for(const [id,qty] of lastAction.snapshot){
      const item=items.find(i=>i.id===id);if(!item) continue;
      item.stock=lastAction.prevStocks[id];item.updatedAt=Date.now();
      await saveItem(item);
    }
    logActivity('↩',`Undid cart sale (${lastAction.snapshot.length} items)`);
    showToast('↩ Sale undone');
  }else if(lastAction.type==='single'){
    const item=items.find(i=>i.id===lastAction.id);
    if(item){item.stock=lastAction.prevStock;item.updatedAt=Date.now();await saveItem(item);}
    logActivity('↩',`Undid: ${lastAction.text}`);
    showToast('↩ Action undone');
  }
  lastAction=null;
  qs('#undoBar').classList.remove('visible');
  render();
}

// ALERTS
function renderAlerts(){
  const alertItems=items.filter(i=>i.stock<=i.min);
  const list=qs('#alertList');
  if(!alertItems.length){list.innerHTML='<li class="empty-state">All stock levels OK ✓</li>';return;}
  alertItems.sort((a,b)=>a.stock-b.stock);
  list.innerHTML=alertItems.map(item=>{
    const status=getStatus(item),unit=item.unit||'Nos';
    const sup=item.supplier?suppliers.find(s=>s.id===item.supplier):null;
    return `<li class="item-row status-${status}" data-id="${item.id}" role="button" tabindex="0">
      <div style="flex:1;min-width:0;">
        <div class="item-name">${escHtml(item.name)}</div>
        ${item.category?`<div class="item-cat-tag">${escHtml(getCatName(item.category))}</div>`:''}
        ${sup?`<div style="font-size:10px;color:var(--blue);margin-top:2px;">📞 ${escHtml(sup.name)}${sup.phone?' · '+sup.phone:''}</div>`:''}
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

function sendReorderWhatsapp(){
  const alertItems=items.filter(i=>i.stock<=i.min);
  if(!alertItems.length){showToast('No low stock items');return;}
  const lines=['*REORDER LIST — STOCKYARD*','Date: '+new Date().toLocaleDateString('en-IN'),''];
  alertItems.sort((a,b)=>a.stock-b.stock).forEach(i=>{
    const unit=i.unit||'Nos';
    const sup=i.supplier?getSupName(i.supplier):'';
    lines.push(`• ${i.name} — Stock: ${formatStock(i.stock,unit)} ${unit} (min: ${formatStock(i.min,unit)})${sup?' ['+sup+']':''}`);
  });
  const text=encodeURIComponent(lines.join('\n'));
  window.open('https://wa.me/?text='+text,'_blank');
}

function updateAlertBadge(){
  const count=items.filter(i=>i.stock<=i.min).length;
  [qs('#alertBadge'),qs('#navAlertBadge')].forEach(el=>{
    if(el){el.textContent=count;el.classList.toggle('visible',count>0);}
  });
}

// ITEM MODAL
function openModal(id){
  const item=items.find(i=>i.id===id);if(!item) return;
  activeItemId=id;activeUnit=item.unit||'Nos';
  showAdjustView();
  setActiveUnitBtn(activeUnit);updateQtyInputMode(activeUnit);
  qs('#modalTitle').textContent=item.name;
  qs('#modalCatTag').textContent=item.category?getCatName(item.category):'';
  const sup=item.supplier?suppliers.find(s=>s.id===item.supplier):null;
  const supEl=qs('#modalSupTag');
  if(sup){supEl.textContent='📞 '+sup.name+(sup.phone?' · '+sup.phone:'');supEl.style.display='inline-block';}
  else supEl.style.display='none';
  qs('#modalMinStock').textContent=formatStock(item.min,activeUnit);
  qs('#modalPrice').textContent=formatPrice(item.price||0);
  qs('#modalItemValue').textContent=item.price&&item.stock
    ?'₹'+(item.stock*item.price).toLocaleString('en-IN',{maximumFractionDigits:0}):'—';
  updateModalStock(item.stock);
  qs('#priceInput').value=item.price&&item.price>0?item.price:'';
  showPriceInput(false);
  qs('#modalFavBtn').textContent=item.favorite?'★':'☆';
  qs('#modalFavBtn').style.color=item.favorite?'var(--amber)':'var(--text2)';
  qs('#modalOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}

function closeModal(){qs('#modalOverlay').classList.remove('open');document.body.style.overflow='';activeItemId=null;}
function closeCartModal(){qs('#cartModalOverlay').classList.remove('open');document.body.style.overflow='';}

function showAdjustView(){qs('#adjustView').style.display='block';qs('#editView').style.display='none';qs('#modalTag').textContent='ADJUST STOCK';}

function showEditView(){
  const item=items.find(i=>i.id===activeItemId);if(!item) return;
  qs('#adjustView').style.display='none';qs('#editView').style.display='block';qs('#modalTag').textContent='EDIT ITEM';
  qs('#editName').value=item.name;
  qs('#editMin').value=formatStock(item.min,item.unit||'Nos');
  qs('#editUnit').value=item.unit||'Nos';
  qs('#editCategory').value=item.category||'';
  qs('#editSupplier').value=item.supplier||'';
  // Set unit btns
  qsAll('#editUnitBtns .unit-btn-form').forEach(b=>b.classList.toggle('active',b.dataset.unit===(item.unit||'Nos')));
  // Set price calculator
  qs('#editBasePrice').value=item.price&&item.price>0?item.price:'';
  qs('#editDiscount').value=0;qs('#editGst').value=0;
  qsAll('#editGstBtns .gst-btn').forEach(b=>b.classList.toggle('active',b.dataset.val==='0'));
  updatePriceCalc('edit');
}

function showPriceInput(show){qs('#priceRow').style.display=show?'flex':'none';}
function setActiveUnitBtn(unit){qsAll('#unitSelector .unit-btn').forEach(b=>b.classList.toggle('active',b.dataset.unit===unit));}
function updateQtyInputMode(unit){const i=qs('#qtyInput');i.step=unit==='Kgs'?'0.5':'1';i.value=unit==='Kgs'?'0.5':'1';}
function updateModalStock(val){
  const item=items.find(i=>i.id===activeItemId);
  const unit=item?(item.unit||'Nos'):'Nos',status=item?getStatus(item):'ok';
  qs('#modalCurrentStock').textContent=formatStock(val,unit);
  qs('#modalCurrentStock').style.color=status==='out'?'var(--red)':status==='warn'?'var(--warn)':'var(--amber)';
}

async function toggleFavorite(){
  const item=items.find(i=>i.id===activeItemId);if(!item) return;
  item.favorite=!item.favorite;item.updatedAt=Date.now();
  await saveItem(item);
  qs('#modalFavBtn').textContent=item.favorite?'★':'☆';
  qs('#modalFavBtn').style.color=item.favorite?'var(--amber)':'var(--text2)';
  showToast(item.favorite?`★ ${item.name} added to favorites`:`☆ Removed from favorites`);
  renderSaleTab();
}

// SAVE EDIT
async function saveEdit(){
  const item=items.find(i=>i.id===activeItemId);if(!item) return;
  const name=qs('#editName').value.trim();
  const unit=qs('#editUnit').value||'Nos';
  const min=unit==='Kgs'?parseFloat(qs('#editMin').value)||0:parseInt(qs('#editMin').value,10)||0;
  const price=parseFloat(qs('#editPrice').value)||0;
  const cat=qs('#editCategory').value||'';
  const sup=qs('#editSupplier').value||'';
  if(!name){showToast('Name cannot be empty');return;}
  if(items.some(i=>i.id!==activeItemId&&i.name.toLowerCase()===name.toLowerCase())){showToast('Name already exists');return;}
  item.name=name;item.unit=unit;item.min=min;item.price=price;
  item.category=cat;item.supplier=sup;item.updatedAt=Date.now();
  await saveItem(item);
  logActivity('✎',`Edited ${name}`);
  qs('#modalTitle').textContent=item.name;
  qs('#modalCatTag').textContent=cat?getCatName(cat):'';
  qs('#modalPrice').textContent=formatPrice(price);
  showAdjustView();updateModalStock(item.stock);
  showToast(`Saved: ${name}`);
}

// ADJUST STOCK
async function adjustStock(delta){
  const item=items.find(i=>i.id===activeItemId);if(!item) return;
  const qty=parseQty(qs('#qtyInput').value,activeUnit);
  if(qty===null){showToast('Enter a valid quantity');return;}
  if(delta>0){const p=parseFloat(qs('#priceInput').value);if(!isNaN(p)&&p>0) item.price=p;}
  const prevStock=item.stock;
  const newStock=Math.max(0,item.stock+delta*qty);
  item.stock=newStock;item.updatedAt=Date.now();
  await saveItem(item);
  const label=delta>0?'Added':'Removed',unit=item.unit||'Nos';
  const priceNote=delta>0&&item.price?` @ ${formatPrice(item.price)}`:'';
  const text=`${label} ${formatStock(qty,activeUnit)} ${activeUnit} × ${item.name}${priceNote} → ${formatStock(newStock,unit)} ${unit}`;
  logActivity(delta>0?'＋':'−',text);
  // Undo
  lastAction={type:'single',id:item.id,prevStock,text};
  updateUndoBar(text);
  updateModalStock(newStock);
  qs('#modalPrice').textContent=formatPrice(item.price||0);
  qs('#modalItemValue').textContent=item.price&&newStock?'₹'+(newStock*item.price).toLocaleString('en-IN',{maximumFractionDigits:0}):'—';
  showPriceInput(false);
  // Flash
  const rowEl=qs(`.item-row[data-id="${item.id}"]`);
  if(rowEl) flashEl(rowEl,delta>0?'green':'red');
  showToast(`${label} ${formatStock(qty,activeUnit)} ${activeUnit} — Stock: ${formatStock(newStock,unit)} ${unit}`);
}

async function deleteItem(){
  const item=items.find(i=>i.id===activeItemId);
  if(!item||!confirm(`Delete "${item.name}"?`)) return;
  await removeItem(activeItemId);
  logActivity('🗑',`Deleted ${item.name}`);
  closeModal();showToast(`Deleted: ${item.name}`);
}

// ADD ITEM
async function addItem(){
  const nameEl=qs('#newName'),stockEl=qs('#newStock'),minEl=qs('#newMin');
  const unitVal=qs('#newUnit').value||'Nos';
  const price=parseFloat(qs('#newPrice').value)||0;
  const catVal=qs('#newCategory').value||'';
  const supVal=qs('#newSupplier').value||'';
  const name=nameEl.value.trim();
  const stock=unitVal==='Kgs'?(parseFloat(stockEl.value)||0):(parseInt(stockEl.value,10)||0);
  const min=unitVal==='Kgs'?(parseFloat(minEl.value)||0):(parseInt(minEl.value,10)||0);
  if(!name){showToast('Enter an item name');nameEl.focus();return;}
  if(items.some(i=>i.name.toLowerCase()===name.toLowerCase())){showToast('Item already exists');nameEl.focus();return;}
  const item={id:genId(),name,stock,min,unit:unitVal,price,category:catVal,supplier:supVal,favorite:false,updatedAt:Date.now()};
  await createItem(item);
  logActivity('⊕',`Added ${name} (${formatStock(stock,unitVal)} ${unitVal}${price?` @ ${formatPrice(price)}`:''})`);
  [nameEl,stockEl,minEl,qs('#newPrice'),qs('#newBasePrice'),qs('#newDiscount')].forEach(el=>{if(el)el.value='';});
  qs('#newUnit').value='Nos';qs('#newCategory').value='';qs('#newSupplier').value='';
  qs('#newGst').value='0';
  qsAll('#newUnitBtns .unit-btn-form').forEach(b=>b.classList.toggle('active',b.dataset.unit==='Nos'));
  qsAll('.gst-btn').forEach(b=>b.classList.toggle('active',b.dataset.val==='0'));
  updatePriceCalc('new');
  nameEl.focus();showToast(`Added: ${name}`);switchTab('stock');
}

// CAT MODAL
let editingCatId2=null;
function openCatModal(catId){
  editingCatId2=catId;
  const cat=categories.find(c=>c.id===catId);if(!cat) return;
  qs('#editCatName').value=cat.name;
  qs('#catModalOverlay').classList.add('open');document.body.style.overflow='hidden';
}
function closeCatModal(){qs('#catModalOverlay').classList.remove('open');document.body.style.overflow='';}
async function saveCatEdit(){
  const name=qs('#editCatName').value.trim();if(!name){showToast('Enter name');return;}
  const cat=categories.find(c=>c.id===editingCatId2);if(!cat) return;
  cat.name=name;await saveCat(cat);closeCatModal();showToast(`Updated: ${name}`);
}
async function deleteCat2(){
  const cat=categories.find(c=>c.id===editingCatId2);
  if(!cat||!confirm(`Delete "${cat.name}"? Items will become uncategorized.`)) return;
  await removeCat(editingCatId2);closeCatModal();showToast(`Deleted: ${cat.name}`);
}
async function addCategory(){
  const el=qs('#newCatName');const name=el.value.trim();
  if(!name){showToast('Enter name');el.focus();return;}
  if(categories.some(c=>c.name.toLowerCase()===name.toLowerCase())){showToast('Already exists');return;}
  const cat={id:'cat_'+genId(),name};await saveCat(cat);el.value='';showToast(`Added: ${name}`);
}

// SUP MODAL
let editingSupId2=null;
function openSupModal(supId){
  editingSupId2=supId;
  const sup=suppliers.find(s=>s.id===supId);if(!sup) return;
  qs('#editSupName').value=sup.name;qs('#editSupPhone').value=sup.phone||'';
  qs('#supModalOverlay').classList.add('open');document.body.style.overflow='hidden';
}
function closeSupModal(){qs('#supModalOverlay').classList.remove('open');document.body.style.overflow='';}
async function saveSupEdit(){
  const name=qs('#editSupName').value.trim();if(!name){showToast('Enter name');return;}
  const sup=suppliers.find(s=>s.id===editingSupId2);if(!sup) return;
  sup.name=name;sup.phone=qs('#editSupPhone').value.trim();
  await saveSup(sup);closeSupModal();showToast(`Updated: ${name}`);
}
async function deleteSup2(){
  const sup=suppliers.find(s=>s.id===editingSupId2);
  if(!sup||!confirm(`Delete supplier "${sup.name}"?`)) return;
  await removeSup(editingSupId2);closeSupModal();showToast(`Deleted: ${sup.name}`);
}
async function addSupplier(){
  const el=qs('#newSupName');const name=el.value.trim();
  if(!name){showToast('Enter supplier name');el.focus();return;}
  if(suppliers.some(s=>s.name.toLowerCase()===name.toLowerCase())){showToast('Already exists');return;}
  const phone=qs('#newSupPhone').value.trim();
  const sup={id:'sup_'+genId(),name,phone};await saveSup(sup);
  el.value='';qs('#newSupPhone').value='';showToast(`Added: ${name}`);
}

// RENDER LISTS
function renderCatList(){
  const el=qs('#catList');if(!el) return;
  if(!categories.length){el.innerHTML='<li class="empty-state">No categories.</li>';return;}
  const sorted=[...categories].sort((a,b)=>a.name.localeCompare(b.name));
  el.innerHTML=sorted.map(cat=>{
    const count=items.filter(i=>i.category===cat.id).length;
    return `<li class="cat-row">
      <span class="cat-row-name">${escHtml(cat.name)}</span>
      <span class="cat-row-count">${count}</span>
      <button class="cat-row-edit" data-catid="${cat.id}">✎</button>
    </li>`;
  }).join('');
  el.querySelectorAll('.cat-row-edit').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();openCatModal(btn.dataset.catid);});
  });
}

function renderSupList(){
  const el=qs('#supList');if(!el) return;
  if(!suppliers.length){el.innerHTML='<li class="empty-state">No suppliers yet.</li>';return;}
  const sorted=[...suppliers].sort((a,b)=>a.name.localeCompare(b.name));
  el.innerHTML=sorted.map(sup=>{
    const count=items.filter(i=>i.supplier===sup.id).length;
    return `<li class="sup-row">
      <div style="flex:1;">
        <div class="sup-row-name">${escHtml(sup.name)}</div>
        ${sup.phone?`<div class="sup-row-phone" onclick="window.open('tel:${sup.phone}')">📞 ${sup.phone}</div>`:''}
      </div>
      <span class="sup-row-count">${count} items</span>
      <button class="sup-row-edit" data-supid="${sup.id}">✎</button>
    </li>`;
  }).join('');
  el.querySelectorAll('.sup-row-edit').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();openSupModal(btn.dataset.supid);});
  });
}

// DAY MODE
async function toggleDay(){
  dayStarted=!dayStarted;
  if(dayStarted) dayStartTime=Date.now();
  else{ logActivity('📋',`Day ended`); dayStartTime=null; }
  await idbMetaSet('dayState',{started:dayStarted,startTime:dayStartTime});
  if(dayStarted) logActivity('📋','Day started');
  renderDayBar();
  showToast(dayStarted?'Day started ✓':'Day ended');
}

// CSV
function exportCSV(){
  if(!items.length){showToast('No items');return;}
  const rows=[['Name','Category','Supplier','Stock','Unit','Min Alert','Buying Price','Stock Value','Status']];
  items.forEach(i=>{
    const u=i.unit||'Nos';
    rows.push([`"${i.name.replace(/"/g,'""')}"`,`"${getCatName(i.category)}"`,`"${getSupName(i.supplier)}"`,
      formatStock(i.stock,u),u,formatStock(i.min,u),i.price||0,
      i.price?(i.stock*i.price).toFixed(2):0,getStatus(i)]);
  });
  const blob=new Blob([rows.map(r=>r.join(',')).join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`stockyard_${dateStamp()}.csv`;a.click();
  URL.revokeObjectURL(url);showToast('Exported ✓');
}

function importCSV(file){
  if(!file) return;showToast('Reading…');
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const text=e.target.result.replace(/^\uFEFF/,'');
      const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      if(lines.length<1){showToast('Empty file');return;}
      const first=parseCSVRow(lines[0]);
      const start=isNaN(parseFloat(first[1]))||first[0].toLowerCase().includes('name')?1:0;
      let added=0,skipped=0;
      for(const row of lines.slice(start)){
        const cols=parseCSVRow(row);
        const name=cols[0]?.replace(/^"|"$/g,'').replace(/""/g,'"').trim();
        if(!name) continue;
        if(items.some(i=>i.name.toLowerCase()===name.toLowerCase())){skipped++;continue;}
        let stock=0,unit='Nos',min=0,price=0,category='';
        // Detect format
        if(cols.length>=5&&['Nos','Kgs','Box'].includes(cols[4]?.trim())){
          // New format: Name,Cat,Sup,Stock,Unit,Min,Price
          category=cols[1]?.replace(/^"|"$/g,'').trim()||'';
          const matchCat=categories.find(c=>c.name.toLowerCase()===category.toLowerCase());
          category=matchCat?matchCat.id:'';
          stock=parseFloat(cols[3])||0;unit=cols[4].trim();min=parseFloat(cols[5])||0;price=parseFloat(cols[6])||0;
        }else if(cols.length>=3&&['Nos','Kgs','Box'].includes(cols[2]?.trim())){
          stock=parseFloat(cols[1])||0;unit=cols[2].trim();min=parseFloat(cols[3])||0;price=parseFloat(cols[4])||0;
        }else{
          stock=parseFloat(cols[1])||0;unit='Nos';min=parseFloat(cols[2])||0;
        }
        const item={id:genId(),name,stock,unit,min,price,category,supplier:'',favorite:false,updatedAt:Date.now()};
        await createItem(item);added++;
      }
      logActivity('↑',`Imported ${added} items (${skipped} skipped)`);
      showToast(added>0?`Imported ${added}${skipped?`, ${skipped} skipped`:''}`:
        `0 imported — check CSV format`);
    }catch(err){console.error(err);showToast('Import failed');}
  };
  reader.onerror=()=>showToast('Could not read file');
  reader.readAsText(file,'UTF-8');
}

function parseCSVRow(row){
  const cols=[];let cur='',inQ=false;
  for(let i=0;i<row.length;i++){
    if(row[i]==='"'){if(inQ&&row[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
    else if(row[i]===','&&!inQ){cols.push(cur);cur='';}else cur+=row[i];
  }
  cols.push(cur);return cols;
}

// ACTIVITY
function logActivity(icon,text){
  const time=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  activity.push({icon,text,time,ts:Date.now()});
  if(activity.length>100) activity.shift();
  saveActivity();renderDashboard();
}

// UI HELPERS
function switchTab(name){
  qsAll('.nav-btn').forEach(b=>{const a=b.dataset.tab===name;b.classList.toggle('active',a);b.setAttribute('aria-selected',a);});
  qsAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===`tab-${name}`));
}

function setSyncDot(state){
  const d=qs('#syncDot');d.className='sync-dot '+state;
  d.title=state==='synced'?'Live synced':state==='syncing'?'Syncing…':'Offline — local only';
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
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2500);
}

// EVENTS
function setupEvents(){
  // Nav
  qsAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));

  // Add item
  qs('#addItemBtn').addEventListener('click',addItem);
  qs('#newName').addEventListener('keydown',e=>{if(e.key==='Enter')qs('#newStock').focus();});
  qs('#newStock').addEventListener('keydown',e=>{if(e.key==='Enter')qs('#newMin').focus();});
  qs('#newMin').addEventListener('keydown',e=>{if(e.key==='Enter')qs('#newBasePrice').focus();});

  // Unit btns — generic handler for all .unit-btn-form groups
  document.addEventListener('click',e=>{
    const btn=e.target.closest('.unit-btn-form');
    if(!btn) return;
    const group=btn.closest('.unit-selector-form');
    group.querySelectorAll('.unit-btn-form').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const hidden=btn.closest('.field-group').querySelector('input[type=hidden]');
    if(hidden) hidden.value=btn.dataset.unit;
  });

  // Modal unit btns
  qsAll('#unitSelector .unit-btn').forEach(btn=>btn.addEventListener('click',()=>{
    activeUnit=btn.dataset.unit;setActiveUnitBtn(activeUnit);updateQtyInputMode(activeUnit);
  }));

  // Price calculator — new item
  ['#newBasePrice','#newDiscount'].forEach(id=>{
    const el=qs(id);if(el) el.addEventListener('input',()=>updatePriceCalc('new'));
  });
  document.querySelectorAll('.pct-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const isEdit=btn.closest('#editView');
      const prefix=isEdit?'edit':'new';
      qs(`#${prefix}Discount`).value=btn.dataset.val;
      updatePriceCalc(prefix);
    });
  });
  document.querySelectorAll('.gst-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const isEdit=btn.closest('#editView');
      const prefix=isEdit?'edit':'new';
      btn.closest('.quick-pct-btns').querySelectorAll('.gst-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      qs(`#${prefix}Gst`).value=btn.dataset.val;
      updatePriceCalc(prefix);
    });
  });
  // Price calculator — edit item
  ['#editBasePrice','#editDiscount'].forEach(id=>{
    const el=qs(id);if(el) el.addEventListener('input',()=>updatePriceCalc('edit'));
  });

  // Search (stock tab)
  qs('#searchInput').addEventListener('input',e=>{
    searchQuery=e.target.value;
    qs('#clearSearch').classList.toggle('visible',searchQuery.length>0);
    renderInventory();
  });
  qs('#clearSearch').addEventListener('click',()=>{
    qs('#searchInput').value='';searchQuery='';
    qs('#clearSearch').classList.remove('visible');renderInventory();
  });

  // Sale search
  qs('#saleSearch').addEventListener('input',e=>{
    saleSearch=e.target.value;
    qs('#saleClearSearch').classList.toggle('visible',saleSearch.length>0);
    renderSaleList();
  });
  qs('#saleClearSearch').addEventListener('click',()=>{
    qs('#saleSearch').value='';saleSearch='';
    qs('#saleClearSearch').classList.remove('visible');renderSaleList();
  });

  // Sort
  qsAll('.sort-btn').forEach(btn=>btn.addEventListener('click',()=>{
    qsAll('.sort-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');currentSort=btn.dataset.sort;renderInventory();
  }));

  // Day mode
  qs('#dayBtn').addEventListener('click',toggleDay);

  // Cart
  qs('#cartConfirmBtn').addEventListener('click',confirmCart);
  qs('#cartClearBtn').addEventListener('click',()=>{cart={};renderSaleTab();});
  qs('#cartModalClose').addEventListener('click',closeCartModal);
  qs('#cartModalOverlay').addEventListener('click',e=>{if(e.target===qs('#cartModalOverlay'))closeCartModal();});
  qs('#cartFinalConfirm').addEventListener('click',executeCart);

  // Undo
  qs('#undoBtn').addEventListener('click',undoLastAction);

  // Item modal
  qs('#modalClose').addEventListener('click',closeModal);
  qs('#modalOverlay').addEventListener('click',e=>{if(e.target===qs('#modalOverlay'))closeModal();});
  qs('#modalFavBtn').addEventListener('click',toggleFavorite);
  qs('#btnAdd').addEventListener('click',async()=>{
    if(qs('#priceRow').style.display==='none'||!qs('#priceRow').style.display){
      showPriceInput(true);qs('#priceInput').focus();
      showToast('Enter buying price, then tap ＋ again');return;
    }
    await adjustStock(1);
  });
  qs('#btnRemove').addEventListener('click',()=>adjustStock(-1));
  qs('#btnDelete').addEventListener('click',deleteItem);
  qs('#btnEditItem').addEventListener('click',showEditView);
  qs('#btnSaveEdit').addEventListener('click',saveEdit);
  qs('#btnCancelEdit').addEventListener('click',showAdjustView);
  qs('#qtyDown').addEventListener('click',()=>{
    const i=qs('#qtyInput'),s=stepValue(activeUnit);
    const v=Math.max(s,parseFloat(i.value)-s);
    i.value=activeUnit==='Kgs'?v.toFixed(1):Math.round(v);
  });
  qs('#qtyUp').addEventListener('click',()=>{
    const i=qs('#qtyInput'),s=stepValue(activeUnit);
    const v=(parseFloat(i.value)||0)+s;
    i.value=activeUnit==='Kgs'?v.toFixed(1):Math.round(v);
  });
  // Supplier phone call
  qs('#modalSupTag').addEventListener('click',()=>{
    const item=items.find(i=>i.id===activeItemId);
    if(!item||!item.supplier) return;
    const sup=suppliers.find(s=>s.id===item.supplier);
    if(sup&&sup.phone) window.open(`tel:${sup.phone}`);
  });

  // Cat modal
  qs('#catModalClose').addEventListener('click',closeCatModal);
  qs('#catModalOverlay').addEventListener('click',e=>{if(e.target===qs('#catModalOverlay'))closeCatModal();});
  qs('#btnSaveCat').addEventListener('click',saveCatEdit);
  qs('#btnDeleteCat').addEventListener('click',deleteCat2);
  qs('#addCatBtn').addEventListener('click',addCategory);
  qs('#newCatName').addEventListener('keydown',e=>{if(e.key==='Enter')addCategory();});

  // Sup modal
  qs('#supModalClose').addEventListener('click',closeSupModal);
  qs('#supModalOverlay').addEventListener('click',e=>{if(e.target===qs('#supModalOverlay'))closeSupModal();});
  qs('#btnSaveSup').addEventListener('click',saveSupEdit);
  qs('#btnDeleteSup').addEventListener('click',deleteSup2);
  qs('#addSupBtn').addEventListener('click',addSupplier);
  qs('#newSupName').addEventListener('keydown',e=>{if(e.key==='Enter')qs('#newSupPhone').focus();});
  qs('#newSupPhone').addEventListener('keydown',e=>{if(e.key==='Enter')addSupplier();});

  // Alerts
  qs('#reorderWhatsapp').addEventListener('click',sendReorderWhatsapp);

  // Escape
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape') return;
    if(qs('#catModalOverlay').classList.contains('open')) closeCatModal();
    else if(qs('#supModalOverlay').classList.contains('open')) closeSupModal();
    else if(qs('#cartModalOverlay').classList.contains('open')) closeCartModal();
    else if(qs('#modalOverlay').classList.contains('open')) closeModal();
  });

  // Export/Import
  qs('#exportBtn').addEventListener('click',exportCSV);
  qs('#importBtn').addEventListener('click',()=>qs('#importFile').click());
  qs('#importFile').addEventListener('change',e=>{if(e.target.files[0])importCSV(e.target.files[0]);e.target.value='';});

  // Theme
  qs('#darkToggle').addEventListener('click',toggleTheme);
}

init().catch(err=>{console.error('STOCKYARD init failed:',err);alert('Failed to initialize. Please refresh.');});
