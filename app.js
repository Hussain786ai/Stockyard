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
  // Precise decimal arithmetic — verified: ₹100 @ 20% disc + 18% GST = ₹94.40
  const b=Math.max(0,parseFloat(base)||0);
  const d=Math.min(100,Math.max(0,parseFloat(discPct)||0));
  const g=Math.max(0,parseFloat(gstPct)||0);
  const discAmt=Math.round(b*d*100)/10000;           // b * d/100, rounded to 4dp
  const afterDisc=Math.round((b-discAmt)*10000)/10000;
  const gstAmt=Math.round(afterDisc*g*100)/10000;    // afterDisc * g/100, rounded to 4dp
  const final=Math.round((afterDisc+gstAmt)*100)/100; // final rounded to 2dp
  return{base:b,discAmt:Math.round(discAmt*100)/100,afterDisc,gstAmt:Math.round(gstAmt*100)/100,final};
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
  const count=Object.values(cart).reduce((s,q)=>s+q,0)/* ═══════════════════════════════════════════
   
