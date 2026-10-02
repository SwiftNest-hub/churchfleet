/* ---------------- Storage (with fallback if localStorage is blocked) ---------------- */
const DB_KEY = 'fleetops_db_v4';
let STORAGE_OK = true;
let MEMORY_STORE = {};

function storageGet(key) {
  try { return localStorage.getItem(key); } catch(e) { STORAGE_OK = false; return (key in MEMORY_STORE) ? MEMORY_STORE[key] : null; }
}

function storageSet(key, val) {
  try { localStorage.setItem(key, val); } catch(e) { STORAGE_OK = false; MEMORY_STORE[key] = val; }
}

function defaultDB() {
  return {
    admins: [
      {id: 'a1', name: 'Bishop One', role: 'bishop', code: '2000'},
      {id: 'a2', name: 'Bishop Two', role: 'bishop', code: '3000'},
      {id: 'a3', name: 'Bishop Three', role: 'bishop', code: '4000'},
      {id: 'a4', name: 'Fleet Manager', role: 'manager', code: '1000'}
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

function loadDB() {
  let raw = storageGet(DB_KEY);
  if (!raw) { const db = defaultDB(); storageSet(DB_KEY, JSON.stringify(db)); return db; }
  let db;
  try { db = JSON.parse(raw); } catch(e) { db = defaultDB(); storageSet(DB_KEY, JSON.stringify(db)); return db; }
  // Migrate missing arrays for safety
  Object.keys(defaultDB()).forEach(k => { if (db[k] === undefined) db[k] = Array.isArray(defaultDB()[k]) ? [] : defaultDB()[k]; });
  return db;
}

function saveDB(db) { storageSet(DB_KEY, JSON.stringify(db)); }

function resetSystemData() {
  if (!confirm('This clears ALL Fleet Operations data on this device (staff, bookings, vehicles) and restores the original Bishop/Manager codes. Continue?')) return;
  try { localStorage.removeItem(DB_KEY); } catch(e) {}
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

function refreshAdminNameOptions() {
  DB = loadDB();
  const sel = document.getElementById('admin-name-select');
  if (!sel) return;
  sel.innerHTML = `<option value="">Select your name…</option>` +
    DB.admins.map(a => `<option value="${a.id}">${a.name} (${a.role === 'bishop' ? 'Bishop' : 'Manager'})</option>`).join('');
}

function refreshDriverNameOptions() {
  DB = loadDB();
  const sel = document.getElementById('driver-name-select');
  if (!sel) return;
  sel.innerHTML = `<option value="">Select your name…</option>` +
    DB.drivers.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
}

function refreshWorkerNameOptions() {
  DB = loadDB();
  const sel = document.getElementById('worker-name-select');
  if (!sel) return;
  sel.innerHTML = `<option value="">Select your name…</option>` +
    DB.workers.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
}

function attemptAdminLogin() {
  const sel = document.getElementById('admin-name-select');
  const errEl = document.getElementById('login-error');
  const val = normalizeCode(document.getElementById('pin-admin').value);
  if (!sel.value) { errEl.textContent = 'Select your name first.'; return; }
  DB = loadDB();
  const person = DB.admins.find(a => a.id === sel.value);
  if (!person) { errEl.textContent = 'That name is no longer on file — refresh and try again.'; return; }
  if (!val) { errEl.textContent = 'Enter your access code.'; return; }
  if (normalizeCode(person.code) !== val) { errEl.textContent = `That code doesn't match ${person.name}.`; return; }
  errEl.textContent = '';
  CURRENT = person;
  enterApp();
}

function attemptDriverLogin() {
  const sel = document.getElementById('driver-name-select');
  const errEl = document.getElementById('login-error');
  const val = normalizeCode(document.getElementById('pin-driver').value);
  if (!sel.value) { errEl.textContent = 'Select your name first.'; return; }
  DB = loadDB();
  const person = DB.drivers.find(d => d.id === sel.value);
  if (!person) { errEl.textContent = 'That name is no longer on file — refresh and try again.'; return; }
  if (!val) { errEl.textContent = 'Enter your access code.'; return; }
  if (normalizeCode(person.code) !== val) { errEl.textContent = `That code doesn't match ${person.name}.`; return; }
  errEl.textContent = '';
  CURRENT = person;
  enterApp();
}

function attemptWorkerLogin() {
  const sel = document.getElementById('worker-name-select');
  const errEl = document.getElementById('login-error');
  const val = normalizeCode(document.getElementById('pin-worker').value);
  if (!sel.value) { errEl.textContent = 'Select your name first.'; return; }
  DB = loadDB();
  const person = DB.workers.find(w => w.id === sel.value);
  if (!person) { errEl.textContent = 'That name is no longer on file — refresh and try again.'; return; }
  if (!val) { errEl.textContent = 'Enter your access code.'; return; }
  if (normalizeCode(person.code) !== val) { errEl.textContent = `That code doesn't match ${person.name}.`; return; }
  errEl.textContent = '';
  CURRENT = person;
  enterApp();
}

function applyRoleView() {
  const params = new URLSearchParams(window.location.search);
  const roleParam = (params.get('role') || '').toLowerCase();
  const cols = { driver: document.getElementById('login-col-driver'), worker: document.getElementById('login-col-worker'), admin: document.getElementById('login-col-admin') };
  if (roleParam === 'driver' || roleParam === 'worker' || roleParam === 'admin') {
    Object.keys(cols).forEach(k => { if (k !== roleParam) cols[k].style.display = 'none'; });
    document.getElementById('login-cols').style.gridTemplateColumns = '1fr';
    document.getElementById('login-cols-wrap').classList.remove('login-card-wide');
  }
}

refreshAdminNameOptions();
refreshDriverNameOptions();
refreshWorkerNameOptions();
applyRoleView();

document.getElementById('pin-driver').addEventListener('keydown', e => { if (e.key === 'Enter') attemptDriverLogin(); });
document.getElementById('pin-worker').addEventListener('keydown', e => { if (e.key === 'Enter') attemptWorkerLogin(); });
document.getElementById('pin-admin').addEventListener('keydown', e => { if (e.key === 'Enter') attemptAdminLogin(); });

function logout() {
  CURRENT = null;
  document.getElementById('pin-driver').value = '';
  document.getElementById('pin-worker').value = '';
  document.getElementById('pin-admin').value = '';
  document.getElementById('admin-name-select').value = '';
  document.getElementById('driver-name-select').value = '';
  document.getElementById('worker-name-select').value = '';
  refreshAdminNameOptions();
  refreshDriverNameOptions();
  refreshWorkerNameOptions();
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
  { id: 'overview', label: 'Overview' },
  { id: 'bookings', label: 'Bookings & Keys' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'faults', label: 'Faults' },
  { id: 'slots', label: 'Key Slots' },
  { id: 'workers', label: 'Workers' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'staffaccess', label: 'Staff Access' },
  { id: 'profile', label: 'My Profile' }
];

const WORKER_TABS = [
  { id: 'approvals', label: 'Approve Bookings' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'penalties', label: 'Penalty System' },
  { id: 'callorder', label: 'Call to Order' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'profile', label: 'My Profile' }
];

const DRIVER_TABS = [
  { id: 'myday', label: 'My Day' },
  { id: 'reportfault', label: 'Report Fault' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'profile', label: 'My Profile' }
];

function enterApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('active');
  const role = roleOf(CURRENT);
  document.getElementById('user-role').textContent = role === 'bishop' ? 'Bishop · Highest Authority' : cap(role);
  document.getElementById('user-name').textContent = CURRENT.name;
  document.getElementById('myday-title').textContent = 'My Day — Driver';

  let tabs;
  if (role === 'bishop' || role === 'manager') tabs = ADMIN_TABS;
  else if (role === 'worker') tabs = WORKER_TABS;
  else tabs = DRIVER_TABS;

  document.getElementById('add-admin-btn').style.display = role === 'bishop' ? 'inline-block' : 'none';
  document.getElementById('add-driver-btn').style.display = (role === 'bishop' || role === 'manager') ? 'inline-block' : 'none';

  const nav = document.getElementById('nav-tabs');
  nav.innerHTML = tabs.map((t, i) => `<button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}" onclick="showTab('${t.id}')">${t.label}</button>`).join('');
  showTab(tabs[0].id);
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
  const exp = new Date(dateStr + 'T00:00:00');
  return Math.round((exp - today) / 86400000);
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
render.overview = function() {
  DB = loadDB();
  const today = new Date().toISOString().slice(0, 10);
  const bookingsToday = DB.bookings.filter(b => b.date === today);
  const openFaults = DB.faults.filter(f => f.status === 'open');
  const clockedIn = DB.clocklog.filter(c => !c.clockOut);
  const expiredCount = DB.drivers.filter(d => daysUntil(d.licenseExpiry) !== null && daysUntil(d.licenseExpiry) < 0).length;

  document.getElementById('overview-stats').innerHTML = `
    <div class="stat-card"><div class="num">${bookingsToday.length}</div><div class="lbl">Bookings today</div></div>
    <div class="stat-card amber"><div class="num">${clockedIn.length}</div><div class="lbl">Keys out now</div></div>
    <div class="stat-card red"><div class="num">${openFaults.length}</div><div class="lbl">Open faults</div></div>
    <div class="stat-card green"><div class="num">${DB.vehicles.length}</div><div class="lbl">Vehicles</div></div>
    <div class="stat-card ${expiredCount ? 'red' : ''}"><div class="num">${expiredCount}</div><div class="lbl">Expired licenses</div></div>
  `;

  const licBody = document.getElementById('overview-license-body');
  const flagged = DB.drivers.filter(d => { const dd = daysUntil(d.licenseExpiry); return dd !== null && dd <= 30; });
  licBody.innerHTML = flagged.length ? flagged.map(d => {
    const st = licenseStatus(d);
    return `<tr><td>${d.name}</td><td>${d.licenseExpiry || '—'}</td><td><span class="badge ${st.cls}">${st.label}</span></td>
      <td>${st.cls === 'expired' && d.status !== 'suspended' ? `<button class="btn small danger" onclick="suspendDriver('${d.id}')">Suspend</button>` : (d.status === 'suspended' ? '<span class="badge suspended">Suspended</span>' : '—')}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No license alerts.</td></tr>`;

  const keysBody = document.getElementById('keys-out-body');
  keysBody.innerHTML = clockedIn.length ? clockedIn.map(c => {
    const p = findPerson(c.staffId); const slot = DB.slots.find(s => s.id === c.slotId);
    const veh = DB.vehicles.find(v => v.id === c.vehicleId);
    return `<tr><td>${p ? p.name : '—'}</td><td>${slot ? slot.label : '—'}</td><td>${vehicleLabel(veh)}</td><td>${fmtTime(c.clockIn)}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No keys currently out.</td></tr>`;

  const faultsBody = document.getElementById('overview-faults-body');
  faultsBody.innerHTML = openFaults.length ? openFaults.map(f => {
    const p = findPerson(f.staffId);
    return `<tr><td>${p ? p.name : '—'}</td><td>${f.vehicle}</td><td>${f.description}</td><td><span class="badge open">Open</span></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No open faults.</td></tr>`;
};

/* ================= BOOKINGS & KEYS (admin) ================= */
render.bookings = function() {
  DB = loadDB();
  const pending = DB.bookings.filter(b => b.status === 'pending');
  document.getElementById('pending-bookings-body').innerHTML = pending.length ? pending.map(b => {
    const p = findPerson(b.staffId); const slot = DB.slots.find(s => s.id === b.slotId);
    const veh = DB.vehicles.find(v => v.id === b.vehicleId);
    return `<tr><td>${p ? p.name : '—'}</td><td>${slot ? slot.label : '(deleted)'}</td><td>${vehicleLabel(veh)}</td><td>${b.date}</td>
      <td class="action-row"><button class="btn small amber" onclick="approveBooking('${b.id}')">Approve</button>
      <button class="btn small danger" onclick="rejectBooking('${b.id}')">Reject</button></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="5">Nothing pending.</td></tr>`;

  const sorted = [...DB.bookings].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('all-bookings-body').innerHTML = sorted.length ? sorted.map(b => {
    const p = findPerson(b.staffId); const slot = DB.slots.find(s => s.id === b.slotId);
    const veh = DB.vehicles.find(v => v.id === b.vehicleId);
    return `<tr><td>${p ? p.name : '—'}</td><td>${slot ? slot.label : '(deleted)'}</td><td>${vehicleLabel(veh)}</td><td>${b.date}</td>
      <td><span class="badge ${b.status}">${statusLabel(b.status)}</span></td>
      <td>${b.status === 'pending' || b.status === 'approved' ? `<button class="btn small danger" onclick="cancelBooking('${b.id}')">Cancel</button>` : ''}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="6">No bookings yet.</td></tr>`;
};

function approveBooking(id) { DB = loadDB(); const b = DB.bookings.find(x => x.id === id); if (b) b.status = 'approved'; saveDB(DB); render.bookings && render.bookings(); render.approvals && render.approvals(); }
function rejectBooking(id) { DB = loadDB(); const b = DB.bookings.find(x => x.id === id); if (b) b.status = 'rejected'; saveDB(DB); render.bookings && render.bookings(); render.approvals && render.approvals(); }
function cancelBooking(id) { DB = loadDB(); const b = DB.bookings.find(x => x.id === id); if (b) b.status = 'cancelled'; saveDB(DB); render.bookings && render.bookings(); }

/* Worker approvals page */
render.approvals = function() {
  DB = loadDB();
  const pending = DB.bookings.filter(b => b.status === 'pending');
  document.getElementById('worker-pending-body').innerHTML = pending.length ? pending.map(b => {
    const p = findPerson(b.staffId); const slot = DB.slots.find(s => s.id === b.slotId);
    const veh = DB.vehicles.find(v => v.id === b.vehicleId);
    return `<tr><td>${p ? p.name : '—'}</td><td>${slot ? slot.label : '(deleted)'}</td><td>${vehicleLabel(veh)}</td><td>${b.date}</td>
      <td class="action-row"><button class="btn small amber" onclick="approveBooking('${b.id}')">Approve</button>
      <button class="btn small danger" onclick="rejectBooking('${b.id}')">Reject</button></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="5">Nothing pending.</td></tr>`;
};

/* ================= VEHICLES ================= */
let editingVehicleId = null;

function openVehicleForm(v) {
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
  if (editingVehicleId) {
    const v = DB.vehicles.find(x => x.id === editingVehicleId);
    Object.assign(v, { name, carNumber, plate, fuel, mileage, condition });
  } else {
    DB.vehicles.push({ id: nextId(DB), name, carNumber, plate, fuel, mileage, condition });
  }
  saveDB(DB); closeVehicleForm(); render.vehicles();
}

function removeVehicle(id) { if (!confirm('Remove this vehicle?')) return; DB = loadDB(); DB.vehicles = DB.vehicles.filter(v => v.id !== id); saveDB(DB); render.vehicles(); }

render.vehicles = function() {
  DB = loadDB();
  const grid = document.getElementById('vehicles-grid');
  grid.innerHTML = DB.vehicles.length ? DB.vehicles.map(v => `
    <div class="vehicle-card">
      <div class="vname">${v.name}${v.carNumber ? ' · <span style="color:var(--amber)">#' + v.carNumber + '</span>' : ''}</div><div class="vplate">${v.plate}</div>
      <div class="gauge-row"><span>Fuel</span><span>${v.fuel}%</span></div>
      <div class="gauge-bar"><div class="gauge-fill" style="width:${v.fuel}%"></div></div>
      <div class="gauge-row"><span>Mileage</span><span>${v.mileage.toLocaleString()} km</span></div>
      <div class="vcond">${v.condition || 'No condition notes.'}</div>
      <div class="action-row" style="margin-top:12px;">
        <button class="btn small ghost" onclick='openVehicleForm(${JSON.stringify(v).replace(/'/g, "&apos;")})'>Edit</button>
        <button class="btn small danger" onclick="removeVehicle('${v.id}')">Remove</button>
      </div>
    </div>`).join('') : `<div class="empty-state">No vehicles added yet.</div>`;
};

/* ================= DRIVERS ================= */
let editingDriverId = null;

function openDriverForm(d) {
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
  if (editingDriverId) {
    const d = DB.drivers.find(x => x.id === editingDriverId);
    Object.assign(d, { name, email, licenseNumber, licenseExpiry, code });
  } else {
    DB.drivers.push({ id: nextId(DB), name, email, licenseNumber, licenseExpiry, role: 'driver', code, status: 'active' });
  }
  saveDB(DB); closeDriverForm(); render.drivers();
}

function removeDriver(id) { if (!confirm('Remove this driver? Their code will stop working.')) return; DB = loadDB(); DB.drivers = DB.drivers.filter(d => d.id !== id); saveDB(DB); render.drivers(); }

function suspendDriver(id) {
  DB = loadDB(); const d = DB.drivers.find(x => x.id === id); if (d) d.status = d.status === 'suspended' ? 'active' : 'suspended';
  saveDB(DB); render.drivers && render.drivers(); render.overview && document.getElementById('page-overview').classList.contains('active') && render.overview();
}

render.drivers = function() {
  DB = loadDB();
  const role = roleOf(CURRENT);
  const canEdit = role === 'bishop' || role === 'manager';
  const body = document.getElementById('drivers-body');
  body.innerHTML = DB.drivers.length ? DB.drivers.map(d => {
    const st = licenseStatus(d);
    return `<tr><td>${d.name}</td><td>${d.licenseNumber || '—'}</td><td><span class="badge ${st.cls}">${st.label}</span></td>
      <td><span class="badge ${d.status === 'suspended' ? 'suspended' : 'active-status'}">${cap(d.status)}</span></td>
      <td><span class="code-pill">${d.code}</span></td>
      <td class="action-row">
        <button class="btn small ${d.status === 'suspended' ? 'amber' : 'danger'}" onclick="suspendDriver('${d.id}')">${d.status === 'suspended' ? 'Reinstate' : 'Suspend'}</button>
        ${canEdit ? `<button class="btn small ghost" onclick='openDriverForm(${JSON.stringify(d).replace(/'/g, "&apos;")})'>Edit</button>
        <button class="btn small danger" onclick="removeDriver('${d.id}')">Remove</button>` : ''}
      </td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="6">No drivers added yet.</td></tr>`;
};

/* ================= FAULTS (admin) ================= */
function resolveFault(id) { DB = loadDB(); const f = DB.faults.find(x => x.id === id); if (f) f.status = 'resolved'; saveDB(DB); render.faults(); }

render.faults = function() {
  DB = loadDB();
  const sorted = [...DB.faults].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById('faults-admin-body').innerHTML = sorted.length ? sorted.map(f => {
    const p = findPerson(f.staffId);
    return `<tr><td>${p ? p.name : '—'}</td><td>${f.vehicle}</td><td>${f.description}</td>
      <td><span class="badge ${f.status}">${cap(f.status)}</span></td>
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
  let key = type === 'recurring' ? document.getElementById('slot-window').value : document.getElementById('slot-event-session').value;
  if (PRESETS[key]) { document.getElementById('slot-start').value = PRESETS[key].start; document.getElementById('slot-end').value = PRESETS[key].end; }
}

function refreshEventNameOptions() {
  DB = loadDB();
  const sel = document.getElementById('slot-event-name');
  sel.innerHTML = DB.eventNames.map(n => `<option value="${n}">${n}</option>`).join('') + `<option value="__custom">+ Type a new event name…</option>`;
  sel.onchange = () => { document.getElementById('slot-event-name-custom').style.display = sel.value === '__custom' ? 'block' : 'none'; };
  sel.onchange();
}

function openSlotForm() {
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
  const start = document.getElementById('slot-start').value;
  const end = document.getElementById('slot-end').value;
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
    const session = document.getElementById('slot-event-session').value;
    label = `${eventName} (${eventDate}) — ${session === 'day' ? 'Day' : 'Evening'} ${start}–${end}`;
  }
  DB.slots.push({ id: nextId(DB), type, label, day, eventName, eventDate, start, end });
  saveDB(DB); closeSlotForm(); render.slots();
}

function deleteSlot(id) { DB = loadDB(); DB.slots = DB.slots.filter(s => s.id !== id); saveDB(DB); render.slots(); }

render.slots = function() {
  DB = loadDB();
  const grid = document.getElementById('slots-grid');
  grid.innerHTML = DB.slots.length ? DB.slots.map(s => {
    const requestedCount = DB.bookings.filter(b => b.slotId === s.id && (b.status === 'pending' || b.status === 'approved')).length;
    return `<div class="slot-card">
      <div class="slot-tag">${s.type === 'event' ? 'Event' : 'Recurring'}</div>
      <div class="slot-label">${s.label}</div>
      <div class="slot-time">${s.start} – ${s.end}</div>
      <div class="slot-cap">${requestedCount} request${requestedCount === 1 ? '' : 's'} so far — unlimited bookings allowed</div>
      <button class="btn small danger" onclick="deleteSlot('${s.id}')">Delete</button>
    </div>`;
  }).join('') : `<div class="empty-state">No key slots defined yet.</div>`;
};

/* ================= WORKERS (admin managed) ================= */
let editingWorkerId = null;

function openWorkerForm(w) {
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
  if (editingWorkerId) {
    const w = DB.workers.find(x => x.id === editingWorkerId);
    Object.assign(w, { name, code });
  } else {
    DB.workers.push({ id: nextId(DB), name, role: 'worker', code });
  }
  saveDB(DB); closeWorkerForm(); render.workers();
}

function removeWorker(id) { if (!confirm('Remove this worker?')) return; DB = loadDB(); DB.workers = DB.workers.filter(w => w.id !== id); saveDB(DB); render.workers(); }

render.workers = function() {
  DB = loadDB();
  document.getElementById('workers-body').innerHTML = DB.workers.length ? DB.workers.map(w => `
    <tr><td>${w.name}</td><td><span class="code-pill">${w.code}</span></td>
    <td class="action-row"><button class="btn small ghost" onclick='openWorkerForm(${JSON.stringify(w).replace(/'/g, "&apos;")})'>Edit</button>
    <button class="btn small danger" onclick="removeWorker('${w.id}')">Remove</button></td></tr>
  `).join('') : `<tr class="empty-row"><td colspan="3">No workers added yet.</td></tr>`;
};