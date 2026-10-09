/* ===== Fleet Operations — app.js (complete) ===== */
/* ---------------- Storage (falls back to memory if localStorage is blocked) ---------------- */
const DB_KEY = 'fleetops_db_v4';
let STORAGE_OK = true;
let MEMORY_STORE = {};
function storageGet(key) { try { return localStorage.getItem(key); } catch (e) { STORAGE_OK = false; return (key in MEMORY_STORE) ? MEMORY_STORE[key] : null; } }
function storageSet(key, val) { try { localStorage.setItem(key, val); } catch (e) { STORAGE_OK = false; MEMORY_STORE[key] = val; } }

function defaultDB() {
  return {
    admins: [
      { id: 'a1', name: 'Bishop One', role: 'bishop', code: '2000' },
      { id: 'a2', name: 'Bishop Two', role: 'bishop', code: '3000' },
      { id: 'a3', name: 'Bishop Three', role: 'bishop', code: '4000' },
      { id: 'a4', name: 'Fleet Manager', role: 'manager', code: '1000' }
    ],
    workers: [], drivers: [], vehicles: [], slots: [], bookings: [], faults: [],
    clocklog: [], fuellog: [], penalties: [], calltoorder: [], feedback: [], eventNames: [], seq: 1
  };
}
function loadDB() {
  const raw = storageGet(DB_KEY);
  if (!raw) { const db = defaultDB(); storageSet(DB_KEY, JSON.stringify(db)); return db; }
  let db;
  try { db = JSON.parse(raw); } catch (e) { db = defaultDB(); storageSet(DB_KEY, JSON.stringify(db)); return db; }
  const def = defaultDB();
  Object.keys(def).forEach(k => { if (db[k] === undefined) db[k] = def[k]; });
  return db;
}
function saveDB(db) { storageSet(DB_KEY, JSON.stringify(db)); }
function resetSystemData() {
  if (!confirm('This clears ALL Fleet Operations data on this device (staff, bookings, vehicles) and restores the original Bishop/Manager codes. Continue?')) return;
  try { localStorage.removeItem(DB_KEY); } catch (e) {}
  MEMORY_STORE = {};
  location.reload();
}
function nextId(db) { return 'id' + (db.seq++); }
function genCode() { return String(Math.floor(1000 + Math.random() * 9000)); }

let DB = loadDB();
let CURRENT = null;

if (!STORAGE_OK) {
  const w = document.createElement('div');
  w.className = 'msg warn';
  w.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:999;max-width:420px;';
  w.textContent = "This browser is blocking saved storage, so data won't be remembered after you close this tab. Everything still works for this session.";
  document.body.appendChild(w);
}

/* ---------------- Login ---------------- */
function allPeople() { return [...DB.admins, ...DB.workers, ...DB.drivers]; }
const ROLE_LABELS = { bishop: 'Bishop', manager: 'Manager', worker: 'Worker', driver: 'Driver' };
function normalizeCode(s) { return (s || '').trim().toUpperCase().replace(/\s+/g, ''); }

function fillNames(selId, list, labelFn) {
  DB = loadDB();
  const sel = document.getElementById(selId); if (!sel) return;
  sel.innerHTML = `<option value="">Select your name…</option>` + list().map(p => `<option value="${p.id}">${labelFn(p)}</option>`).join('');
}
function refreshAdminNameOptions() { fillNames('admin-name-select', () => DB.admins, a => `${a.name} (${a.role === 'bishop' ? 'Bishop' : 'Manager'})`); }
function refreshDriverNameOptions() { fillNames('driver-name-select', () => DB.drivers, d => d.name); }
function refreshWorkerNameOptions() { fillNames('worker-name-select', () => DB.workers, w => w.name); }

function attemptLogin(kind, selId, pinId, listKey) {
  const sel = document.getElementById(selId);
  const errEl = document.getElementById('login-error');
  const val = normalizeCode(document.getElementById(pinId).value);
  if (!sel.value) { errEl.textContent = 'Select your name first.'; return; }
  DB = loadDB();
  const person = DB[listKey].find(x => x.id === sel.value);
  if (!person) { errEl.textContent = 'That name is no longer on file — refresh and try again.'; return; }
  if (!val) { errEl.textContent = 'Enter your access code.'; return; }
  if (normalizeCode(person.code) !== val) { errEl.textContent = `That code doesn't match ${person.name}.`; return; }
  errEl.textContent = '';
  CURRENT = person;
  enterApp();
}
function attemptAdminLogin() { attemptLogin('admin', 'admin-name-select', 'pin-admin', 'admins'); }
function attemptDriverLogin() { attemptLogin('driver', 'driver-name-select', 'pin-driver', 'drivers'); }
function attemptWorkerLogin() { attemptLogin('worker', 'worker-name-select', 'pin-worker', 'workers'); }

function applyRoleView() {
  const roleParam = (new URLSearchParams(window.location.search).get('role') || '').toLowerCase();
  const cols = { driver: 'login-col-driver', worker: 'login-col-worker', admin: 'login-col-admin' };
  if (cols[roleParam]) {
    Object.keys(cols).forEach(k => { if (k !== roleParam) document.getElementById(cols[k]).style.display = 'none'; });
    document.getElementById('login-cols').style.gridTemplateColumns = '1fr';
  }
}
refreshAdminNameOptions(); refreshDriverNameOptions(); refreshWorkerNameOptions(); applyRoleView();
document.getElementById('pin-driver').addEventListener('keydown', e => { if (e.key === 'Enter') attemptDriverLogin(); });
document.getElementById('pin-worker').addEventListener('keydown', e => { if (e.key === 'Enter') attemptWorkerLogin(); });
document.getElementById('pin-admin').addEventListener('keydown', e => { if (e.key === 'Enter') attemptAdminLogin(); });

function logout() {
  stopAlerts();
  CURRENT = null;
  ['pin-driver', 'pin-worker', 'pin-admin', 'admin-name-select', 'driver-name-select', 'worker-name-select'].forEach(id => { document.getElementById(id).value = ''; });
  refreshAdminNameOptions(); refreshDriverNameOptions(); refreshWorkerNameOptions();
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').style.display = 'flex';
}
function roleOf(p) {
  if (p.role === 'bishop' || p.role === 'manager') return p.role;
  if (DB.workers.find(w => w.id === p.id)) return 'worker';
  return 'driver';
}

/* ---------------- Nav ---------------- */
const ADMIN_TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'bookings', label: 'Bookings & Keys' }, { id: 'vehicles', label: 'Vehicles' },
  { id: 'drivers', label: 'Drivers' }, { id: 'faults', label: 'Faults' }, { id: 'slots', label: 'Key Slots' },
  { id: 'workers', label: 'Workers' }, { id: 'feedback', label: 'Feedback' }, { id: 'staffaccess', label: 'Staff Access' },
  { id: 'profile', label: 'My Profile' }
];
const WORKER_TABS = [
  { id: 'approvals', label: 'Approve Bookings' }, { id: 'drivers', label: 'Drivers' }, { id: 'penalties', label: 'Penalty System' },
  { id: 'callorder', label: 'Call to Order' }, { id: 'feedback', label: 'Feedback' }, { id: 'profile', label: 'My Profile' }
];
const DRIVER_TABS = [
  { id: 'myday', label: 'My Day' }, { id: 'reportfault', label: 'Report Fault' }, { id: 'feedback', label: 'Feedback' }, { id: 'profile', label: 'My Profile' }
];

function enterApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('active');
  const role = roleOf(CURRENT);
  document.getElementById('user-role').textContent = role === 'bishop' ? 'Bishop · Highest Authority' : cap(role);
  document.getElementById('user-name').textContent = CURRENT.name;
  document.getElementById('myday-title').textContent = 'My Day — Driver';
  const tabs = (role === 'bishop' || role === 'manager') ? ADMIN_TABS : role === 'worker' ? WORKER_TABS : DRIVER_TABS;
  document.getElementById('add-driver-btn').style.display = (role === 'bishop' || role === 'manager') ? 'inline-flex' : 'none';
  document.getElementById('nav-tabs').innerHTML = tabs.map((t, i) => `<button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}" onclick="showTab('${t.id}')">${t.label}</button>`).join('');
  showTab(tabs[0].id);
  startAlerts();
}
function showTab(tabId) {
  document.querySelectorAll('#nav-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('main .page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + tabId).classList.add('active');
  render[tabId] && render[tabId]();
}

/* ---------------- Helpers ---------------- */
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function findPerson(id) { return allPeople().find(p => p.id === id); }
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00') - today) / 86400000);
}
function licenseStatus(driver) {
  const d = daysUntil(driver.licenseExpiry);
  if (d === null) return { label: 'No date', cls: 'cancelled' };
  if (d < 0) return { label: 'Expired', cls: 'expired' };
  if (d <= 30) return { label: `Expires in ${d}d`, cls: 'expiring' };
  return { label: 'Valid', cls: 'active-status' };
}
const STATUS_LABELS = { pending: 'Requested', approved: 'Approved', active: 'Key Picked Up', done: 'Key Returned', rejected: 'Rejected', cancelled: 'Cancelled' };
function statusLabel(s) { return STATUS_LABELS[s] || cap(s); }
function vehicleLabel(v) { return v ? `${v.name}${v.carNumber ? ' #' + v.carNumber : ''} — ${v.plate}` : '—'; }
const render = {};

/* ================= OVERVIEW ================= */
render.overview = function () {
  DB = loadDB();
  const today = new Date().toISOString().slice(0, 10);
  const openFaults = DB.faults.filter(f => f.status === 'open');
  const clockedIn = DB.clocklog.filter(c => !c.clockOut);
  const lowFuel = DB.vehicles.filter(v => v.fuel <= 25);
  const expiredCount = DB.drivers.filter(d => { const x = daysUntil(d.licenseExpiry); return x !== null && x < 0; }).length;
  document.getElementById('overview-stats').innerHTML = `
    <div class="stat-card"><div class="num">${DB.bookings.filter(b => b.date === today).length}</div><div class="lbl">Bookings today</div></div>
    <div class="stat-card amber"><div class="num">${clockedIn.length}</div><div class="lbl">Keys out now</div></div>
    <div class="stat-card red"><div class="num">${openFaults.length}</div><div class="lbl">Open faults</div></div>
    <div class="stat-card green"><div class="num">${DB.vehicles.length}</div><div class="lbl">Vehicles</div></div>
    <div class="stat-card ${expiredCount ? 'red' : ''}"><div class="num">${expiredCount}</div><div class="lbl">Expired licenses</div></div>
    <div class="stat-card ${lowFuel.length ? 'amber' : ''}"><div class="num">${lowFuel.length}</div><div class="lbl">Low fuel${lowFuel.length ? ': ' + esc(lowFuel.map(v => v.name + (v.carNumber ? ' #' + v.carNumber : '')).join(', ')) : ''}</div></div>`;
  const flagged = DB.drivers.filter(d => { const x = daysUntil(d.licenseExpiry); return x !== null && x <= 30; });
  document.getElementById('overview-license-body').innerHTML = flagged.length ? flagged.map(d => {
    const st = licenseStatus(d);
    return `<tr><td>${esc(d.name)}</td><td>${d.licenseExpiry || '—'}</td><td><span class="badge ${st.cls}">${st.label}</span></td>
      <td>${st.cls === 'expired' && d.status !== 'suspended' ? `<button class="btn small danger" onclick="suspendDriver('${d.id}')">Suspend</button>` : (d.status === 'suspended' ? '<span class="badge suspended">Suspended</span>' : '—')}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No license alerts.</td></tr>`;
  document.getElementById('keys-out-body').innerHTML = clockedIn.length ? clockedIn.map(c => {
    const p = findPerson(c.staffId), slot = DB.slots.find(s => s.id === c.slotId), veh = DB.vehicles.find(v => v.id === c.vehicleId);
    return `<tr><td>${p ? esc(p.name) : '—'}</td><td>${slot ? esc(slot.label) : '—'}</td><td>${esc(vehicleLabel(veh))}</td><td>${fmtTime(c.clockIn)}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No keys currently out.</td></tr>`;
  document.getElementById('overview-faults-body').innerHTML = openFaults.length ? openFaults.map(f => {
    const p = findPerson(f.staffId);
    return `<tr><td>${p ? esc(p.name) : '—'}</td><td>${esc(f.vehicle)}</td><td>${esc(f.description)}</td><td><span class="badge open">Open</span></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No open faults.</td></tr>`;
};

/* ================= BOOKINGS & KEYS ================= */
function bookingRow(b, actions, withStatus) {
  const p = findPerson(b.staffId), slot = DB.slots.find(s => s.id === b.slotId), veh = DB.vehicles.find(v => v.id === b.vehicleId);
  return `<tr><td>${p ? esc(p.name) : '—'}</td><td>${slot ? esc(slot.label) : '(deleted)'}</td><td>${esc(vehicleLabel(veh))}</td><td>${b.date}</td>${withStatus ? `<td><span class="badge ${b.status}">${statusLabel(b.status)}</span></td>` : ''}${actions}</tr>`;
}
const approveBtns = id => `<td class="action-row"><button class="btn small amber" onclick="approveBooking('${id}')">Approve</button><button class="btn small danger" onclick="rejectBooking('${id}')">Reject</button></td>`;
render.bookings = function () {
  DB = loadDB();
  const pending = DB.bookings.filter(b => b.status === 'pending');
  document.getElementById('pending-bookings-body').innerHTML = pending.length ? pending.map(b => bookingRow(b, approveBtns(b.id))).join('') : `<tr class="empty-row"><td colspan="5">Nothing pending.</td></tr>`;
  const sorted = [...DB.bookings].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('all-bookings-body').innerHTML = sorted.length ? sorted.map(b =>
    bookingRow(b, `<td>${b.status === 'pending' || b.status === 'approved' ? `<button class="btn small danger" onclick="cancelBooking('${b.id}')">Cancel</button>` : ''}</td>`, true)).join('') : `<tr class="empty-row"><td colspan="6">No bookings yet.</td></tr>`;
};
render.approvals = function () {
  DB = loadDB();
  const pending = DB.bookings.filter(b => b.status === 'pending');
  document.getElementById('worker-pending-body').innerHTML = pending.length ? pending.map(b => bookingRow(b, approveBtns(b.id))).join('') : `<tr class="empty-row"><td colspan="5">Nothing pending.</td></tr>`;
};
function setBooking(id, status) {
  DB = loadDB(); const b = DB.bookings.find(x => x.id === id); if (b) b.status = status; saveDB(DB);
  render.bookings(); render.approvals();
}
function approveBooking(id) { setBooking(id, 'approved'); }
function rejectBooking(id) { setBooking(id, 'rejected'); }
function cancelBooking(id) { setBooking(id, 'cancelled'); }

/* ================= VEHICLES ================= */
let editingVehicleId = null;
function openVehicleForm(id) {
  DB = loadDB();
  const v = id ? DB.vehicles.find(x => x.id === id) : null;
  editingVehicleId = v ? v.id : null;
  document.getElementById('vehicle-form-title').textContent = v ? 'Edit vehicle' : 'Add vehicle';
  document.getElementById('veh-name').value = v ? v.name : '';
  document.getElementById('veh-carnumber').value = v ? (v.carNumber || '') : '';
  document.getElementById('veh-plate').value = v ? v.plate : '';
  document.getElementById('veh-fuel').value = v ? v.fuel : 100;
  document.getElementById('veh-mileage').value = v ? v.mileage : 0;
  document.getElementById('veh-condition').value = v ? v.condition : '';
  document.getElementById('vehicle-form-wrap').style.display = 'block';
}
function closeVehicleForm() { document.getElementById('vehicle-form-wrap').style.display = 'none'; }
function saveVehicle() {
  const name = document.getElementById('veh-name').value.trim();
  const carNumber = document.getElementById('veh-carnumber').value.trim();
  const plate = document.getElementById('veh-plate').value.trim();
  const fuel = Math.max(0, Math.min(100, parseInt(document.getElementById('veh-fuel').value) || 0));
  const mileage = parseInt(document.getElementById('veh-mileage').value) || 0;
  const condition = document.getElementById('veh-condition').value.trim();
  if (!name || !plate) { alert('Enter vehicle name and plate number.'); return; }
  DB = loadDB();
  if (editingVehicleId) Object.assign(DB.vehicles.find(x => x.id === editingVehicleId), { name, carNumber, plate, fuel, mileage, condition });
  else DB.vehicles.push({ id: nextId(DB), name, carNumber, plate, fuel, mileage, condition });
  saveDB(DB); closeVehicleForm(); render.vehicles();
}
function removeVehicle(id) { if (!confirm('Remove this vehicle?')) return; DB = loadDB(); DB.vehicles = DB.vehicles.filter(v => v.id !== id); saveDB(DB); render.vehicles(); }
render.vehicles = function () {
  DB = loadDB();
  document.getElementById('vehicles-grid').innerHTML = DB.vehicles.length ? DB.vehicles.map(v => `
    <div class="vehicle-card">
      <div class="vname">${esc(v.name)}${v.carNumber ? ' · <span style="color:var(--amber)">#' + esc(v.carNumber) + '</span>' : ''}</div><div class="vplate">${esc(v.plate)}</div>
      <div class="gauge-row"><span>Fuel${v.fuel <= 25 ? ' · <b style="color:var(--red)">Low</b>' : ''}</span><span>${v.fuel}%${v.fuelUpdated ? ' · updated ' + new Date(v.fuelUpdated).toLocaleDateString() : ''}</span></div>
      <div class="gauge-bar"><div class="gauge-fill" style="width:${v.fuel}%"></div></div>
      <div class="gauge-row"><span>Mileage</span><span>${v.mileage.toLocaleString()} km</span></div>
      <div class="vcond">${esc(v.condition) || 'No condition notes.'}</div>
      <div class="action-row" style="margin-top:12px;">
        <button class="btn small ghost" onclick="openVehicleForm('${v.id}')">Edit</button>
        <button class="btn small danger" onclick="removeVehicle('${v.id}')">Remove</button>
      </div></div>`).join('') : `<div class="empty-state">No vehicles added yet.</div>`;
};

/* ================= DRIVERS ================= */
let editingDriverId = null;
function openDriverForm(id) {
  DB = loadDB();
  const d = id ? DB.drivers.find(x => x.id === id) : null;
  editingDriverId = d ? d.id : null;
  document.getElementById('driver-form-title').textContent = d ? 'Edit driver' : 'Add driver';
  document.getElementById('drv-name').value = d ? d.name : '';
  document.getElementById('drv-email').value = d ? d.email : '';
  document.getElementById('drv-license').value = d ? d.licenseNumber : '';
  document.getElementById('drv-expiry').value = d ? d.licenseExpiry : '';
  document.getElementById('drv-code').value = d ? d.code : genCode();
  document.getElementById('driver-form-wrap').style.display = 'block';
}
function closeDriverForm() { document.getElementById('driver-form-wrap').style.display = 'none'; }
function saveDriver() {
  const name = document.getElementById('drv-name').value.trim();
  const email = document.getElementById('drv-email').value.trim();
  const licenseNumber = document.getElementById('drv-license').value.trim();
  const licenseExpiry = document.getElementById('drv-expiry').value;
  const code = normalizeCode(document.getElementById('drv-code').value) || genCode();
  if (!name) { alert('Enter the driver name.'); return; }
  DB = loadDB();
  const clash = allPeople().find(p => normalizeCode(p.code) === code && p.id !== editingDriverId);
  if (clash) { alert('That access code is already in use by ' + clash.name + '. Choose a different code.'); return; }
  if (editingDriverId) Object.assign(DB.drivers.find(x => x.id === editingDriverId), { name, email, licenseNumber, licenseExpiry, code });
  else DB.drivers.push({ id: nextId(DB), name, email, licenseNumber, licenseExpiry, role: 'driver', code, status: 'active' });
  saveDB(DB); closeDriverForm(); render.drivers(); refreshDriverNameOptions();
}
function removeDriver(id) { if (!confirm('Remove this driver? Their code will stop working.')) return; DB = loadDB(); DB.drivers = DB.drivers.filter(d => d.id !== id); saveDB(DB); render.drivers(); refreshDriverNameOptions(); }
function suspendDriver(id) {
  DB = loadDB(); const d = DB.drivers.find(x => x.id === id); if (d) d.status = d.status === 'suspended' ? 'active' : 'suspended';
  saveDB(DB); render.drivers();
  if (document.getElementById('page-overview').classList.contains('active')) render.overview();
}
render.drivers = function () {
  DB = loadDB();
  const role = roleOf(CURRENT), canEdit = role === 'bishop' || role === 'manager';
  document.getElementById('drivers-body').innerHTML = DB.drivers.length ? DB.drivers.map(d => {
    const st = licenseStatus(d);
    return `<tr><td>${esc(d.name)}</td><td>${esc(d.licenseNumber) || '—'}</td><td><span class="badge ${st.cls}">${st.label}</span></td>
      <td><span class="badge ${d.status === 'suspended' ? 'suspended' : 'active-status'}">${cap(d.status)}</span></td>
      <td>${canEdit ? `<span class="code-pill">${esc(d.code)}</span>` : '••••'}</td>
      <td class="action-row">
        <button class="btn small ${d.status === 'suspended' ? 'amber' : 'danger'}" onclick="suspendDriver('${d.id}')">${d.status === 'suspended' ? 'Reinstate' : 'Suspend'}</button>
        ${canEdit ? `<button class="btn small ghost" onclick="openDriverForm('${d.id}')">Edit</button><button class="btn small danger" onclick="removeDriver('${d.id}')">Remove</button>` : ''}
      </td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="6">No drivers added yet.</td></tr>`;
};

/* ================= FAULTS (admin) ================= */
function resolveFault(id) { DB = loadDB(); const f = DB.faults.find(x => x.id === id); if (f) f.status = 'resolved'; saveDB(DB); render.faults(); }
render.faults = function () {
  DB = loadDB();
  const sorted = [...DB.faults].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('faults-admin-body').innerHTML = sorted.length ? sorted.map(f => {
    const p = findPerson(f.staffId);
    return `<tr><td>${p ? esc(p.name) : '—'}</td><td>${esc(f.vehicle)}</td><td>${esc(f.description)}</td><td><span class="badge ${f.status}">${cap(f.status)}</span></td>
      <td>${f.status === 'open' ? `<button class="btn small amber" onclick="resolveFault('${f.id}')">Mark resolved</button>` : ''}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="5">No faults reported.</td></tr>`;
};

/* ================= KEY SLOTS ================= */
const PRESETS = {
  'sun-am': { start: '07:00', end: '15:00' }, 'sun-pm': { start: '17:00', end: '20:00' },
  'tue': { start: '17:00', end: '22:00' }, 'thu': { start: '17:00', end: '22:00' },
  'day': { start: '07:00', end: '15:00' }, 'evening': { start: '17:00', end: '22:00' }
};
function toggleSlotFields() {
  const type = document.getElementById('slot-type').value;
  document.getElementById('slot-recurring-fields').style.display = type === 'recurring' ? 'grid' : 'none';
  document.getElementById('slot-event-fields').style.display = type === 'event' ? 'grid' : 'none';
  applyPresetWindow();
}
function applyPresetWindow() {
  const type = document.getElementById('slot-type').value;
  const key = type === 'recurring' ? document.getElementById('slot-window').value : document.getElementById('slot-event-session').value;
  if (PRESETS[key]) { document.getElementById('slot-start').value = PRESETS[key].start; document.getElementById('slot-end').value = PRESETS[key].end; }
}
function refreshEventNameOptions() {
  DB = loadDB();
  const sel = document.getElementById('slot-event-name');
  sel.innerHTML = DB.eventNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('') + `<option value="__custom">+ Type a new event name…</option>`;
  sel.onchange = () => { document.getElementById('slot-event-name-custom').style.display = sel.value === '__custom' ? 'block' : 'none'; };
  sel.onchange();
}
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function sortedSlots() {
  const rank = s => s.type === 'recurring' ? WEEK.indexOf(s.day) : 100;
  return [...DB.slots].sort((a, b) => rank(a) - rank(b) || (a.eventDate || '').localeCompare(b.eventDate || '') || a.start.localeCompare(b.start));
}
function openSlotForm() {
  document.getElementById('slot-day').innerHTML = WEEK.map(d => `<option>${d}</option>`).join('');
  document.getElementById('slot-window').innerHTML =
    `<option value="sun-am">Day — 7:00am – 3:00pm</option><option value="evening">Evening — 5:00pm – 10:00pm</option>` +
    `<option value="sun-pm">Early evening — 5:00pm – 8:00pm</option><option value="custom">Custom time</option>`;
  document.getElementById('slot-form-wrap').style.display = 'block';
  document.getElementById('slot-type').value = 'recurring';
  refreshEventNameOptions();
  document.getElementById('slot-event-name-custom').value = '';
  document.getElementById('slot-event-date').value = '';
  toggleSlotFields();
}
function closeSlotForm() { document.getElementById('slot-form-wrap').style.display = 'none'; }
function saveSlot() {
  const type = document.getElementById('slot-type').value;
  const start = document.getElementById('slot-start').value, end = document.getElementById('slot-end').value;
  DB = loadDB();
  let label, day = null, eventName = null, eventDate = null;
  if (type === 'recurring') {
    day = document.getElementById('slot-day').value;
    label = `${day} ${start}–${end}`;
  } else {
    const sel = document.getElementById('slot-event-name').value;
    eventName = sel === '__custom' ? document.getElementById('slot-event-name-custom').value.trim() : sel;
    if (!eventName) { alert('Enter an event name.'); return; }
    eventDate = document.getElementById('slot-event-date').value;
    if (!eventDate) { alert('Choose the date for this event.'); return; }
    if (!DB.eventNames.includes(eventName)) DB.eventNames.push(eventName);
    label = `${eventName} (${eventDate}) — ${document.getElementById('slot-event-session').value === 'day' ? 'Day' : 'Evening'} ${start}–${end}`;
  }
  DB.slots.push({ id: nextId(DB), type, label, day, eventName, eventDate, start, end });
  saveDB(DB); closeSlotForm(); render.slots();
}
function deleteSlot(id) { DB = loadDB(); DB.slots = DB.slots.filter(s => s.id !== id); saveDB(DB); render.slots(); }
render.slots = function () {
  DB = loadDB();
  document.getElementById('slots-grid').innerHTML = DB.slots.length ? sortedSlots().map(s => {
    const n = DB.bookings.filter(b => b.slotId === s.id && (b.status === 'pending' || b.status === 'approved')).length;
    return `<div class="slot-card"><div class="slot-tag">${s.type === 'event' ? 'Event' : 'Recurring'}</div>
      <div class="slot-label">${esc(s.label)}</div><div class="slot-time">${s.start} – ${s.end}</div>
      <div class="slot-cap">${n} request${n === 1 ? '' : 's'} so far — unlimited bookings allowed</div>
      <button class="btn small danger" onclick="deleteSlot('${s.id}')">Delete</button></div>`;
  }).join('') : `<div class="empty-state">No key slots defined yet.</div>`;
};

/* ================= WORKERS PAGE (admin) ================= */
let editingWorkerId = null;
function openWorkerForm(id) {
  DB = loadDB();
  const w = id ? DB.workers.find(x => x.id === id) : null;
  editingWorkerId = w ? w.id : null;
  document.getElementById('worker-form-title').textContent = w ? 'Edit worker' : 'Add worker';
  document.getElementById('wrk-name').value = w ? w.name : '';
  document.getElementById('wrk-code').value = w ? w.code : genCode();
  document.getElementById('worker-form-wrap').style.display = 'block';
}
function closeWorkerForm() { document.getElementById('worker-form-wrap').style.display = 'none'; }
function saveWorker() {
  const name = document.getElementById('wrk-name').value.trim();
  const code = normalizeCode(document.getElementById('wrk-code').value) || genCode();
  if (!name) { alert('Enter a name.'); return; }
  DB = loadDB();
  const clash = allPeople().find(p => normalizeCode(p.code) === code && p.id !== editingWorkerId);
  if (clash) { alert('That access code is already in use by ' + clash.name + '. Choose a different code.'); return; }
  if (editingWorkerId) Object.assign(DB.workers.find(x => x.id === editingWorkerId), { name, code });
  else DB.workers.push({ id: nextId(DB), name, role: 'worker', code });
  saveDB(DB); closeWorkerForm(); render.workers(); refreshWorkerNameOptions();
}
function removeWorker(id) { if (!confirm('Remove this worker?')) return; DB = loadDB(); DB.workers = DB.workers.filter(w => w.id !== id); saveDB(DB); render.workers(); refreshWorkerNameOptions(); }
render.workers = function () {
  DB = loadDB();
  document.getElementById('workers-body').innerHTML = DB.workers.length ? DB.workers.map(w => `
    <tr><td>${esc(w.name)}</td><td><span class="code-pill">${esc(w.code)}</span></td>
    <td class="action-row"><button class="btn small ghost" onclick="openWorkerForm('${w.id}')">Edit</button>
    <button class="btn small danger" onclick="removeWorker('${w.id}')">Remove</button></td></tr>`).join('') : `<tr class="empty-row"><td colspan="3">No workers added yet.</td></tr>`;
};

/* ================= SHARED HELPERS ================= */
const todayStr = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function flash(id, text, cls) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = `<div class="msg ${cls || 'ok'}">${esc(text)}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 4000);
}
const driverOptions = () => DB.drivers.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');

/* ================= PENALTIES ================= */
function issuePenalty() {
  const driverId = document.getElementById('pen-driver').value;
  const points = parseInt(document.getElementById('pen-points').value) || 0;
  const reason = document.getElementById('pen-reason').value.trim();
  if (!driverId || points < 1 || !reason) { alert('Choose a driver, points and a reason.'); return; }
  DB = loadDB();
  DB.penalties.push({ id: nextId(DB), driverId, points, reason, type: 'Manual', status: 'active', issuedBy: CURRENT.id, date: todayStr() });
  saveDB(DB);
  document.getElementById('pen-reason').value = '';
  render.penalties();
}
function revokePenalty(id) {
  DB = loadDB(); const p = DB.penalties.find(x => x.id === id);
  if (p) p.status = p.status === 'active' ? 'revoked' : 'active';
  saveDB(DB); render.penalties();
}
render.penalties = function() {
  DB = loadDB();
  document.getElementById('pen-driver').innerHTML = driverOptions();
  const rows = [...DB.penalties].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('penalties-body').innerHTML = rows.length ? rows.map(p => {
    const d = findPerson(p.driverId), by = findPerson(p.issuedBy);
    return `<tr><td>${d ? esc(d.name) : '—'}</td><td>${p.points}</td><td>${esc(p.reason)}</td><td>${p.type}</td>
      <td><span class="badge ${p.status === 'active' ? 'open' : 'cancelled'}">${cap(p.status)}</span></td>
      <td>${by ? esc(by.name) : '—'}</td><td>${p.date}</td>
      <td><button class="btn small ghost" onclick="revokePenalty('${p.id}')">${p.status === 'active' ? 'Revoke' : 'Restore'}</button></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="8">No penalties logged.</td></tr>`;
};

/* ================= CALL TO ORDER ================= */
function issueCallToOrder() {
  const driverId = document.getElementById('co-driver').value;
  const note = document.getElementById('co-note').value.trim();
  if (!driverId || !note) { alert('Choose a driver and write a note.'); return; }
  DB = loadDB();
  DB.calltoorder.push({ id: nextId(DB), driverId, note, issuedBy: CURRENT.id, date: todayStr() });
  saveDB(DB); document.getElementById('co-note').value = ''; render.callorder();
}
render.callorder = function() {
  DB = loadDB();
  document.getElementById('co-driver').innerHTML = driverOptions();
  const rows = [...DB.calltoorder].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('callorder-body').innerHTML = rows.length ? rows.map(n => {
    const d = findPerson(n.driverId), by = findPerson(n.issuedBy);
    return `<tr><td>${d ? esc(d.name) : '—'}</td><td>${esc(n.note)}</td><td>${by ? esc(by.name) : '—'}</td><td>${n.date}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No notices issued.</td></tr>`;
};

/* ================= FEEDBACK ================= */
function submitFeedback() {
  const message = document.getElementById('fb-message').value.trim();
  if (!message) { alert('Write your feedback first.'); return; }
  DB = loadDB();
  DB.feedback.push({ id: nextId(DB), staffId: CURRENT.id, message, date: todayStr() });
  saveDB(DB); document.getElementById('fb-message').value = ''; render.feedback();
}
render.feedback = function() {
  DB = loadDB();
  const role = roleOf(CURRENT);
  const all = role === 'bishop' || role === 'manager';
  document.getElementById('feedback-list-title').textContent = all ? 'All feedback' : 'My feedback';
  const rows = DB.feedback.filter(f => all || f.staffId === CURRENT.id).sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('feedback-body').innerHTML = rows.length ? rows.map(f => {
    const p = findPerson(f.staffId);
    return `<tr><td>${p ? esc(p.name) : '—'}</td><td>${esc(f.message)}</td><td>${f.date}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="3">No feedback yet.</td></tr>`;
};

/* ================= DRIVER: REPORT FAULT ================= */
function submitFault() {
  const vehicle = document.getElementById('fault-vehicle').value.trim();
  const description = document.getElementById('fault-desc').value.trim();
  if (!vehicle || !description) { alert('Enter the vehicle and describe the issue.'); return; }
  DB = loadDB();
  DB.faults.push({ id: nextId(DB), staffId: CURRENT.id, vehicle, description, status: 'open', date: todayStr() });
  saveDB(DB);
  document.getElementById('fault-vehicle').value = ''; document.getElementById('fault-desc').value = '';
  render.reportfault();
}
render.reportfault = function() {
  DB = loadDB();
  const mine = DB.faults.filter(f => f.staffId === CURRENT.id);
  document.getElementById('my-faults-body').innerHTML = mine.length ? mine.map(f =>
    `<tr><td>${esc(f.vehicle)}</td><td>${esc(f.description)}</td><td><span class="badge ${f.status}">${cap(f.status)}</span></td></tr>`
  ).join('') : `<tr class="empty-row"><td colspan="3">No reports yet.</td></tr>`;
};

/* ================= DRIVER: MY DAY ================= */
let bookingSlotId = null;
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function driverBlocked() {
  if (CURRENT.status === 'suspended') return 'Your account is suspended. Please see the fleet office.';
  const d = daysUntil(CURRENT.licenseExpiry);
  if (d !== null && d < 0) return 'Your license has expired. You cannot book or collect keys.';
  return null;
}

function openBooking(slotId) {
  const block = driverBlocked(); if (block) { flash('myday-msg', block, 'err'); return; }
  DB = loadDB();
  const slot = DB.slots.find(s => s.id === slotId); if (!slot) return;
  bookingSlotId = slotId;
  document.getElementById('book-request-slotlabel').textContent = slot.label;
  const dateField = document.getElementById('book-date');
  dateField.value = slot.type === 'event' ? slot.eventDate : todayStr();
  dateField.disabled = slot.type === 'event';
  document.getElementById('book-vehicle').innerHTML = DB.vehicles.length
    ? DB.vehicles.map(v => `<option value="${v.id}">${esc(vehicleLabel(v))}</option>`).join('')
    : '<option value="">No vehicles available</option>';
  document.getElementById('book-request-wrap').style.display = 'block';
}
function closeBookingRequest() { document.getElementById('book-request-wrap').style.display = 'none'; bookingSlotId = null; }

function confirmBooking() {
  DB = loadDB();
  const slot = DB.slots.find(s => s.id === bookingSlotId);
  const date = document.getElementById('book-date').value;
  const vehicleId = document.getElementById('book-vehicle').value;
  if (!slot || !date || !vehicleId) { flash('myday-msg', 'Choose a date and vehicle.', 'err'); return; }
  if (date < todayStr()) { flash('myday-msg', 'You cannot book a past date.', 'err'); return; }
  if (slot.type === 'recurring' && DAYS[new Date(date + 'T00:00:00').getDay()] !== slot.day) {
    flash('myday-msg', `That slot is for ${slot.day}s. Pick a ${slot.day}.`, 'err'); return;
  }
  const dup = DB.bookings.find(b => b.staffId === CURRENT.id && b.slotId === slot.id && b.date === date && (b.status === 'pending' || b.status === 'approved'));
  if (dup) { flash('myday-msg', 'You already have a request for this slot and date.', 'warn'); return; }
  DB.bookings.push({ id: nextId(DB), staffId: CURRENT.id, slotId: slot.id, vehicleId, date, status: 'pending' });
  saveDB(DB); closeBookingRequest();
  flash('myday-msg', 'Request sent. Wait for approval.'); render.myday();
}

function cancelMyBooking(id) { cancelBooking(id); render.myday(); }

function pickUpKey(bookingId) {
  const block = driverBlocked(); if (block) { flash('myday-msg', block, 'err'); return; }
  DB = loadDB();
  const b = DB.bookings.find(x => x.id === bookingId);
  if (!b || b.status !== 'approved') return;
  if (b.date !== todayStr()) { flash('myday-msg', 'This booking is not for today.', 'warn'); return; }
  b.status = 'active';
  DB.clocklog.push({ id: nextId(DB), staffId: CURRENT.id, bookingId, slotId: b.slotId, vehicleId: b.vehicleId, clockIn: new Date().toISOString(), clockOut: null });
  saveDB(DB); render.myday();
}
let returningKey = false;
const FUEL_LEVELS = [['100', 'Full'], ['75', '¾ tank'], ['50', '½ tank'], ['25', '¼ tank'], ['5', 'Almost empty']];
const fuelName = pct => { const f = FUEL_LEVELS.find(x => +x[0] === +pct); return f ? f[1] : pct + '%'; };

function returnKey() { returningKey = true; render.myday(); }
function cancelReturn() { returningKey = false; render.myday(); }

function confirmReturn() {
  DB = loadDB();
  const c = DB.clocklog.find(x => x.staffId === CURRENT.id && !x.clockOut); if (!c) return;
  const veh = DB.vehicles.find(v => v.id === c.vehicleId);
  const fuel = parseInt(document.getElementById('ret-fuel').value);
  const odo = parseInt(document.getElementById('ret-odo').value);
  if (isNaN(odo)) { flash('myday-msg', 'Enter the odometer reading.', 'err'); return; }
  if (veh && odo < veh.mileage) { flash('myday-msg', `Odometer can't be lower than the last reading (${veh.mileage.toLocaleString()} km).`, 'err'); return; }
  const fuelBefore = veh ? veh.fuel : null, odoBefore = veh ? veh.mileage : null;
  c.clockOut = new Date().toISOString();
  c.fuelAfter = fuel; c.odoAfter = odo;
  const b = DB.bookings.find(x => x.id === c.bookingId); if (b) b.status = 'done';
  if (veh) { veh.fuel = fuel; veh.mileage = odo; veh.fuelUpdated = c.clockOut; }
  DB.fuellog.push({ id: nextId(DB), vehicleId: c.vehicleId, staffId: CURRENT.id, date: c.clockOut, fuelBefore, fuelAfter: fuel, odoBefore, odoAfter: odo, km: odoBefore == null ? null : odo - odoBefore });
  saveDB(DB); returningKey = false;
  flash('myday-msg', 'Key returned. Fuel and mileage updated.'); render.myday();
}

render.myday = function() {
  DB = loadDB();
  const active = DB.clocklog.find(c => c.staffId === CURRENT.id && !c.clockOut);
  const approvedToday = DB.bookings.filter(b => b.staffId === CURRENT.id && b.status === 'approved' && b.date === todayStr());
  const panel = document.getElementById('clock-panel');
  if (active) {
    const veh = DB.vehicles.find(v => v.id === active.vehicleId);
    if (returningKey) {
      panel.innerHTML = `<h3>Return key</h3><p style="margin-bottom:16px;color:var(--muted)">${esc(vehicleLabel(veh))} — check the dashboard before you hand it back.</p>
        <div class="form-grid">
          <div class="field"><label>Fuel gauge reads</label><select id="ret-fuel">${FUEL_LEVELS.map(f => `<option value="${f[0]}">${f[1]}</option>`).join('')}</select></div>
          <div class="field"><label>Odometer (km)</label><input id="ret-odo" type="number" min="0" value="${veh ? veh.mileage : 0}"></div>
        </div>
        <div class="action-row"><button class="btn amber" onclick="confirmReturn()">Confirm return</button><button class="btn ghost" onclick="cancelReturn()">Cancel</button></div>`;
    } else {
      panel.innerHTML = `<h3>Key in your hands</h3><p style="margin-bottom:14px">${esc(vehicleLabel(veh))} — since ${fmtTime(active.clockIn)}${veh ? ' · fuel was ' + fuelName(veh.fuel) : ''}</p>
        <button class="btn amber" onclick="returnKey()">Return key</button>`;
    }
  } else if (approvedToday.length) {
    panel.innerHTML = `<h3>Ready for pick-up</h3>` + approvedToday.map(b => {
      const slot = DB.slots.find(s => s.id === b.slotId), veh = DB.vehicles.find(v => v.id === b.vehicleId);
      return `<div class="action-row" style="margin-bottom:10px;align-items:center"><span>${slot ? esc(slot.label) : '—'} · ${esc(vehicleLabel(veh))}</span>
        <button class="btn small amber" onclick="pickUpKey('${b.id}')">Pick up key</button></div>`;
    }).join('');
  } else panel.innerHTML = `<h3>Key status</h3><p style="color:var(--paper-dim)">No approved booking for today.</p>`;

  document.getElementById('book-slots-grid').innerHTML = DB.slots.length ? sortedSlots().map(s => `
    <div class="slot-card"><div class="slot-tag">${s.type === 'event' ? 'Event' : 'Recurring'}</div>
    <div class="slot-label">${esc(s.label)}</div><div class="slot-time">${s.start} – ${s.end}</div>
    <button class="btn small amber" onclick="openBooking('${s.id}')">Request</button></div>`).join('')
    : `<div class="empty-state">No key slots available yet.</div>`;

  const mine = DB.bookings.filter(b => b.staffId === CURRENT.id).sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('my-bookings-body').innerHTML = mine.length ? mine.map(b => {
    const slot = DB.slots.find(s => s.id === b.slotId), veh = DB.vehicles.find(v => v.id === b.vehicleId);
    return `<tr><td>${slot ? esc(slot.label) : '(deleted)'}</td><td>${esc(vehicleLabel(veh))}</td><td>${b.date}</td>
      <td><span class="badge ${b.status}">${statusLabel(b.status)}</span></td>
      <td>${b.status === 'pending' || b.status === 'approved' ? `<button class="btn small danger" onclick="cancelMyBooking('${b.id}')">Cancel</button>` : ''}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="5">No bookings yet.</td></tr>`;
};

/* ================= MY PROFILE (all roles) ================= */
function changeMyCode() {
  const code = normalizeCode(document.getElementById('my-new-code').value);
  if (!/^\d{4,}$/.test(code)) { flash('my-code-msg', 'Use at least 4 digits.', 'err'); return; }
  DB = loadDB();
  const clash = allPeople().find(p => normalizeCode(p.code) === code && p.id !== CURRENT.id);
  if (clash) { flash('my-code-msg', 'That code is already in use. Choose another.', 'err'); return; }
  const me = findPerson(CURRENT.id); me.code = code; CURRENT = me;
  saveDB(DB); document.getElementById('my-new-code').value = '';
  flash('my-code-msg', 'Access code updated.');
}
render.profile = function() {
  DB = loadDB();
  const role = roleOf(CURRENT);
  const fields = [['Name', CURRENT.name], ['Role', ROLE_LABELS[role]]];
  if (role === 'driver') fields.push(['License', CURRENT.licenseNumber || '—'], ['Expiry', CURRENT.licenseExpiry || '—'], ['Status', cap(CURRENT.status || 'active')]);
  document.getElementById('profile-card').innerHTML = fields.map(([l, v]) => `<div class="profile-field"><label>${l}</label><div>${esc(v)}</div></div>`).join('');
  const isDriver = role === 'driver';
  document.getElementById('profile-penalties-panel').style.display = isDriver ? 'block' : 'none';
  document.getElementById('profile-notices-panel').style.display = isDriver ? 'block' : 'none';
  if (!isDriver) return;
  const pens = DB.penalties.filter(p => p.driverId === CURRENT.id && p.status === 'active');
  document.getElementById('my-penalties-body').innerHTML = pens.length ? pens.map(p => `<tr><td>${p.points}</td><td>${esc(p.reason)}</td><td>${p.date}</td></tr>`).join('')
    : `<tr class="empty-row"><td colspan="3">No penalties.</td></tr>`;
  const notes = DB.calltoorder.filter(n => n.driverId === CURRENT.id);
  document.getElementById('my-notices-body').innerHTML = notes.length ? notes.map(n => `<tr><td>${esc(n.note)}</td><td>${n.date}</td></tr>`).join('')
    : `<tr class="empty-row"><td colspan="2">No notices.</td></tr>`;
};

/* ================= STAFF ACCESS (all rows editable) ================= */
var saEditingId = null;

function saEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function saMyRole() { return (CURRENT.role === 'bishop' || CURRENT.role === 'manager') ? CURRENT.role : 'worker'; }
function saCanManage(role) { return saMyRole() === 'bishop' || saMyRole() === 'manager'; }
function saAll() { return DB.admins.concat(DB.workers); }
function saRoleOptions(sel) {
  var roles = ['bishop', 'manager', 'worker'];
  return roles.map(function (r) { return '<option value="' + r + '"' + (r === sel ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>'; }).join('');
}
function saMsg(text, cls) {
  var page = document.getElementById('page-staffaccess');
  var el = document.getElementById('sa-msg');
  if (!el) { el = document.createElement('div'); el.id = 'sa-msg'; page.insertBefore(el, page.children[1]); }
  el.innerHTML = '<div class="msg ' + (cls || 'ok') + '">' + saEsc(text) + '</div>';
  setTimeout(function () { el.innerHTML = ''; }, 3500);
}

/* Core: add (id = null) or update a person. Returns true on success. */
function applyStaffChange(id, name, role, code) {
  name = (name || '').trim();
  code = normalizeCode(code) || genCode();
  if (!name) { saMsg('Enter a name.', 'err'); return false; }
  if (!saCanManage(role)) { saMsg('You are not allowed to manage that role.', 'err'); return false; }
  if (id && CURRENT && id === CURRENT.id && role !== CURRENT.role) { saMsg("You can't change your own role.", 'err'); return false; }
  DB = loadDB();
  var clash = allPeople().filter(function (p) { return normalizeCode(p.code) === code && p.id !== id; })[0];
  if (clash) { saMsg('That access code is already used by ' + clash.name + '.', 'err'); return false; }
  if (id) {
    var old = saAll().filter(function (x) { return x.id === id; })[0];
    if (!old || !saCanManage(old.role)) return false;
    if (old.role === 'bishop' && role !== 'bishop' && DB.admins.filter(function (x) { return x.role === 'bishop'; }).length <= 1) {
      saMsg('There must be at least one Bishop.', 'err'); return false;
    }
    DB.admins = DB.admins.filter(function (x) { return x.id !== id; });
    DB.workers = DB.workers.filter(function (x) { return x.id !== id; });
  } else id = nextId(DB);
  var rec = { id: id, name: name, role: role, code: code };
  (role === 'worker' ? DB.workers : DB.admins).push(rec);
  saveDB(DB);
  if (CURRENT && CURRENT.id === id) { CURRENT = rec; document.getElementById('user-name').textContent = name; }
  refreshAdminNameOptions(); refreshWorkerNameOptions();
  return true;
}

/* Per-row Save */
function saveRow(id) {
  var ok = applyStaffChange(id,
    document.getElementById('sa-name-' + id).value,
    document.getElementById('sa-role-' + id).value,
    document.getElementById('sa-code-' + id).value);
  if (ok) { render.staffaccess(); saMsg('Saved.'); }
}

/* Remove */
function removeAdmin(id) {
  DB = loadDB();
  var p = saAll().filter(function (x) { return x.id === id; })[0];
  if (!p || !saCanManage(p.role)) return;
  if (p.id === CURRENT.id) { saMsg("You can't remove your own account while logged in.", 'err'); return; }
  if (p.role === 'bishop' && DB.admins.filter(function (x) { return x.role === 'bishop'; }).length <= 1) { saMsg('There must be at least one Bishop.', 'err'); return; }
  if (!confirm('Remove ' + p.name + '? Their access code will stop working.')) return;
  DB.admins = DB.admins.filter(function (x) { return x.id !== id; });
  DB.workers = DB.workers.filter(function (x) { return x.id !== id; });
  saveDB(DB); render.staffaccess();
  refreshAdminNameOptions(); refreshWorkerNameOptions();
  saMsg('Removed.');
}

/* Add form (top of page) */
function openAdminForm() {
  saEditingId = null;
  document.getElementById('admin-form-title').textContent = 'Add staff member';
  document.getElementById('adm-name').value = '';
  document.getElementById('adm-role').innerHTML = saRoleOptions(saMyRole() === 'bishop' ? 'bishop' : 'worker');
  document.getElementById('adm-code').value = genCode();
  document.getElementById('admin-form-wrap').style.display = 'block';
}
function closeAdminForm() { document.getElementById('admin-form-wrap').style.display = 'none'; }
function saveAdmin() {
  var ok = applyStaffChange(null, document.getElementById('adm-name').value, document.getElementById('adm-role').value, document.getElementById('adm-code').value);
  if (ok) { closeAdminForm(); render.staffaccess(); saMsg('Staff member added.'); }
}

/* Render: every manageable row is always editable */
render.staffaccess = function () {
  DB = loadDB();
  var addBtn = document.getElementById('add-admin-btn');
  addBtn.style.display = 'inline-flex'; addBtn.textContent = '+ Add staff';
  document.querySelector('#page-staffaccess .page-head p').textContent = 'Bishops, managers and workers — edit any row and click Save';
  var rows = DB.admins.concat(DB.workers);
  document.getElementById('staffaccess-body').innerHTML = rows.map(function (p) {
    var you = p.id === CURRENT.id ? ' <span class="badge approved">You</span>' : '';
    if (!saCanManage(p.role)) {
      return '<tr><td>' + saEsc(p.name) + you + '</td><td>' + ROLE_LABELS[p.role] + '</td><td>••••</td><td>—</td></tr>';
    }
    return '<tr>' +
      '<td><input id="sa-name-' + p.id + '" class="cell-input" value="' + saEsc(p.name) + '"></td>' +
      '<td><select id="sa-role-' + p.id + '" class="cell-input">' + saRoleOptions(p.role) + '</select></td>' +
      '<td><input id="sa-code-' + p.id + '" class="cell-input code" value="' + saEsc(p.code) + '" inputmode="numeric"></td>' +
      '<td class="action-row"><button class="btn small amber" onclick="saveRow(\'' + p.id + '\')">Save</button>' +
      '<button class="btn small danger" onclick="removeAdmin(\'' + p.id + '\')">Remove</button>' + you + '</td></tr>';
  }).join('');
};


/* ================= BOOKING ALERTS (badge + sound + pop-up) =================
   Admins, managers and workers get:
   - a red count on "Bookings & Keys" / "Approve Bookings"
   - a pop-up naming the driver, and a two-tone chime
   - the count in the browser tab title, e.g. "(2) Fleet Operations"
   Works while the page is open in the SAME browser (other tabs/windows too).
   Drivers on other phones can't reach this device's data until a shared backend exists. */
var alertTimer = null, knownPending = null, BASE_TITLE = document.title;

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1175, .16]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + .02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + .35);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .4);
    });
  } catch (e) {}
}

function toast(text) {
  let box = document.getElementById('toast-box');
  if (!box) { box = document.createElement('div'); box.id = 'toast-box'; document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
  t.onclick = () => t.remove(); box.appendChild(t);
  setTimeout(() => t.remove(), 8000);
}

function checkAlerts() {
  if (!CURRENT) return;
  const role = roleOf(CURRENT);
  if (role === 'driver') return;
  DB = loadDB();
  const pending = DB.bookings.filter(b => b.status === 'pending');
  const ids = new Set(pending.map(b => b.id));
  if (knownPending) {
    const fresh = pending.filter(b => !knownPending.has(b.id));
    if (fresh.length) {
      chime();
      fresh.forEach(b => { const d = findPerson(b.staffId); const sl = DB.slots.find(x => x.id === b.slotId);
        toast(`New booking: ${d ? d.name : 'A driver'} — ${sl ? sl.label : ''} (${b.date})`); });
      const active = document.querySelector('main .page.active');
      if (active && ['page-bookings', 'page-approvals', 'page-overview'].includes(active.id)) render[active.id.replace('page-', '')]();
    }
  }
  knownPending = ids;
  document.querySelectorAll('#nav-tabs .nav-badge').forEach(n => n.remove());
  document.querySelectorAll('#nav-tabs button[data-tab="bookings"], #nav-tabs button[data-tab="approvals"]').forEach(btn => {
    if (pending.length) { const b = document.createElement('span'); b.className = 'nav-badge'; b.textContent = pending.length; btn.appendChild(b); }
  });
  document.title = (pending.length ? `(${pending.length}) ` : '') + BASE_TITLE;
}
function startAlerts() { stopAlerts(); knownPending = null; checkAlerts(); alertTimer = setInterval(checkAlerts, 4000); }
function stopAlerts() { if (alertTimer) clearInterval(alertTimer); alertTimer = null; knownPending = null; document.title = BASE_TITLE; }
window.addEventListener('storage', e => { if (e.key === DB_KEY) checkAlerts(); });