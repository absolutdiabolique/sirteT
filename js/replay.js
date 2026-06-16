// ── Recording ─────────────────────────────────────────────────
let _rec = null;

export function startRecording(mode, subMode, settings) {
  _rec = {
    mode, subMode,
    settings: {
      gravMode: settings.gravMode, gravStatic: settings.gravStatic,
      das: settings.das, arr: settings.arr, sdf: settings.sdf,
      kicks: settings.kicks, previewCount: settings.previewCount, holdMode: settings.holdMode
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

export function downloadReplay(replay) {
  const ts = replay.date.slice(0, 16).replace('T', '_').replace(/:/g, '-');
  const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sirteT_${replay.mode}_${ts}.json`;
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
