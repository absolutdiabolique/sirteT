import { fetchReplayHash } from './api.js';

// ── Verification helpers ───────────────────────────────────────
// Must produce identical output to the server's stableStringify.
function _stableStringify(val) {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return JSON.stringify(val);
  return '{' + Object.keys(val).sort().map(k => JSON.stringify(k) + ':' + _stableStringify(val[k])).join(',') + '}';
}

async function _computeHash(replay) {
  const { version, mode, subMode, settings, pieces, events, result } = replay;
  const content = _stableStringify({ version, mode, subMode, settings, pieces, events, result });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns 'ok', 'tampered', or 'error'.
export async function verifyReplayIntegrity(replay) {
  if (!replay.verified?.id) return 'error';
  try {
    const [serverHash, localHash] = await Promise.all([
      fetchReplayHash(replay.verified.id),
      _computeHash(replay),
    ]);
    if (!serverHash) return 'error';
    return serverHash === localHash ? 'ok' : 'tampered';
  } catch { return 'error'; }
}

// ── Recording ─────────────────────────────────────────────────
let _rec = null;

export function startRecording(mode, subMode, settings) {
  _rec = {
    mode, subMode,
    settings: {
      gravMode: settings.gravMode, gravStatic: settings.gravStatic,
      das: settings.das, arr: settings.arr, sdf: settings.sdf,
      kicks: settings.kicks, previewCount: settings.previewCount, holdMode: settings.holdMode,
      boardWidth: settings.boardWidth, boardHeight: settings.boardHeight, overhang: settings.overhang
    },
    pieces: [], events: [], startTs: null
  };
}

export function markRecordingStart(ts) {
  if (_rec) _rec.startTs = ts;
}

export function recordPiece(key) {
  if (_rec) _rec.pieces.push(key);
}

export function recordAction(name) {
  if (!_rec || _rec.startTs === null) return;
  _rec.events.push({ t: Math.round(performance.now() - _rec.startTs), a: name });
}

export function finishRecording(result) {
  if (!_rec) return null;
  const replay = {
    version: 1,
    mode: _rec.mode,
    subMode: _rec.subMode ?? null,
    settings: _rec.settings,
    pieces: [..._rec.pieces],
    events: [..._rec.events],
    result,
    date: new Date().toISOString()
  };
  _rec = null;
  return replay;
}

export function downloadReplay(replay, verified = null) {
  const toSave = verified ? { ...replay, verified } : replay;
  const ts = (toSave.date || new Date().toISOString()).slice(0, 16).replace('T', '_').replace(/:/g, '-');
  const suffix = verified ? '_verified' : '';
  const blob = new Blob([JSON.stringify(toSave)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sirteT_${toSave.mode}_${ts}${suffix}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Playback ──────────────────────────────────────────────────
let _replayActive = false;
let _replayTimeouts = [];

export function isReplaying() { return _replayActive; }

export function scheduleReplayEvents(events, dispatch) {
  _replayActive = true;
  _replayTimeouts = [];
  for (const ev of events) {
    _replayTimeouts.push(setTimeout(() => { if (_replayActive) dispatch(ev.a); }, ev.t));
  }
}

export function stopReplay() {
  _replayActive = false;
  _replayTimeouts.forEach(clearTimeout);
  _replayTimeouts = [];
}
