import { io } from 'https://cdn.socket.io/4.7.5/socket.io.esm.min.js';
import { API_URL } from './config.js';
import { getIdToken } from './account.js';

let _socket     = null;
let _statusCb   = null;

export function setSocketStatusCallback(cb) { _statusCb = cb; }

function _createSocket(token) {
  if (_socket) { _socket.disconnect(); _socket = null; }
  _socket = io(API_URL, {
    auth: { token: token || null },
    transports: ['websocket'],
  });
  if (_statusCb) {
    _socket.on('connect',    () => _statusCb('ok'));
    _socket.on('disconnect', () => _statusCb('err'));
  }
  return _socket;
}

export function getSocket() { return _socket; }

export function reconnectSocket(token) { return _createSocket(token); }

// Connect on module load with any stored token.
const _stored = (() => {
  try { return JSON.parse(localStorage.getItem('sirtet_auth') || 'null')?.idToken || null; } catch { return null; }
})();
_createSocket(_stored);

// Sends a garbage attack through the server.
export async function sendAttack({ mode, lines, targetId, roomId, senderId }) {
  try {
    const token   = await getIdToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    await fetch(`${API_URL}/api/attack`, {
      method: 'POST', headers,
      body: JSON.stringify({ mode, lines, targetId, roomId, senderId }),
    });
  } catch { /* silent — network failure should not break gameplay */ }
}
