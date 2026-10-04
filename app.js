/* ---------------- Storage ----------------
   Two layers:
   1. SHARED layer — Claude's "db" runtime capability, when this page is
      opened as a published Claude artifact. One JSON document holds the
      whole app state and is kept in sync live across every device/person
      who has the link open (manager, bishops, workers, drivers all see
      the same data in real time).
   2. LOCAL fallback — localStorage, used only when the db capability is
      unavailable (e.g. opened as a plain downloaded file rather than the
      published link), so the app still works standalone for testing.
------------------------------------------------------------------ */
const DB_KEY = 'fleetops_db_v5';
const DB_DOC_PATH = 'data/fleet';
let STORAGE_OK = true;
let MEMORY_STORE = {};
let claudeDb = null;        // set once claude.use('db') resolves, else stays null
let claudeUserCap = null;   // set once claude.use('user') resolves
let canWriteShared = null;  // true/false/null(unknown) — whether this viewer can write shared data
let activeTabId = null;     // tracks which page is on screen, so remote updates can re-render it
function storageGet(key){
  try{ return localStorage.getItem(key); } catch(e){ STORAGE_OK=false; return (key in MEMORY_STORE)?MEMORY_STORE[key]:null; }
}
function storageSet(key,val){
  try{ localStorage.setItem(key,val); } catch(e){ STORAGE_OK=false; MEMORY_STORE[key]=val; }
}
function defaultDB(){
  return {
    admins: [
      {id:'a1', name:'Bishop One', role:'bishop', code:'2000'},
      {id:'a2', name:'Bishop Two', role:'bishop', code:'3000'},
      {id:'a3', name:'Bishop Three', role:'bishop', code:'4000'},
      {id:'a4', name:'Fleet Manager', role:'manager', code:'1000'}
    ],
    workers: [],
    drivers: [],
    vehicles: [],
    slots: [],
    bookings: [],
    faults: [],
    clocklog: [],
    penalties: [],
    calltoorder: [],
    feedback: [],
    eventNames: [],
    seq: 1
  };
}
function fillMissing(db){
  const d = defaultDB();
  Object.keys(d).forEach(k=>{ if(db[k]===undefined) db[k] = Array.isArray(d[k]) ? [] : d[k]; });
  return db;
}
/** Auto-suspends any driver whose license has expired and isn't already
 * suspended. Returns true if it changed anything (so callers know to persist). */
function enforceLicenseSuspensions(db){
  let changed = false;
  (db.drivers||[]).forEach(d=>{
    const days = daysUntil(d.licenseExpiry);
    if(days!==null && days<0 && d.status!=='suspended'){
      d.status='suspended'; d.autoSuspended=true; changed=true;
    }
  });
  return changed;
}
function loadLocalDB(){
  let raw = storageGet(DB_KEY);
  if(!raw){ const db = defaultDB(); storageSet(DB_KEY, JSON.stringify(db)); return db; }
  let db;
  try{ db = fillMissing(JSON.parse(raw)); } catch(e){ db = defaultDB(); storageSet(DB_KEY, JSON.stringify(db)); return db; }
  return db;
}
/** Synchronous read of the current in-memory state. Safe to call anywhere —
 * the live subscription (when db capability is active) keeps `DB` fresh in
 * the background, so this never needs to touch storage itself. */
function loadDB(){ return DB; }
/** Writes DB everywhere: updates the in-memory copy immediately (so the UI
 * that called this feels instant), mirrors to localStorage as a local
 * cache/fallback, and fires a background write to the shared db document
 * when available so every other device sees it too. */
function saveDB(db){
  enforceLicenseSuspensions(db);
  DB = db;
  storageSet(DB_KEY, JSON.stringify(db));
  if(claudeDb){
    claudeDb.doc(DB_DOC_PATH).set(db).catch(err=>{
      console.error('Shared save failed:', err);
      if(err && (err.code==='invalid_argument') && canWriteShared===false){
        showWriteBlockedNotice();
      }
    });
  }
}
function resetSystemData(){
  if(!confirm('This clears ALL Fleet Operations data for everyone using this link (staff, bookings, vehicles) and restores the original Bishop/Manager codes. Continue?')) return;
  try{ localStorage.removeItem(DB_KEY); }catch(e){}
  MEMORY_STORE = {};
  if(claudeDb){
    claudeDb.doc(DB_DOC_PATH).delete().catch(()=>{}).finally(()=>location.reload());
  } else {
    location.reload();
  }
}
function nextId(db){ return 'id' + (db.seq++); }
function genCode(prefix){ return String(Math.floor(1000 + Math.random()*9000)); }
let DB = loadLocalDB();
enforceLicenseSuspensions(DB);
let CURRENT = null;
if(!STORAGE_OK){
  const w = document.createElement('div');
  w.className = 'msg warn';
  w.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:999;max-width:420px;';
  w.textContent = "This browser is blocking saved storage, so data won't be remembered after you close this tab. Everything still works for this session.";
  document.body.appendChild(w);
}
function showWriteBlockedNotice(){
  if(document.getElementById('write-blocked-notice')) return;
  const w = document.createElement('div');
  w.id = 'write-blocked-notice';
  w.className = 'msg err';
  w.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:999;max-width:460px;';
  w.textContent = "You have read-only access to this shared system. Ask whoever owns this link to give you Contributor/Editor access so your changes (bookings, approvals, etc.) can be saved.";
  document.body.appendChild(w);
}
function rerenderCurrentView(){
  if(CURRENT){
    if(activeTabId && render[activeTabId]) render[activeTabId]();
  } else {
    refreshAdminNameOptions();
    refreshDriverNameOptions();
    refreshWorkerNameOptions();
  }
}
/** Connects to the shared db capability when this page is opened as a
 * published Claude artifact. If unavailable (e.g. a plain downloaded
 * file), the app silently keeps working on localStorage alone. */
(async function initSharedDb(){
  try{
    const db = await (window.claude && window.claude.use ? window.claude.use('db') : Promise.resolve(null));
    if(!db) return; // not running as a published artifact with db granted — stay on localStorage
    claudeDb = db;
    try{
      const userCap = await window.claude.use('user');
      claudeUserCap = userCap;
      if(userCap){
        canWriteShared = await userCap.can('data.write');
        if(canWriteShared === false) showWriteBlockedNotice();
      }
    }catch(e){ /* user capability optional */ }
    claudeDb.doc(DB_DOC_PATH).onSnapshot(
      (snap)=>{
        if(snap.exists){
          DB = fillMissing(snap.data());
        } else if(!snap.metadata.hasPendingWrites){
          // shared doc doesn't exist yet — seed it from whatever we have locally
          DB = fillMissing(DB);
          saveDB(DB);
          return;
        }
        enforceLicenseSuspensions(DB);
        storageSet(DB_KEY, JSON.stringify(DB));
        rerenderCurrentView();
      },
      (err)=>{ console.error('Shared data subscription error:', err); }
    );
  }catch(e){
    console.error('Could not connect shared db:', e);
  }
})();
/* ---------------- Login ---------------- */
function allPeople(){ return [...DB.admins, ...DB.workers, ...DB.drivers]; }
const ROLE_LABELS = {bishop:'Bishop', manager:'Manager', worker:'Worker', driver:'Driver'};
function normalizeCode(s){ return (s||'').trim().toUpperCase().replace(/\s+/g,''); }
function refreshAdminNameOptions(){
  DB = loadDB();
  const sel = document.getElementById('admin-name-select');
  if(!sel) return;
  sel.innerHTML = `<option value="">Select your name…</option>` +
    DB.admins.map(a=>`<option value="${a.id}">${a.name} (${a.role==='bishop'?'Bishop':'Manager'})</option>`).join('');
}
function refreshDriverNameOptions(){
  DB = loadDB();
  const sel = document.getElementById('driver-name-select');
  if(!sel) return;
  sel.innerHTML = `<option value="">Select your name…</option>` +
    DB.drivers.map(d=>`<option value="${d.id}">${d.name}</option>`).join('');
}
function refreshWorkerNameOptions(){
  DB = loadDB();
  const sel = document.getElementById('worker-name-select');
  if(!sel) return;
  sel.innerHTML = `<option value="">Select your name…</option>` +
    DB.workers.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
}
function attemptAdminLogin(){
  const sel = document.getElementById('admin-name-select');
  const errEl = document.getElementById('login-error');
  const val = normalizeCode(document.getElementById('pin-admin').value);
  if(!sel.value){ errEl.textContent = 'Select your name first.'; return; }
  DB = loadDB();
  const person = DB.admins.find(a=>a.id===sel.value);
  if(!person){ errEl.textContent = 'That name is no longer on file — refresh and try again.'; return; }
  if(!val){ errEl.textContent = 'Enter your access code.'; return; }
  if(normalizeCode(person.code) !== val){ errEl.textContent = `That code doesn't match ${person.name}.`; return; }
  errEl.textContent = '';
  CURRENT = person;
  enterApp();
}
function attemptDriverLogin(){
  const sel = document.getElementById('driver-name-select');
  const errEl = document.getElementById('login-error');
  const val = normalizeCode(document.getElementById('pin-driver').value);
  if(!sel.value){ errEl.textContent = 'Select your name first.'; return; }
  DB = loadDB();
  const person = DB.drivers.find(d=>d.id===sel.value);
  if(!person){ errEl.textContent = 'That name is no longer on file — refresh and try again.'; return; }
  if(!val){ errEl.textContent = 'Enter your access code.'; return; }
  if(normalizeCode(person.code) !== val){ errEl.textContent = `That code doesn't match ${person.name}.`; return; }
  errEl.textContent = '';
  CURRENT = person;
  enterApp();
}
function attemptWorkerLogin(){
  const sel = document.getElementById('worker-name-select');
  const errEl = document.getElementById('login-error');
  const val = normalizeCode(document.getElementById('pin-worker').value);
  if(!sel.value){ errEl.textContent = 'Select your name first.'; return; }
  DB = loadDB();
  const person = DB.workers.find(w=>w.id===sel.value);
  if(!person){ errEl.textContent = 'That name is no longer on file — refresh and try again.'; return; }
  if(!val){ errEl.textContent = 'Enter your access code.'; return; }
  if(normalizeCode(person.code) !== val){ errEl.textContent = `That code doesn't match ${person.name}.`; return; }
  errEl.textContent = '';
  CURRENT = person;
  enterApp();
}
function applyRoleView(){
  const params = new URLSearchParams(window.location.search);
  const roleParam = (params.get('role')||'').toLowerCase();
  const cols = {driver:document.getElementById('login-col-driver'), worker:document.getElementById('login-col-worker'), admin:document.getElementById('login-col-admin')};
  if(roleParam==='driver'||roleParam==='worker'||roleParam==='admin'){
    Object.keys(cols).forEach(k=>{ if(k!==roleParam) cols[k].style.display='none'; });
    document.getElementById('login-cols').style.gridTemplateColumns='1fr';
    document.getElementById('login-cols-wrap').classList.remove('login-card-wide');
  }
}
refreshAdminNameOptions();
refreshDriverNameOptions();
refreshWorkerNameOptions();
applyRoleView();
document.getElementById('pin-driver').addEventListener('keydown', e=>{ if(e.key==='Enter') attemptDriverLogin(); });
document.getElementById('pin-worker').addEventListener('keydown', e=>{ if(e.key==='Enter') attemptWorkerLogin(); });
document.getElementById('pin-admin').addEventListener('keydown', e=>{ if(e.key==='Enter') attemptAdminLogin(); });
function logout(){
  CURRENT=null;
  activeTabId=null;
  document.getElementById('pin-driver').value='';
  document.getElementById('pin-worker').value='';
  document.getElementById('pin-admin').value='';
  document.getElementById('admin-name-select').value='';
  document.getElementById('driver-name-select').value='';
  document.getElementById('worker-name-select').value='';
  refreshAdminNameOptions();
  refreshDriverNameOptions();
  refreshWorkerNameOptions();
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').style.display='flex';
}
function roleOf(p){
  if(p.role==='bishop'||p.role==='manager') return p.role;
  if(DB.workers.find(w=>w.id===p.id)) return 'worker';
  return 'driver';
}
/* ---------------- Nav ---------------- */
const ADMIN_TABS = [
  {id:'overview', label:'Overview'},
  {id:'bookings', label:'Bookings & Keys'},
  {id:'vehicles', label:'Vehicles'},
  {id:'drivers', label:'Drivers'},
  {id:'faults', label:'Faults'},
  {id:'slots', label:'Key Slots'},
  {id:'workers', label:'Workers'},
  {id:'feedback', label:'Feedback'},
  {id:'staffaccess', label:'Staff Access'},
  {id:'profile', label:'My Profile'}
];
const WORKER_TABS = [
  {id:'approvals', label:'Approve Bookings'},
  {id:'drivers', label:'Drivers'},
  {id:'penalties', label:'Penalty System'},
  {id:'callorder', label:'Call to Order'},
  {id:'feedback', label:'Feedback'},
  {id:'profile', label:'My Profile'}
];
const DRIVER_TABS = [
  {id:'myday', label:'My Day'},
  {id:'reportfault', label:'Report Fault'},
  {id:'feedback', label:'Feedback'},
  {id:'profile', label:'My Profile'}
];
function enterApp(){
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').classList.add('active');
  const role = roleOf(CURRENT);
  document.getElementById('user-role').textContent = role==='bishop' ? 'Bishop · Highest Authority' : cap(role);
  document.getElementById('user-name').textContent = CURRENT.name;
  document.getElementById('myday-title').textContent = 'My Day — Driver';
  let tabs;
  if(role==='bishop'||role==='manager') tabs = ADMIN_TABS;
  else if(role==='worker') tabs = WORKER_TABS;
  else tabs = DRIVER_TABS;
  document.getElementById('add-admin-btn').style.display = role==='bishop' ? 'inline-block' : 'none';
  document.getElementById('add-driver-btn').style.display = (role==='bishop'||role==='manager') ? 'inline-block' : 'none';
  const nav = document.getElementById('nav-tabs');
  nav.innerHTML = tabs.map((t,i)=>`<button data-tab="${t.id}" class="${i===0?'active':''}" onclick="showTab('${t.id}')">${t.label}</button>`).join('');
  showTab(tabs[0].id);
}
function showTab(tabId){
  activeTabId = tabId;
  document.querySelectorAll('#nav-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===tabId));
  document.querySelectorAll('main .page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+tabId).classList.add('active');
  render[tabId] && render[tabId]();
}
/* ---------------- Helpers ---------------- */
function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function fmtTime(iso){ return new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
function findPerson(id){ return allPeople().find(p=>p.id===id); }
function daysUntil(dateStr){
  if(!dateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const exp = new Date(dateStr+'T00:00:00');
  return Math.round((exp-today)/86400000);
}
function licenseStatus(driver){
  const d = daysUntil(driver.licenseExpiry);
  if(d===null) return {label:'No date', cls:'cancelled'};
  if(d<0) return {label:'Expired', cls:'expired'};
  if(d<=30) return {label:`Expires in ${d}d`, cls:'expiring'};
  return {label:'Valid', cls:'active-status'};
}
const STATUS_LABELS = {pending:'Requested', approved:'Approved', active:'Key Picked Up', done:'Key Returned', rejected:'Rejected', cancelled:'Cancelled'};
function statusLabel(s){ return STATUS_LABELS[s] || cap(s); }
function hasUnresolvedAutoPenalty(driverId){
  return DB.penalties.some(p=>p.driverId===driverId && p.auto && p.status==='pending');
}
function nextDateForWeekday(dayName){
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const target = days.indexOf(dayName);
  const d = new Date();
  const diff = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate()+diff);
  return d.toISOString().slice(0,10);
}
function vehicleLabel(v){ return v ? `${v.name}${v.carNumber?' #'+v.carNumber:''} — ${v.plate}` : '—'; }
const render = {};
/* ================= OVERVIEW ================= */
render.overview = function(){
  DB = loadDB();
  const today = new Date().toISOString().slice(0,10);
  const bookingsToday = DB.bookings.filter(b=>b.date===today);
  const openFaults = DB.faults.filter(f=>f.status==='open');
  const clockedIn = DB.clocklog.filter(c=>!c.clockOut);
  const expiredCount = DB.drivers.filter(d=>daysUntil(d.licenseExpiry)!==null && daysUntil(d.licenseExpiry)<0).length;
  document.getElementById('overview-stats').innerHTML = `
    <div class="stat-card"><div class="num">${bookingsToday.length}</div><div class="lbl">Bookings today</div></div>
    <div class="stat-card amber"><div class="num">${clockedIn.length}</div><div class="lbl">Keys out now</div></div>
    <div class="stat-card red"><div class="num">${openFaults.length}</div><div class="lbl">Open faults</div></div>
    <div class="stat-card green"><div class="num">${DB.vehicles.length}</div><div class="lbl">Vehicles</div></div>
    <div class="stat-card ${expiredCount?'red':''}"><div class="num">${expiredCount}</div><div class="lbl">Expired licenses</div></div>
  `;
  const licBody = document.getElementById('overview-license-body');
  const flagged = DB.drivers.filter(d=>{ const dd=daysUntil(d.licenseExpiry); return dd!==null && dd<=30; });
  licBody.innerHTML = flagged.length ? flagged.map(d=>{
    const st = licenseStatus(d);
    return `<tr><td>${d.name}</td><td>${d.licenseExpiry||'—'}</td><td><span class="badge ${st.cls}">${st.label}</span></td>
      <td>${st.cls==='expired' && d.status!=='suspended' ? `<button class="btn small danger" onclick="suspendDriver('${d.id}')">Suspend</button>` : (d.status==='suspended'?'<span class="badge suspended">Suspended</span>':'—')}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No license alerts.</td></tr>`;
  const fuelBody = document.getElementById('overview-fuel-body');
  const lowFuel = DB.vehicles.filter(v=>v.fuel<=20);
  fuelBody.innerHTML = lowFuel.length ? lowFuel.map(v=>{
    const cls = v.fuel<=10 ? 'expired' : 'expiring';
    const label = v.fuel<=10 ? 'Needs refill now' : 'Running low';
    return `<tr><td>${vehicleLabel(v)}</td><td>${v.fuel}%</td><td><span class="badge ${cls}">${label}</span></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="3">All vehicles have adequate fuel.</td></tr>`;
  const keysBody = document.getElementById('keys-out-body');
  keysBody.innerHTML = clockedIn.length ? clockedIn.map(c=>{
    const p = findPerson(c.staffId); const slot = DB.slots.find(s=>s.id===c.slotId);
    const veh = DB.vehicles.find(v=>v.id===c.vehicleId);
    return `<tr><td>${p?p.name:'—'}</td><td>${slot?slot.label:'—'}</td><td>${vehicleLabel(veh)}</td><td>${fmtTime(c.clockIn)}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No keys currently out.</td></tr>`;
  const faultsBody = document.getElementById('overview-faults-body');
  faultsBody.innerHTML = openFaults.length ? openFaults.map(f=>{
    const p = findPerson(f.staffId);
    return `<tr><td>${p?p.name:'—'}</td><td>${f.vehicle}</td><td>${f.description}</td><td><span class="badge open">Open</span></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No open faults.</td></tr>`;
};
/* ================= BOOKINGS & KEYS (admin) ================= */
render.bookings = function(){
  DB = loadDB();
  const pending = DB.bookings.filter(b=>b.status==='pending');
  document.getElementById('pending-bookings-body').innerHTML = pending.length ? pending.map(b=>{
    const p = findPerson(b.staffId); const slot = DB.slots.find(s=>s.id===b.slotId);
    const veh = DB.vehicles.find(v=>v.id===b.vehicleId);
    return `<tr><td>${p?p.name:'—'}</td><td>${slot?slot.label:'(deleted)'}</td><td>${vehicleLabel(veh)}</td><td>${b.date}</td>
      <td class="action-row"><button class="btn small amber" onclick="approveBooking('${b.id}')">Approve</button>
      <button class="btn small danger" onclick="rejectBooking('${b.id}')">Reject</button></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="5">Nothing pending.</td></tr>`;
  const sorted = [...DB.bookings].sort((a,b)=> b.date.localeCompare(a.date));
  document.getElementById('all-bookings-body').innerHTML = sorted.length ? sorted.map(b=>{
    const p = findPerson(b.staffId); const slot = DB.slots.find(s=>s.id===b.slotId);
    const veh = DB.vehicles.find(v=>v.id===b.vehicleId);
    return `<tr><td>${p?p.name:'—'}</td><td>${slot?slot.label:'(deleted)'}</td><td>${vehicleLabel(veh)}</td><td>${b.date}</td>
      <td><span class="badge ${b.status}">${statusLabel(b.status)}</span></td>
      <td>${b.status==='pending'||b.status==='approved' ? `<button class="btn small danger" onclick="cancelBooking('${b.id}')">Cancel</button>`:''}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="6">No bookings yet.</td></tr>`;
};
function approveBooking(id){ DB=loadDB(); const b=DB.bookings.find(x=>x.id===id); if(b) b.status='approved'; saveDB(DB); render.bookings&&render.bookings(); render.approvals&&render.approvals(); }
function rejectBooking(id){ DB=loadDB(); const b=DB.bookings.find(x=>x.id===id); if(b) b.status='rejected'; saveDB(DB); render.bookings&&render.bookings(); render.approvals&&render.approvals(); }
function cancelBooking(id){ DB=loadDB(); const b=DB.bookings.find(x=>x.id===id); if(b) b.status='cancelled'; saveDB(DB); render.bookings&&render.bookings(); }
/* Worker approvals page mirrors pending list */
render.approvals = function(){
  DB = loadDB();
  const pending = DB.bookings.filter(b=>b.status==='pending');
  document.getElementById('worker-pending-body').innerHTML = pending.length ? pending.map(b=>{
    const p = findPerson(b.staffId); const slot = DB.slots.find(s=>s.id===b.slotId);
    const veh = DB.vehicles.find(v=>v.id===b.vehicleId);
    return `<tr><td>${p?p.name:'—'}</td><td>${slot?slot.label:'(deleted)'}</td><td>${vehicleLabel(veh)}</td><td>${b.date}</td>
      <td class="action-row"><button class="btn small amber" onclick="approveBooking('${b.id}')">Approve</button>
      <button class="btn small danger" onclick="rejectBooking('${b.id}')">Reject</button></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="5">Nothing pending.</td></tr>`;
};
/* ================= VEHICLES ================= */
let editingVehicleId=null;
function openVehicleForm(v){
  editingVehicleId = v?v.id:null;
  document.getElementById('vehicle-form-title').textContent = v?'Edit vehicle':'Add vehicle';
  document.getElementById('veh-name').value = v?v.name:'';
  document.getElementById('veh-carnumber').value = v?(v.carNumber||''):'';
  document.getElementById('veh-plate').value = v?v.plate:'';
  document.getElementById('veh-fuel').value = v?v.fuel:100;
  document.getElementById('veh-mileage').value = v?v.mileage:0;
  document.getElementById('veh-condition').value = v?v.condition:'';
  document.getElementById('vehicle-form-wrap').style.display='block';
}
function closeVehicleForm(){ document.getElementById('vehicle-form-wrap').style.display='none'; }
function saveVehicle(){
  const name=document.getElementById('veh-name').value.trim();
  const carNumber=document.getElementById('veh-carnumber').value.trim();
  const plate=document.getElementById('veh-plate').value.trim();
  const fuel=Math.max(0,Math.min(100,parseInt(document.getElementById('veh-fuel').value)||0));
  const mileage=parseInt(document.getElementById('veh-mileage').value)||0;
  const condition=document.getElementById('veh-condition').value.trim();
  if(!name||!plate){ alert('Enter vehicle name and plate number.'); return; }
  DB = loadDB();
  if(editingVehicleId){
    const v = DB.vehicles.find(x=>x.id===editingVehicleId);
    Object.assign(v,{name,carNumber,plate,fuel,mileage,condition});
  } else {
    DB.vehicles.push({id:nextId(DB),name,carNumber,plate,fuel,mileage,condition});
  }
  saveDB(DB); closeVehicleForm(); render.vehicles();
}
function removeVehicle(id){ if(!confirm('Remove this vehicle?')) return; DB=loadDB(); DB.vehicles=DB.vehicles.filter(v=>v.id!==id); saveDB(DB); render.vehicles(); }
render.vehicles = function(){
  DB = loadDB();
  const grid = document.getElementById('vehicles-grid');
  grid.innerHTML = DB.vehicles.length ? DB.vehicles.map(v=>`
    <div class="vehicle-card">
      <div class="vname">${v.name}${v.carNumber?' · <span style="color:var(--amber)">#'+v.carNumber+'</span>':''}</div><div class="vplate">${v.plate}</div>
      <div class="gauge-row"><span>Fuel</span><span>${v.fuel}% ${v.fuel<=20?`<span class="badge ${v.fuel<=10?'expired':'expiring'}" style="margin-left:6px;">${v.fuel<=10?'Refill now':'Low'}</span>`:''}</span></div>
      <div class="gauge-bar"><div class="gauge-fill" style="width:${v.fuel}%;background:${v.fuel<=20?'var(--red)':'var(--amber)'}"></div></div>
      <div class="gauge-row"><span>Mileage</span><span>${v.mileage.toLocaleString()} km</span></div>
      <div class="vcond">${v.condition||'No condition notes.'}</div>
      <div class="action-row" style="margin-top:12px;">
        <button class="btn small ghost" onclick='openVehicleForm(${JSON.stringify(v).replace(/'/g,"&apos;")})'>Edit</button>
        <button class="btn small danger" onclick="removeVehicle('${v.id}')">Remove</button>
      </div>
    </div>`).join('') : `<div class="empty-state">No vehicles added yet.</div>`;
};
/* ================= DRIVERS ================= */
let editingDriverId=null;
function openDriverForm(d){
  editingDriverId = d?d.id:null;
  document.getElementById('driver-form-title').textContent = d?'Edit driver':'Add driver';
  document.getElementById('drv-name').value = d?d.name:'';
  document.getElementById('drv-email').value = d?d.email:'';
  document.getElementById('drv-license').value = d?d.licenseNumber:'';
  document.getElementById('drv-expiry').value = d?d.licenseExpiry:'';
  document.getElementById('drv-code').value = d?d.code:genCode();
  document.getElementById('driver-form-wrap').style.display='block';
}
function closeDriverForm(){ document.getElementById('driver-form-wrap').style.display='none'; }
function saveDriver(){
  const name=document.getElementById('drv-name').value.trim();
  const email=document.getElementById('drv-email').value.trim();
  const licenseNumber=document.getElementById('drv-license').value.trim();
  const licenseExpiry=document.getElementById('drv-expiry').value;
  const code=normalizeCode(document.getElementById('drv-code').value) || genCode();
  if(!name){ alert('Enter the driver name.'); return; }
  DB = loadDB();
  const clash = allPeople().find(p => normalizeCode(p.code)===code && p.id!==editingDriverId);
  if(clash){ alert('That access code is already in use by '+clash.name+'. Choose a different code.'); return; }
  if(editingDriverId){
    const d = DB.drivers.find(x=>x.id===editingDriverId);
    Object.assign(d,{name,email,licenseNumber,licenseExpiry,code});
    // if the license was just renewed to a future date and they were auto-suspended for expiry, reinstate them
    const daysLeft = daysUntil(licenseExpiry);
    if(d.autoSuspended && daysLeft!==null && daysLeft>=0){
      d.status='active'; d.autoSuspended=false;
    }
  } else {
    DB.drivers.push({id:nextId(DB),name,email,licenseNumber,licenseExpiry,role:'driver',code,status:'active'});
  }
  saveDB(DB); closeDriverForm(); render.drivers();
}
function removeDriver(id){ if(!confirm('Remove this driver? Their code will stop working.')) return; DB=loadDB(); DB.drivers=DB.drivers.filter(d=>d.id!==id); saveDB(DB); render.drivers(); }
function suspendDriver(id){
  DB=loadDB(); const d=DB.drivers.find(x=>x.id===id);
  if(d){ d.status = d.status==='suspended'?'active':'suspended'; d.autoSuspended=false; }
  saveDB(DB); render.drivers&&render.drivers(); render.overview&&document.getElementById('page-overview').classList.contains('active')&&render.overview();
}
render.drivers = function(){
  DB = loadDB();
  const role = roleOf(CURRENT);
  const canEdit = role==='bishop'||role==='manager';
  const body = document.getElementById('drivers-body');
  body.innerHTML = DB.drivers.length ? DB.drivers.map(d=>{
    const st = licenseStatus(d);
    return `<tr><td>${d.name}</td><td>${d.licenseNumber||'—'}</td><td><span class="badge ${st.cls}">${st.label}</span></td>
      <td><span class="badge ${d.status==='suspended'?'suspended':'active-status'}">${cap(d.status)}</span>${d.status==='suspended'&&d.autoSuspended?' <span style="font-size:10px;color:var(--paper-dim);">(auto — expired license)</span>':''}</td>
      <td><span class="code-pill">${d.code}</span></td>
      <td class="action-row">
        <button class="btn small ${d.status==='suspended'?'amber':'danger'}" onclick="suspendDriver('${d.id}')">${d.status==='suspended'?'Reinstate':'Suspend'}</button>
        ${canEdit?`<button class="btn small ghost" onclick='openDriverForm(${JSON.stringify(d).replace(/'/g,"&apos;")})'>Edit</button>
        <button class="btn small danger" onclick="removeDriver('${d.id}')">Remove</button>`:''}
      </td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="6">No drivers added yet.</td></tr>`;
};
/* ================= FAULTS (admin) ================= */
function resolveFault(id){ DB=loadDB(); const f=DB.faults.find(x=>x.id===id); if(f) f.status='resolved'; saveDB(DB); render.faults(); }
render.faults = function(){
  DB = loadDB();
  const sorted=[...DB.faults].sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('faults-admin-body').innerHTML = sorted.length ? sorted.map(f=>{
    const p = findPerson(f.staffId);
    return `<tr><td>${p?p.name:'—'}</td><td>${f.vehicle}</td><td>${f.description}</td>
      <td><span class="badge ${f.status}">${cap(f.status)}</span></td>
      <td>${f.status==='open'?`<button class="btn small amber" onclick="resolveFault('${f.id}')">Mark resolved</button>`:''}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="5">No faults reported.</td></tr>`;
};
/* ================= KEY SLOTS ================= */
const PRESETS = {
  'sun-am':{start:'07:00',end:'15:00'}, 'sun-pm':{start:'17:00',end:'20:00'},
  'tue':{start:'17:00',end:'22:00'}, 'thu':{start:'17:00',end:'22:00'},
  'day':{start:'07:00',end:'15:00'}, 'evening':{start:'17:00',end:'22:00'}
};
function toggleSlotFields(){
  const type = document.getElementById('slot-type').value;
  document.getElementById('slot-recurring-fields').style.display = type==='recurring'?'grid':'none';
  document.getElementById('slot-event-fields').style.display = type==='event'?'grid':'none';
  applyPresetWindow();
}
function applyPresetWindow(){
  const type = document.getElementById('slot-type').value;
  let key = type==='recurring' ? document.getElementById('slot-window').value : document.getElementById('slot-event-session').value;
  if(PRESETS[key]){ document.getElementById('slot-start').value = PRESETS[key].start; document.getElementById('slot-end').value = PRESETS[key].end; }
}
function refreshEventNameOptions(){
  DB = loadDB();
  const sel = document.getElementById('slot-event-name');
  sel.innerHTML = DB.eventNames.map(n=>`<option value="${n}">${n}</option>`).join('') + `<option value="__custom">+ Type a new event name…</option>`;
  sel.onchange = ()=>{ document.getElementById('slot-event-name-custom').style.display = sel.value==='__custom' ? 'block':'none'; };
  sel.onchange();
}
function openSlotForm(){
  document.getElementById('slot-form-wrap').style.display='block';
  document.getElementById('slot-type').value='recurring';
  refreshEventNameOptions();
  document.getElementById('slot-event-name-custom').value='';
  document.getElementById('slot-event-date').value='';
  toggleSlotFields();
}
function closeSlotForm(){ document.getElementById('slot-form-wrap').style.display='none'; }
function saveSlot(){
  const type = document.getElementById('slot-type').value;
  const start = document.getElementById('slot-start').value;
  const end = document.getElementById('slot-end').value;
  DB = loadDB();
  let label, day=null, eventName=null, eventDate=null;
  if(type==='recurring'){
    day = document.getElementById('slot-day').value;
    label = `${day} ${start}–${end}`;
  } else {
    const sel = document.getElementById('slot-event-name').value;
    eventName = sel==='__custom' ? document.getElementById('slot-event-name-custom').value.trim() : sel;
    if(!eventName){ alert('Enter an event name.'); return; }
    eventDate = document.getElementById('slot-event-date').value;
    if(!eventDate){ alert('Choose the date for this event.'); return; }
    if(!DB.eventNames.includes(eventName)) DB.eventNames.push(eventName);
    const session = document.getElementById('slot-event-session').value;
    label = `${eventName} (${eventDate}) — ${session==='day'?'Day':'Evening'} ${start}–${end}`;
  }
  DB.slots.push({id:nextId(DB), type, label, day, eventName, eventDate, start, end});
  saveDB(DB); closeSlotForm(); render.slots();
}
function deleteSlot(id){ DB=loadDB(); DB.slots=DB.slots.filter(s=>s.id!==id); saveDB(DB); render.slots(); }
render.slots = function(){
  DB = loadDB();
  const grid = document.getElementById('slots-grid');
  grid.innerHTML = DB.slots.length ? DB.slots.map(s=>{
    const requestedCount = DB.bookings.filter(b=>b.slotId===s.id && (b.status==='pending'||b.status==='approved')).length;
    return `<div class="slot-card">
      <div class="slot-tag">${s.type==='event'?'Event':'Recurring'}</div>
      <div class="slot-label">${s.label}</div>
      <div class="slot-time">${s.start} – ${s.end}</div>
      <div class="slot-cap">${requestedCount} request${requestedCount===1?'':'s'} so far — unlimited bookings allowed</div>
      <button class="btn small danger" onclick="deleteSlot('${s.id}')">Delete</button>
    </div>`;
  }).join('') : `<div class="empty-state">No key slots defined yet.</div>`;
};
/* ================= WORKERS (admin managed) ================= */
let editingWorkerId=null;
function openWorkerForm(w){ editingWorkerId=w?w.id:null; document.getElementById('worker-form-title').textContent = w?'Edit worker':'Add worker';
  document.getElementById('wrk-name').value = w?w.name:'';
  document.getElementById('wrk-code').value = w?w.code:genCode();
  document.getElementById('worker-form-wrap').style.display='block'; }
function closeWorkerForm(){ document.getElementById('worker-form-wrap').style.display='none'; }
function saveWorker(){
  const name=document.getElementById('wrk-name').value.trim();
  const code=normalizeCode(document.getElementById('wrk-code').value) || genCode();
  if(!name){ alert('Enter a name.'); return; }
  DB = loadDB();
  const clash = allPeople().find(p => normalizeCode(p.code)===code && p.id!==editingWorkerId);
  if(clash){ alert('That access code is already in use by '+clash.name+'. Choose a different code.'); return; }
  if(editingWorkerId){ const w=DB.workers.find(x=>x.id===editingWorkerId); Object.assign(w,{name,code}); }
  else { DB.workers.push({id:nextId(DB), name, role:'worker', code}); }
  saveDB(DB); closeWorkerForm(); render.workers();
}
function removeWorker(id){ if(!confirm('Remove this worker?')) return; DB=loadDB(); DB.workers=DB.workers.filter(w=>w.id!==id); saveDB(DB); render.workers(); }
render.workers = function(){
  DB = loadDB();
  document.getElementById('workers-body').innerHTML = DB.workers.length ? DB.workers.map(w=>`
    <tr><td>${w.name}</td><td><span class="code-pill">${w.code}</span></td>
    <td class="action-row"><button class="btn small ghost" onclick='openWorkerForm(${JSON.stringify(w).replace(/'/g,"&apos;")})'>Edit</button>
    <button class="btn small danger" onclick="removeWorker('${w.id}')">Remove</button></td></tr>
  `).join('') : `<tr class="empty-row"><td colspan="3">No workers added yet.</td></tr>`;
};
/* ================= PENALTIES ================= */
function refreshDriverSelect(id){
  DB = loadDB();
  const sel = document.getElementById(id);
  sel.innerHTML = DB.drivers.map(d=>`<option value="${d.id}">${d.name}</option>`).join('') || `<option value="">No drivers</option>`;
}
function issuePenalty(){
  const driverId = document.getElementById('pen-driver').value;
  const points = parseInt(document.getElementById('pen-points').value)||1;
  const reason = document.getElementById('pen-reason').value.trim();
  if(!driverId||!reason){ alert('Choose a driver and enter a reason.'); return; }
  DB = loadDB();
  DB.penalties.push({id:nextId(DB), driverId, points, reason, issuedBy:CURRENT.name, date:new Date().toISOString(), auto:false, status:'logged'});
  saveDB(DB);
  document.getElementById('pen-reason').value='';
  render.penalties();
}
function resolvePenalty(id){
  DB = loadDB();
  const p = DB.penalties.find(x=>x.id===id);
  if(p) p.status = 'resolved';
  saveDB(DB); render.penalties();
}
render.penalties = function(){
  DB = loadDB();
  refreshDriverSelect('pen-driver');
  const sorted=[...DB.penalties].sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('penalties-body').innerHTML = sorted.length ? sorted.map(p=>{
    const d = DB.drivers.find(x=>x.id===p.driverId);
    const statusBadge = p.status==='resolved' ? `<span class="badge resolved">Resolved</span>` : (p.auto ? `<span class="badge open">Blocking booking</span>` : `<span class="badge cancelled">Logged</span>`);
    return `<tr><td>${d?d.name:'—'}</td><td>${p.points}</td><td>${p.reason}</td><td>${p.auto?'Automatic':'Manual'}</td><td>${statusBadge}</td><td>${p.issuedBy}</td><td>${new Date(p.date).toLocaleDateString()}</td>
      <td>${p.auto && p.status==='pending' ? `<button class="btn small amber" onclick="resolvePenalty('${p.id}')">Mark resolved</button>` : ''}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="8">No penalties logged.</td></tr>`;
};
/* ================= CALL TO ORDER ================= */
function issueCallToOrder(){
  const driverId = document.getElementById('co-driver').value;
  const note = document.getElementById('co-note').value.trim();
  if(!driverId||!note){ alert('Choose a driver and enter a note.'); return; }
  DB = loadDB();
  DB.calltoorder.push({id:nextId(DB), driverId, note, issuedBy:CURRENT.name, date:new Date().toISOString()});
  saveDB(DB);
  document.getElementById('co-note').value='';
  render.callorder();
}
render.callorder = function(){
  DB = loadDB();
  refreshDriverSelect('co-driver');
  const sorted=[...DB.calltoorder].sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('callorder-body').innerHTML = sorted.length ? sorted.map(c=>{
    const d = DB.drivers.find(x=>x.id===c.driverId);
    return `<tr><td>${d?d.name:'—'}</td><td>${c.note}</td><td>${c.issuedBy}</td><td>${new Date(c.date).toLocaleDateString()}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No notices issued.</td></tr>`;
};
/* ================= FEEDBACK (shared) ================= */
function refreshFeedbackVehicleOptions(){
  DB = loadDB();
  const sel = document.getElementById('fb-vehicle');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">General feedback — not about a specific car</option>` +
    DB.vehicles.map(v=>`<option value="${v.id}">${vehicleLabel(v)}</option>`).join('');
  sel.value = current || '';
}
function submitFeedback(){
  const message = document.getElementById('fb-message').value.trim();
  const vehicleId = document.getElementById('fb-vehicle').value || null;
  if(!message){ alert('Write a message first.'); return; }
  DB = loadDB();
  DB.feedback.push({id:nextId(DB), from:CURRENT.name, fromId:CURRENT.id, vehicleId, message, date:new Date().toISOString()});
  saveDB(DB);
  document.getElementById('fb-message').value='';
  document.getElementById('fb-vehicle').value='';
  render.feedback();
}
render.feedback = function(){
  DB = loadDB();
  refreshFeedbackVehicleOptions();
  const role = roleOf(CURRENT);
  const isAdmin = role==='bishop'||role==='manager';
  document.getElementById('feedback-list-title').textContent = isAdmin ? 'All feedback' : 'My feedback';
  const list = isAdmin ? DB.feedback : DB.feedback.filter(f=>f.fromId===CURRENT.id);
  const sorted = [...list].sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('feedback-body').innerHTML = sorted.length ? sorted.map(f=>{
    const v = f.vehicleId ? DB.vehicles.find(x=>x.id===f.vehicleId) : null;
    return `<tr><td>${f.from}</td><td>${v?vehicleLabel(v):'—'}</td><td>${f.message}</td><td>${new Date(f.date).toLocaleDateString()}</td></tr>`;
  }
  ).join('') : `<tr class="empty-row"><td colspan="3">No feedback yet.</td></tr>`;
};
/* ================= STAFF ACCESS (bishop manages admins) ================= */
let editingAdminId=null;
function openAdminForm(a){
  editingAdminId = a?a.id:null;
  document.getElementById('admin-form-title').textContent = a?'Edit administrator':'Add administrator';
  document.getElementById('adm-name').value = a?a.name:'';
  document.getElementById('adm-role').value = a?a.role:'manager';
  const codeField = document.getElementById('adm-code');
  if(a){
    if(a.id === CURRENT.id){ codeField.value = a.code; codeField.placeholder=''; }
    else { codeField.value=''; codeField.placeholder='Leave blank to keep their current code'; }
  } else {
    codeField.value = genCode(); codeField.placeholder='';
  }
  document.getElementById('admin-form-wrap').style.display='block';
}
function closeAdminForm(){ document.getElementById('admin-form-wrap').style.display='none'; }
function saveAdmin(){
  const name=document.getElementById('adm-name').value.trim();
  const role=document.getElementById('adm-role').value;
  const rawCode=normalizeCode(document.getElementById('adm-code').value);
  if(!name){ alert('Enter a name.'); return; }
  DB = loadDB();
  let code;
  if(editingAdminId){
    const existing = DB.admins.find(x=>x.id===editingAdminId);
    code = rawCode || existing.code;
  } else {
    code = rawCode || genCode();
  }
  const clash = allPeople().find(p => normalizeCode(p.code)===code && p.id!==editingAdminId);
  if(clash){ alert('That access code is already in use by '+clash.name+'. Choose a different code.'); return; }
  if(editingAdminId){
    const a = DB.admins.find(x=>x.id===editingAdminId);
    Object.assign(a,{name,role,code});
    if(CURRENT.id===a.id) CURRENT = a;
  } else {
    DB.admins.push({id:nextId(DB), name, role, code});
  }
  saveDB(DB); closeAdminForm(); render.staffaccess();
}
function removeAdmin(id){
  DB = loadDB();
  const target = DB.admins.find(a=>a.id===id);
  if(!target) return;
  if(target.id === CURRENT.id){ alert("You can't remove your own administrator account from here."); return; }
  if(DB.admins.length <= 1){ alert('At least one administrator must remain on the system.'); return; }
  if(!confirm(`Remove ${target.name} as administrator? This cannot be undone.`)) return;
  DB.admins = DB.admins.filter(a=>a.id!==id);
  saveDB(DB); render.staffaccess();
}
render.staffaccess = function(){
  DB = loadDB();
  const role = roleOf(CURRENT);
  const canManage = role==='bishop' || role==='manager';
  document.getElementById('add-admin-btn').style.display = canManage ? 'inline-block' : 'none';
  document.getElementById('staffaccess-body').innerHTML = DB.admins.map(a=>{
    const isSelf = a.id === CURRENT.id;
    const canRemove = canManage && !isSelf && DB.admins.length>1;
    const codeDisplay = isSelf ? `<span class="code-pill">${a.code}</span>` : `<span style="color:var(--paper-dim);font-size:12px;">Hidden</span>`;
    const editPayload = isSelf ? a : {id:a.id, name:a.name, role:a.role, code:''};
    return `<tr><td>${a.name}</td><td>${a.role==='bishop'?'Bishop · Highest Authority':'Manager'}</td>
    <td>${codeDisplay}</td>
    <td class="action-row">
      ${canManage ? `<button class="btn small ghost" onclick='openAdminForm(${JSON.stringify(editPayload).replace(/'/g,"&apos;")})'>Edit</button>` : ''}
      ${canRemove ? `<button class="btn small danger" onclick="removeAdmin('${a.id}')">Remove</button>` : ''}
    </td></tr>`;
  }).join('');
};
/* ================= DRIVER: MY DAY ================= */
render.myday = function(){
  DB = loadDB();
  const me = DB.drivers.find(d=>d.id===CURRENT.id);
  const msgEl = document.getElementById('myday-msg');
  msgEl.innerHTML='';
  const blockedByPenalty = hasUnresolvedAutoPenalty(CURRENT.id);
  if(me && me.status==='suspended'){
    msgEl.innerHTML = `<div class="msg err">Your account is suspended. You cannot book slots or clock in. Contact the fleet office.</div>`;
  } else if(blockedByPenalty){
    msgEl.innerHTML = `<div class="msg err">You have an unresolved penalty on file for late key returns. You cannot book a new slot until the fleet office clears it.</div>`;
  } else {
    const d = daysUntil(me?me.licenseExpiry:null);
    if(d!==null && d<0) msgEl.innerHTML = `<div class="msg err">Your driving license expired on ${me.licenseExpiry}. Please renew it and update your profile.</div>`;
    else if(d!==null && d<=30) msgEl.innerHTML = `<div class="msg warn">Your driving license expires in ${d} day(s) (${me.licenseExpiry}). Please renew soon.</div>`;
  }
  const openClock = DB.clocklog.find(c=>c.staffId===CURRENT.id && !c.clockOut);
  const panel = document.getElementById('clock-panel');
  if(openClock){
    const slot = DB.slots.find(s=>s.id===openClock.slotId);
    const veh = DB.vehicles.find(v=>v.id===openClock.vehicleId);
    panel.innerHTML = `<h3>Key currently with you</h3>
      <p style="color:var(--paper-dim);font-size:13px;margin-bottom:14px;">${slot?slot.label:'—'} · ${vehicleLabel(veh)} — since ${fmtTime(openClock.clockIn)}</p>
      <div class="form-grid">
        <div class="field"><label>Kilometers driven this trip</label><input id="return-km" type="number" min="0" value="0"></div>
        <div class="field"><label>Fuel level now (%)</label><input id="return-fuel" type="number" min="0" max="100" value="${veh?veh.fuel:100}"></div>
      </div>
      <button class="btn amber" onclick="clockOut('${openClock.id}')">Submit key — mark as returned</button>`;
  } else {
    panel.innerHTML = `<h3>Clock status</h3><p style="color:var(--paper-dim);font-size:13px;">Not currently holding a key. Clock in from an approved booking below once you're ready to pick it up.</p>`;
  }
  const suspended = me && me.status==='suspended';
  const blocked = suspended || blockedByPenalty;
  const bookGrid = document.getElementById('book-slots-grid');
  bookGrid.innerHTML = DB.slots.length ? DB.slots.map(s=>{
    const requestedCount = DB.bookings.filter(b=>b.slotId===s.id && (b.status==='pending'||b.status==='approved')).length;
    return `<div class="slot-card">
      <div class="slot-tag">${s.type==='event'?'Event':'Recurring'}</div>
      <div class="slot-label">${s.label}</div><div class="slot-time">${s.start} – ${s.end}</div>
      <div class="slot-cap">${requestedCount} request${requestedCount===1?'':'s'} so far</div>
      <button class="btn small ${blocked?'ghost':'amber'}" ${blocked?'disabled':''} onclick="openBookingRequest('${s.id}')">Request booking</button>
    </div>`;
  }).join('') : `<div class="empty-state">No key slots available yet — check with your fleet manager.</div>`;
  const myBookings = DB.bookings.filter(b=>b.staffId===CURRENT.id).sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('my-bookings-body').innerHTML = myBookings.length ? myBookings.map(b=>{
    const slot = DB.slots.find(s=>s.id===b.slotId);
    const veh = DB.vehicles.find(v=>v.id===b.vehicleId);
    const canClockIn = b.status==='approved' && !openClock && !suspended;
    return `<tr><td>${slot?slot.label:'(deleted)'}</td><td>${vehicleLabel(veh)}</td><td>${b.date}</td>
      <td><span class="badge ${b.status}">${statusLabel(b.status)}</span></td>
      <td>${canClockIn ? `<button class="btn small amber" onclick="clockIn('${b.id}')">Clock in — pick up key</button>` : ''}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="5">No bookings yet.</td></tr>`;
};
let pendingRequestSlotId = null;
function openBookingRequest(slotId){
  DB = loadDB();
  const slot = DB.slots.find(s=>s.id===slotId);
  if(!slot) return;
  pendingRequestSlotId = slotId;
  document.getElementById('book-request-slotlabel').textContent = `${slot.label} (${slot.start}–${slot.end}) — the time is fixed by this slot.`;
  const dateInput = document.getElementById('book-date');
  if(slot.type==='event'){
    dateInput.value = slot.eventDate || '';
    dateInput.disabled = true;
  } else {
    dateInput.disabled = false;
    dateInput.min = new Date().toISOString().slice(0,10);
    dateInput.value = nextDateForWeekday(slot.day);
  }
  const outVehicleIds = DB.clocklog.filter(c=>!c.clockOut).map(c=>c.vehicleId).filter(Boolean);
  const vehSel = document.getElementById('book-vehicle');
  vehSel.innerHTML = DB.vehicles.length ? DB.vehicles.map(v=>{
    const isOut = outVehicleIds.includes(v.id);
    return `<option value="${v.id}" ${isOut?'disabled':''}>${vehicleLabel(v)}${isOut?' — currently out':''}</option>`;
  }).join('') : `<option value="">No vehicles added yet</option>`;
  document.getElementById('book-request-wrap').style.display='block';
}
function closeBookingRequest(){ pendingRequestSlotId=null; document.getElementById('book-request-wrap').style.display='none'; }
function confirmBooking(){
  DB = loadDB();
  const me = DB.drivers.find(d=>d.id===CURRENT.id);
  if(me && me.status==='suspended'){ alert('Your account is suspended.'); return; }
  if(hasUnresolvedAutoPenalty(CURRENT.id)){ alert('You have an unresolved penalty on file. Please see the fleet office before booking again.'); return; }
  const slot = DB.slots.find(s=>s.id===pendingRequestSlotId);
  if(!slot){ alert('That slot no longer exists.'); return; }
  const vehicleId = document.getElementById('book-vehicle').value;
  if(!vehicleId){ alert('Choose a vehicle.'); return; }
  let date;
  if(slot.type==='event'){
    date = slot.eventDate;
    if(!date){ alert('This event has no date set yet — ask the fleet office.'); return; }
  } else {
    date = document.getElementById('book-date').value;
    if(!date){ alert('Choose a date.'); return; }
    const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const chosenDay = days[new Date(date+'T00:00:00').getDay()];
    if(chosenDay !== slot.day){ alert(`This slot is only available on ${slot.day}s. Please choose a ${slot.day} date.`); return; }
  }
  DB.bookings.push({id:nextId(DB), staffId:CURRENT.id, slotId:slot.id, vehicleId, date, status:'pending'});
  saveDB(DB);
  closeBookingRequest();
  render.myday();
}
function clockIn(bookingId){
  DB = loadDB();
  const b = DB.bookings.find(x=>x.id===bookingId); if(!b) return;
  DB.clocklog.push({id:nextId(DB), staffId:CURRENT.id, slotId:b.slotId, vehicleId:b.vehicleId, bookingId, clockIn:new Date().toISOString(), clockOut:null});
  b.status='active'; saveDB(DB); render.myday();
}
function clockOut(clockId){
  DB = loadDB();
  const c = DB.clocklog.find(x=>x.id===clockId); if(!c) return;
  const kmInput = document.getElementById('return-km');
  const fuelInput = document.getElementById('return-fuel');
  const kmDriven = Math.max(0, parseInt(kmInput?kmInput.value:0)||0);
  const fuelNow = fuelInput && fuelInput.value!=='' ? Math.max(0,Math.min(100, parseInt(fuelInput.value)||0)) : null;
  const nowIso = new Date().toISOString();
  c.clockOut = nowIso;
  const b = DB.bookings.find(x=>x.id===c.bookingId); if(b) b.status='done';
  const slot = DB.slots.find(s=>s.id===c.slotId);
  const driver = DB.drivers.find(d=>d.id===c.staffId);
  const vehicle = DB.vehicles.find(v=>v.id===c.vehicleId);
  if(vehicle){
    vehicle.mileage = (vehicle.mileage||0) + kmDriven;
    if(fuelNow!==null) vehicle.fuel = fuelNow;
  }
  if(slot && driver && b){
    const deadline = new Date(b.date+'T'+slot.end+':00');
    if(new Date(nowIso) > deadline){
      driver.lateStreak = (driver.lateStreak||0) + 1;
      if(driver.lateStreak >= 3){
        DB.penalties.push({id:nextId(DB), driverId:driver.id, points:3, reason:'Automatic penalty: late key return (3 late returns on record)', issuedBy:'System', date:nowIso, auto:true, status:'pending'});
        driver.lateStreak = 0;
      }
    }
  }
  saveDB(DB); render.myday();
}
/* ================= MY PROFILE (all roles) ================= */
function changeMyCode(){
  const val = normalizeCode(document.getElementById('my-new-code').value);
  const msgEl = document.getElementById('my-code-msg');
  if(!val){ msgEl.innerHTML = '<div class="msg err">Enter a new code.</div>'; return; }
  DB = loadDB();
  const clash = allPeople().find(p => normalizeCode(p.code)===val && p.id!==CURRENT.id);
  if(clash){ msgEl.innerHTML = '<div class="msg err">That code is already in use by someone else.</div>'; return; }
  const role = roleOf(CURRENT);
  let record;
  if(role==='driver') record = DB.drivers.find(d=>d.id===CURRENT.id);
  else if(role==='worker') record = DB.workers.find(w=>w.id===CURRENT.id);
  else record = DB.admins.find(a=>a.id===CURRENT.id);
  if(record){ record.code = val; saveDB(DB); CURRENT = record; }
  document.getElementById('my-new-code').value='';
  msgEl.innerHTML = '<div class="msg ok">Access code updated. Use this new code next time you log in.</div>';
  render.profile();
}
render.profile = function(){
  DB = loadDB();
  const role = roleOf(CURRENT);
  const msgEl = document.getElementById('profile-msg'); msgEl.innerHTML='';
  const penPanel = document.getElementById('profile-penalties-panel');
  const noticePanel = document.getElementById('profile-notices-panel');
  if(role==='driver'){
    document.getElementById('profile-subtitle').textContent = 'Your driver record';
    penPanel.style.display='block'; noticePanel.style.display='block';
    const me = DB.drivers.find(d=>d.id===CURRENT.id);
    if(me){
      const d = daysUntil(me.licenseExpiry);
      if(me.status==='suspended') msgEl.innerHTML = `<div class="msg err">Your account is currently suspended.</div>`;
      else if(d!==null && d<0) msgEl.innerHTML = `<div class="msg err">Your license expired on ${me.licenseExpiry}. Please renew immediately.</div>`;
      else if(d!==null && d<=30) msgEl.innerHTML = `<div class="msg warn">Your license expires in ${d} day(s).</div>`;
    }
    document.getElementById('profile-card').innerHTML = me ? `
      <div class="profile-field"><label>Full name</label><div>${me.name}</div></div>
      <div class="profile-field"><label>Email</label><div>${me.email||'—'}</div></div>
      <div class="profile-field"><label>License number</label><div>${me.licenseNumber||'—'}</div></div>
      <div class="profile-field"><label>License expiry</label><div>${me.licenseExpiry||'—'}</div></div>
      <div class="profile-field"><label>Status</label><div><span class="badge ${me.status==='suspended'?'suspended':'active-status'}">${cap(me.status)}</span></div></div>
      <div class="profile-field"><label>Access code</label><div><span class="code-pill">${me.code}</span></div></div>
    ` : '';
    const myPenalties = DB.penalties.filter(p=>p.driverId===CURRENT.id).sort((a,b)=>b.date.localeCompare(a.date));
    document.getElementById('my-penalties-body').innerHTML = myPenalties.length ? myPenalties.map(p=>
      `<tr><td>${p.points}</td><td>${p.reason}</td><td>${new Date(p.date).toLocaleDateString()}</td></tr>`).join('')
      : `<tr class="empty-row"><td colspan="3">No penalties on record.</td></tr>`;
    const myNotices = DB.calltoorder.filter(c=>c.driverId===CURRENT.id).sort((a,b)=>b.date.localeCompare(a.date));
    document.getElementById('my-notices-body').innerHTML = myNotices.length ? myNotices.map(c=>
      `<tr><td>${c.note}</td><td>${new Date(c.date).toLocaleDateString()}</td></tr>`).join('')
      : `<tr class="empty-row"><td colspan="2">No notices on record.</td></tr>`;
  } else {
    // manager, bishop, worker — simple account card, no penalties/notices
    penPanel.style.display='none'; noticePanel.style.display='none';
    document.getElementById('profile-subtitle').textContent = 'Your account details';
    const roleLabel = role==='bishop' ? 'Bishop · Highest Authority' : cap(role);
    document.getElementById('profile-card').innerHTML = `
      <div class="profile-field"><label>Full name</label><div>${CURRENT.name}</div></div>
      <div class="profile-field"><label>Role</label><div>${roleLabel}</div></div>
      <div class="profile-field"><label>Access code</label><div><span class="code-pill">${CURRENT.code}</span></div></div>
    `;
  }
};
/* ================= DRIVER: REPORT FAULT ================= */
function refreshFaultVehicleOptions(){
  DB = loadDB();
  const sel = document.getElementById('fault-vehicle-select');
  if(!sel) return;
  sel.innerHTML = `<option value="">Select a vehicle…</option>` +
    DB.vehicles.map(v=>`<option value="${v.id}">${vehicleLabel(v)}</option>`).join('') +
    `<option value="__other">Other / not listed…</option>`;
  toggleFaultVehicleOther();
}
function toggleFaultVehicleOther(){
  const sel = document.getElementById('fault-vehicle-select');
  document.getElementById('fault-vehicle-other-field').style.display = (sel && sel.value==='__other') ? 'block' : 'none';
}
function submitFault(){
  DB = loadDB();
  const sel = document.getElementById('fault-vehicle-select');
  const vehicleId = sel.value === '__other' ? null : (sel.value || null);
  let vehicleLabelText;
  if(vehicleId){
    const v = DB.vehicles.find(x=>x.id===vehicleId);
    vehicleLabelText = v ? vehicleLabel(v) : '';
  } else if(sel.value==='__other'){
    vehicleLabelText = document.getElementById('fault-vehicle-other').value.trim();
  } else {
    vehicleLabelText = '';
  }
  const description = document.getElementById('fault-desc').value.trim();
  if(!vehicleLabelText||!description){ alert('Choose a vehicle and enter a description.'); return; }
  DB.faults.push({id:nextId(DB), staffId:CURRENT.id, vehicleId, vehicle:vehicleLabelText, description, status:'open', date:new Date().toISOString()});
  saveDB(DB);
  sel.value=''; document.getElementById('fault-vehicle-other').value=''; document.getElementById('fault-desc').value='';
  toggleFaultVehicleOther();
  render.reportfault();
}
render.reportfault = function(){
  DB = loadDB();
  refreshFaultVehicleOptions();
  const mine = DB.faults.filter(f=>f.staffId===CURRENT.id).sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('my-faults-body').innerHTML = mine.length ? mine.map(f=>
    `<tr><td>${f.vehicle}</td><td>${f.description}</td><td><span class="badge ${f.status}">${cap(f.status)}</span></td></tr>`).join('')
    : `<tr class="empty-row"><td colspan="3">No reports submitted yet.</td></tr>`;
};
