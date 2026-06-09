import { API_URL } from './config.js';
import { loadStats, saveStats } from './stats.js';

const STORAGE_KEY = 'sirtet_auth';

function loadAuth()      { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } }
function saveAuth(d)     { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
function clearAuth()     { localStorage.removeItem(STORAGE_KEY); }

let _authData    = loadAuth(); // { idToken, refreshToken, uid, email, username, expiresAt }
let _onChange    = null;       // (user, username) callback set by initAuth
let _refreshTimer = null;

export function currentUser()     { return _authData ? { uid: _authData.uid, email: _authData.email } : null; }
export function currentUsername() { return _authData?.username ?? null; }

// ── Token management ──────────────────────────────────────────────────────────
async function _refreshToken() {
  if (!_authData?.refreshToken) { clearAuth(); _authData = null; return; }
  try {
    const r = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: _authData.refreshToken }),
    });
    if (!r.ok) { clearAuth(); _authData = null; return; }
    const d = await r.json();
    _authData = { ..._authData, idToken: d.idToken, refreshToken: d.refreshToken, expiresAt: Date.now() + 3600000 };
    saveAuth(_authData);
  } catch { /* keep existing token */ }
}

function _schedRefresh() {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  if (!_authData?.expiresAt) return;
  const delay = Math.max(0, _authData.expiresAt - Date.now() - 5 * 60 * 1000);
  _refreshTimer = setTimeout(async () => { await _refreshToken(); _schedRefresh(); }, Math.min(delay, 55 * 60 * 1000));
}

export async function getIdToken() {
  if (!_authData) return null;
  if (!_authData.expiresAt || Date.now() >= _authData.expiresAt - 60000) await _refreshToken();
  return _authData?.idToken ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function _apiFetch(path, opts = {}) {
  const token   = await getIdToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r    = await fetch(`${API_URL}${path}`, { ...opts, headers });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function _syncFromCloud() {
  try {
    const local = loadStats();
    const d     = await _apiFetch('/api/user/sync-pbs', {
      method: 'POST', body: JSON.stringify({ pbs: local }),
    });
    if (d.pbs) saveStats(d.pbs);
  } catch(e) { console.warn('Cloud sync failed:', e.message); }
}

function _fire() { _onChange?.(currentUser(), _authData?.username ?? null); }

// ── Public API ────────────────────────────────────────────────────────────────
export async function sendVerificationCode(email) {
  const r = await fetch(`${API_URL}/api/auth/send-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Failed to send code');
}

export async function signUp(email, password, code) {
  const d    = await _apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, code }) });
  _authData  = { idToken: d.idToken, refreshToken: d.refreshToken, uid: d.uid, email: d.email, username: d.username, expiresAt: Date.now() + 3600000 };
  saveAuth(_authData);
  _schedRefresh();
  await _syncFromCloud();
  _fire();
}

export async function logIn(email, password) {
  const d    = await _apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  _authData  = { idToken: d.idToken, refreshToken: d.refreshToken, uid: d.uid, email: d.email, username: d.username, expiresAt: Date.now() + 3600000 };
  saveAuth(_authData);
  _schedRefresh();
  await _syncFromCloud();
  _fire();
}

export function logOut() {
  clearAuth();
  _authData = null;
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
  _fire();
}

export async function changeUsername(newUsername) {
  if (!_authData) throw new Error('Not signed in');
  const trimmed = newUsername.trim();
  if (!trimmed) throw new Error('Username cannot be empty');
  await _apiFetch('/api/user/username', { method: 'PATCH', body: JSON.stringify({ username: trimmed }) });
  _authData = { ..._authData, username: trimmed };
  saveAuth(_authData);
}

export async function deleteData() {
  if (!_authData) throw new Error('Not signed in');
  await _apiFetch('/api/user/data', { method: 'DELETE' });
  localStorage.removeItem('sirtet_stats');
}

export async function deleteAccount() {
  if (!_authData) throw new Error('Not signed in');
  await _apiFetch('/api/user', { method: 'DELETE' });
  clearAuth();
  _authData = null;
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
  _fire();
}

export async function uploadPB(key, data) {
  if (!_authData) return;
  try { await _apiFetch(`/api/user/pbs/${key}`, { method: 'POST', body: JSON.stringify(data) }); } catch { /* silent */ }
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initAuth(onUserChange) {
  _onChange = onUserChange;
  if (!_authData) { onUserChange(null, null); return; }

  const now = Date.now();
  if (_authData.expiresAt && now >= _authData.expiresAt) {
    // Expired — try refresh, then fire
    _refreshToken().then(() => {
      onUserChange(currentUser(), _authData?.username ?? null);
      _schedRefresh();
    });
  } else {
    onUserChange(currentUser(), _authData.username ?? null);
    _schedRefresh();
  }
}
