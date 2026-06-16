import { SZ, LOCK_DELAY, LOCK_FLASH, ROTATIONS, SRS, SRS_I } from './constants.js';
import { cfg, pieceColors } from './state.js';
import { limboQueue, setupLimbo, getCircleOffsets } from './stupid.js';
import { mkGrid, mkPiece, collide, fillBag } from './pieces.js';
import { fmtTime, showToast, showAttackSplash, clearAttackSplash, showSplash, updateCounters, drawMini, showCountdown, showScreen } from './ui.js';
import { playSfx, playSfxPitched, startMusic, stopMusic } from './sound.js';
import { createBoard } from './board.js';
import { loadStats, saveStats, recordSprintTime, recordBlitzScore, recordComboRaceScore } from './stats.js';
import { startRecording, markRecordingStart, recordPiece, recordAction, finishRecording,
         downloadReplay, scheduleReplayEvents, stopReplay } from './replay.js';

// Canvas setup
const boardEl = document.getElementById('board');
const board   = createBoard(boardEl, SZ);
const hcanvas = document.getElementById('hold-canvas');
const hctx    = hcanvas.getContext('2d');

// Solo game state
let grid, piece, heldKey, holdUsed, soloBag, soloQueue;
let score, lines, level, rafId;
let lastTime, dropAcc, sprintStartMs, timerRunning, gameStartMs;
let lockTimer=null, lockFlashTimer=null, lockFlashing=false, lockBright=true;
let lockMoves=0;
let undoStack=[], redoStack=[];
let blitzDuration = 120000;
let timerInterval = null;
let _maxCombo = 0;

// ── Motion trail ──────────────────────────────────────────────
let _motionTrail = [];
let _prevPiece   = null;   // {x, y, shape} snapshot from last frame

// ── Drop lines ────────────────────────────────────────────────
let _dropLines = [];
let _disintParticles = [];

// ── Acid distortion ───────────────────────────────────────────
const _acidOff    = document.createElement('canvas');
const _acidOCtx   = _acidOff.getContext('2d');
const _phosphorOff = document.createElement('canvas');
const _phosphorCtx = _phosphorOff.getContext('2d');
_acidOff.width = _phosphorOff.width  = boardEl.width;
_acidOff.height = _phosphorOff.height = boardEl.height;
const _boardCtx = boardEl.getContext('2d');
let _chromaBuf = new Uint8ClampedArray(boardEl.width * boardEl.height * 4);

function _syncBoardSize() {
  boardEl.width  = cfg.boardWidth  * SZ;
  boardEl.height = cfg.boardHeight * SZ;
  _acidOff.width = _phosphorOff.width  = boardEl.width;
  _acidOff.height = _phosphorOff.height = boardEl.height;
  _chromaBuf = new Uint8ClampedArray(boardEl.width * boardEl.height * 4);
}

function _applyChromatic() {
  const w = boardEl.width, h = boardEl.height;
  // Precompute per-column offset: edge-weighted, 1/3 of raw intensity
  const baseOffset = cfg.chromaticIntensity / 3;
  const colOffsets = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const edgeWeight = Math.abs(x / w * 2 - 1); // 0 at center, 1 at edges
    colOffsets[x] = Math.round(baseOffset * edgeWeight);
  }
  const src = _boardCtx.getImageData(0, 0, w, h).data;
  const dst = _chromaBuf;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const di = (row + x) << 2;
      const offset = colOffsets[x];
      if (offset === 0) {
        dst[di] = src[di]; dst[di+1] = src[di+1]; dst[di+2] = src[di+2]; dst[di+3] = src[di+3];
        continue;
      }
      // Red shifted right: sample from x - offset
      const rx = x - offset;
      const ri = (row + (rx >= 0 ? rx : 0)) << 2;
      dst[di]     = rx >= 0 ? src[ri]     : 0;
      // Green: no shift
      dst[di + 1] = src[di + 1];
      // Blue shifted left: sample from x + offset
      const bx = x + offset;
      const bi = (row + (bx < w ? bx : w - 1)) << 2;
      dst[di + 2] = bx < w ? src[bi + 2] : 0;
      dst[di + 3] = Math.max(
        rx >= 0 ? src[ri + 3] : 0,
        src[di + 3],
        bx < w  ? src[bi + 3] : 0
      );
    }
  }
  _boardCtx.putImageData(new ImageData(dst, w, h), 0, 0);
}

function _applyAcid() {
  const w = boardEl.width, h = boardEl.height;
  const now = performance.now();
  const m   = cfg.acidMeter;

  // ── Wave distortion ───────────────────────────────────────
  _acidOCtx.drawImage(boardEl, 0, 0);
  _boardCtx.clearRect(0, 0, w, h);
  const amp  = m * 2.2,  freq  = 0.022,       spd  = m * 0.0016;
  const amp2 = amp * 0.4, freq2 = freq * 1.65, spd2 = spd * 0.72;
  const vamp = m * 0.85, vfreq = 0.018,        vspd = spd * 0.55;
  for (let y = 0; y < h; y += 2) {
    const ox = Math.sin(y * freq  + now * spd  ) * amp
             + Math.sin(y * freq2 + now * spd2 + 2.1) * amp2;
    const oy = Math.sin(y * vfreq + now * vspd + 1.4) * vamp;
    _boardCtx.drawImage(_acidOff, 0, y + oy, w, 2, ox, y, w, 2);
  }

  // ── Phosphor persistence ──────────────────────────────────
  // Fade phosphor toward background color
  const fadeAmt = Math.max(0.03, 0.27 - m * 0.024);
  _phosphorCtx.fillStyle = `rgba(10,10,12,${fadeAmt.toFixed(3)})`;
  _phosphorCtx.fillRect(0, 0, w, h);
  // Accumulate current wave-distorted frame into phosphor via screen blend
  // (screen makes the dark background ~transparent, only bright pixels glow through)
  _phosphorCtx.save();
  _phosphorCtx.globalCompositeOperation = 'screen';
  _phosphorCtx.drawImage(boardEl, 0, 0);
  _phosphorCtx.restore();
  // Overlay phosphor trails on top of current frame
  _boardCtx.save();
  _boardCtx.globalCompositeOperation = 'screen';
  _boardCtx.globalAlpha = 0.2 + m * 0.065;
  _boardCtx.drawImage(_phosphorOff, 0, 0);
  _boardCtx.restore();
}

function _resetPhosphor() { _phosphorCtx.clearRect(0, 0, _phosphorOff.width, _phosphorOff.height); }

// ── Board bounce spring ───────────────────────────────────────
const _boardWrap = document.getElementById('board-wrap');
let _bx=0, _by=0;
function _bounceImpulse(dx, dy) {
  if (!cfg.boardBounce) return;
  const s = cfg.boardBounce * 0.6;
  _bx += dx * s;
  _by += dy * s;
}
function _springStep() {
  const decay = 0.70 + (cfg.boardElasticity / 10) * 0.22;
  _bx *= decay; _by *= decay;
  if (Math.abs(_bx) < 0.01) _bx = 0;
  if (Math.abs(_by) < 0.01) _by = 0;
  _boardWrap.style.transform = (_bx===0 && _by===0) ? '' : `translate(${_bx.toFixed(2)}px,${_by.toFixed(2)}px)`;
}
function _resetBounce() { _bx=0; _by=0; _boardWrap.style.transform=''; }

export let running = false;
export let paused  = false;

// Attack tracking
let b2bCount   = 0;
let comboCount = 0;

// ── Replay state ──────────────────────────────────────────────
let _isReplayMode    = false;
let _replayBag       = null;   // piece source for replay
let _pendingEvents   = null;   // events to schedule at game start
let _replaySavedCfg  = null;   // physics cfg snapshot to restore after replay
let _lastReplay      = null;   // most recent finished replay (for save button)
let _queuedReplay    = null;   // replay loaded but not yet started

export function isReplayMode()    { return _isReplayMode; }
export function isReplayPending() { return _queuedReplay !== null; }

export function queueReplay(replay) {
  _queuedReplay = replay;
  showScreen('screen-game');
  grid = mkGrid(cfg.boardWidth, cfg.boardHeight);
  board.draw({ grid, piece:null, ghostY:null, lockFlashing:false, lockBright:true,
    ghostOpacity:0, gridOn:true, gridColor:cfg.gridColor||'rgba(255,255,255,0.04)', gridWidth:cfg.gridWidth||0.5 });
  const ov = document.getElementById('overlay');
  ov.innerHTML = `<h2>REPLAY LOADED</h2><div class="sub">press hard drop to watch</div>`;
  ov.style.display = 'flex';
}

export function beginPendingReplay() {
  if (!_queuedReplay) return;
  const replay = _queuedReplay;
  _queuedReplay = null;
  loadAndPlayReplay(replay);
}

function _onReplayEnd() {
  stopReplay();
  _isReplayMode   = false;
  _replayBag      = null;
  _pendingEvents  = null;
  if (_replaySavedCfg) { Object.assign(cfg, _replaySavedCfg); _replaySavedCfg = null; }
  const badge = document.getElementById('replay-badge');
  if (badge) badge.style.display = 'none';
}

export function loadAndPlayReplay(replay) {
  _replaySavedCfg = {
    mode: cfg.mode, subMode: cfg.subMode, ranked: cfg.ranked, practice: cfg.practice,
    gravMode: cfg.gravMode, gravStatic: cfg.gravStatic, sdf: cfg.sdf,
    kicks: cfg.kicks, holdMode: cfg.holdMode, previewCount: cfg.previewCount
  };
  cfg.mode    = replay.mode;
  cfg.subMode = replay.subMode ?? null;
  cfg.ranked  = false;
  cfg.practice = false;
  const s = replay.settings || {};
  if (s.gravMode    !== undefined) cfg.gravMode    = s.gravMode;
  if (s.gravStatic  !== undefined) cfg.gravStatic  = s.gravStatic;
  if (s.sdf         !== undefined) cfg.sdf         = s.sdf;
  if (s.kicks       !== undefined) cfg.kicks       = s.kicks;
  if (s.holdMode    !== undefined) cfg.holdMode    = s.holdMode;
  if (s.previewCount !== undefined) cfg.previewCount = s.previewCount;
  _isReplayMode  = true;
  _replayBag     = [...replay.pieces];
  _pendingEvents = replay.events;
  showScreen('screen-game');
  startGame();
  const badge = document.getElementById('replay-badge');
  if (badge) badge.style.display = 'inline';
}

// Dispatch a recorded action during playback
function dispatchReplayAction(name) {
  if (!running || !piece || paused) return;
  switch (name) {
    case 'moveL':    moveH(-1);          break;
    case 'moveR':    moveH(1);           break;
    case 'rotCW':    tryRotate(false);   break;
    case 'rotCCW':   tryRotate(true);    break;
    case 'rot180':   tryRotate180();     break;
    case 'hold':     doHold();           break;
    case 'hardDrop': hardDrop();         break;
    case 'softStep':
      if (!collide(piece.shape, piece.x, piece.y+1, grid)) { piece.y++; onMove(); }
      break;
    case 'softTele':
      piece.y = ghostY(); onMove();
      break;
  }
}

// ── Undo/Redo ─────────────────────────────────────────────────
function saveUndo() {
  if (!cfg.practice) return;
  undoStack.push({grid:grid.map(r=>[...r]),piece:{...piece,shape:piece.shape.map(r=>[...r])},
    heldKey,holdUsed,score,lines,level,bag:[...soloBag],queue:[...soloQueue]});
  if (undoStack.length>60) undoStack.shift();
  redoStack=[];
}
function restoreState(s) {
  ({grid,heldKey,holdUsed,score,lines,level} = s);
  piece={...s.piece,shape:s.piece.shape.map(r=>[...r])};
  soloBag=[...s.bag]; soloQueue=[...s.queue];
  document.getElementById('score').textContent=score;
  document.getElementById('lines').textContent=lines;
  document.getElementById('level').textContent=level;
}
export function doUndo() {
  if (!cfg.practice||!undoStack.length) { showToast('Nothing to undo'); return; }
  redoStack.push({grid:grid.map(r=>[...r]),piece:{...piece,shape:piece.shape.map(r=>[...r])},
    heldKey,holdUsed,score,lines,level,bag:[...soloBag],queue:[...soloQueue]});
  restoreState(undoStack.pop()); showToast('Undo');
}
export function doRedo() {
  if (!cfg.practice||!redoStack.length) { showToast('Nothing to redo'); return; }
  undoStack.push({grid:grid.map(r=>[...r]),piece:{...piece,shape:piece.shape.map(r=>[...r])},
    heldKey,holdUsed,score,lines,level,bag:[...soloBag],queue:[...soloQueue]});
  restoreState(redoStack.pop()); showToast('Redo');
}

// ── Queue helpers ─────────────────────────────────────────────
function soloEnsureQueue() {
  if (_replayBag !== null) {
    while (soloQueue.length < cfg.previewCount + 1 && _replayBag.length > 0)
      soloQueue.push(_replayBag.shift());
    return;
  }
  while (soloBag.length<14) fillBag(soloBag);
  while (soloQueue.length<cfg.previewCount+1) soloQueue.push(soloBag.shift());
}
function soloDequeue() {
  soloEnsureQueue();
  const k = soloQueue.shift();
  if (!_isReplayMode) recordPiece(k);
  soloEnsureQueue();
  return k;
}

// ── Grounded / ghost ─────────────────────────────────────────
function isGrounded() { return piece && collide(piece.shape, piece.x, piece.y+1, grid); }
function ghostY() { let g=piece.y; while(!collide(piece.shape,piece.x,g+1,grid))g++; return g; }

// ── Lock delay ────────────────────────────────────────────────
function schedLock(isReset=false) {
  if (isReset && lockMoves >= 15) return;
  if (isReset) lockMoves++;
  cancelLock();
  lockFlashing=true; lockBright=true;
  lockFlashTimer=setInterval(()=>{lockBright=!lockBright;},LOCK_FLASH/2);
  lockTimer=setTimeout(()=>{cancelLock();if(isGrounded())doLock();},LOCK_DELAY);
}
function cancelLock(fullReset=false) {
  clearTimeout(lockTimer); clearInterval(lockFlashTimer);
  lockTimer=lockFlashTimer=null; lockFlashing=false; lockBright=true;
  if (fullReset) lockMoves=0;
}
function onMove() {
  if (isGrounded()) {
    schedLock(lockTimer !== null);
  } else {
    cancelLock(true);
  }
}

// ── Rotation ──────────────────────────────────────────────────
export function tryRotate(ccw=false) {
  const nr = ((piece.rot + (ccw ? -1 : 1)) + 4) % 4;
  const ns = ROTATIONS[piece.key][nr].map(r=>[...r]);
  const dir = `${piece.rot}>>${nr}`;
  if (!collide(ns, piece.x, piece.y, grid)) {
    piece.shape=ns; piece.rot=nr; playSfx('rotate.wav');
    if (!_isReplayMode) recordAction(ccw ? 'rotCCW' : 'rotCW');
    onMove(); return;
  }
  if (cfg.kicks === 'none') return;
  const table = piece.key==='I' ? SRS_I : SRS;
  const kicks = (table[dir] || []).slice(1);
  for (const [dx,dy] of kicks) {
    if (!collide(ns, piece.x+dx, piece.y-dy, grid)) {
      piece.shape=ns; piece.rot=nr; piece.x+=dx; piece.y-=dy; playSfx('rotate.wav');
      if (!_isReplayMode) recordAction(ccw ? 'rotCCW' : 'rotCW');
      onMove(); return;
    }
  }
}
export function tryRotate180() {
  const nr = (piece.rot + 2) % 4;
  const ns = ROTATIONS[piece.key][nr].map(r=>[...r]);
  if (!collide(ns, piece.x, piece.y, grid)) {
    piece.shape=ns; piece.rot=nr; playSfx('rotate.wav');
    if (!_isReplayMode) recordAction('rot180');
    onMove(); return;
  }
  if (cfg.kicks === 'none') return;
  const kicks180 = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [dx,dy] of kicks180) {
    if (!collide(ns, piece.x+dx, piece.y-dy, grid)) {
      piece.shape=ns; piece.rot=nr; piece.x+=dx; piece.y-=dy; playSfx('rotate.wav');
      if (!_isReplayMode) recordAction('rot180');
      onMove(); return;
    }
  }
}

// ── Lock / attack system ──────────────────────────────────────
function isImmobile() {
  return collide(piece.shape, piece.x - 1, piece.y,     grid) &&
         collide(piece.shape, piece.x + 1, piece.y,     grid) &&
         collide(piece.shape, piece.x,     piece.y - 1, grid);
}
function isSpin() { return isImmobile(); }

function baseAttack(cleared, spin) {
  if (spin) return [0, 2, 4, 7][Math.min(cleared, 3)];
  return        [0, 0.5, 1, 2, 4][Math.min(cleared, 4)];
}
function b2bBonus(b2b) {
  if (b2b <= 2)   return 0;
  if (b2b <= 5)   return 1;
  if (b2b <= 10)  return 2;
  if (b2b <= 20)  return 3;
  if (b2b <= 50)  return 4;
  if (b2b <= 100) return 5;
  return 6;
}

function clearLines(spin, pieceKey) {
  let cleared = 0;
  let hadGarbage = false;
  const disintNow = cfg.disintegrate ? performance.now() : 0;
  for (let r = cfg.boardHeight-1; r >= 0; r--) {
    if (grid[r].every(c => c)) {
      if (grid[r].some(c => c === '#888899')) hadGarbage = true;
      if (cfg.disintegrate) {
        for (let c = 0; c < cfg.boardWidth; c++) {
          const color = grid[r][c];
          if (!color || color === '__inv__') continue;
          _disintParticles.push({
            color, x: c * SZ, y: r * SZ,
            vx: (Math.random() - 0.5) * 0.08,
            vy: 0.01 + Math.random() * 0.07,
            ay: 0.00006 + Math.random() * 0.00008,
            t: disintNow,
          });
        }
      }
      grid.splice(r, 1); grid.unshift(Array(cfg.boardWidth).fill(null)); cleared++; r++;
    }
  }
  if (cleared === 0) {
    comboCount = 0;
    if (spin) showSplash('board-wrap', '', pieceKey, true, 'left');
    updateCounters('board-wrap', 0, b2bCount);
    return;
  }
  playSfxPitched('clear.wav', Math.min(comboCount + 1, 16));

  const boardEmpty     = grid.every(row => row.every(c => !c));
  const isPerfectClear = boardEmpty && !hadGarbage;
  const isColoredClear = boardEmpty && hadGarbage;
  if (isPerfectClear || isColoredClear) playSfx('pc.wav');
  const isB2BEligible  = cleared >= 4 || spin;

  let rawBase = 0;
  if (isPerfectClear) {
    rawBase = 10;
  } else if (isColoredClear) {
    rawBase = 5;
  } else {
    const b2b = isB2BEligible ? b2bBonus(b2bCount) : 0;
    rawBase = baseAttack(cleared, spin) + b2b;
  }
  const attack = Math.floor(rawBase * (1 + 0.2 * comboCount));

  if (isB2BEligible || isPerfectClear || isColoredClear) b2bCount++;
  else b2bCount = 0;
  comboCount++;
  if (comboCount > _maxCombo) { _maxCombo = comboCount; document.getElementById('max-combo-val').textContent = _maxCombo; }
  updateCounters('board-wrap', comboCount, b2bCount);

  if (cfg.mode === 'blitz') {
    score += attack;
  } else {
    score += [0,100,300,500,800][Math.min(cleared,4)] * level;
  }
  lines += cleared;
  level = Math.floor(lines/10)+1;
  document.getElementById('score').textContent = score;
  document.getElementById('lines').textContent  = lines;
  document.getElementById('level').textContent  = level;

  if (attack > 0) showAttackSplash('board-wrap', attack, undefined, comboCount >= 2);

  const clearLabel = isPerfectClear ? 'PERFECT CLEAR'
    : isColoredClear ? 'COLORED CLEAR'
    : ['','SINGLE','DOUBLE','TRIPLE','QUAD'][Math.min(cleared,4)];
  showSplash('board-wrap', clearLabel, pieceKey, spin, 'left');

  if (cfg.mode === 'sprint') {
    const goal = parseInt(cfg.subMode) || 40;
    document.getElementById('sprint-left').textContent = Math.max(0, goal-lines);
    if (lines >= goal) completeSprint();
  }
}

function completeSprint() {
  const elapsed = performance.now() - sprintStartMs;
  timerRunning = false; running = false;

  if (_isReplayMode) {
    _onReplayEnd();
    const ov = document.getElementById('overlay');
    ov.innerHTML = `<h2 style="color:var(--accent2)">REPLAY DONE</h2><div class="time-display">${fmtTime(elapsed)}</div><div class="sub">press hard drop to start new game</div>`;
    ov.style.display = 'flex';
    return;
  }

  if (cfg.ranked) recordSprintTime(elapsed, cfg.subMode || '40');
  _lastReplay = finishRecording({ outcome: 'sprint', lines, time: Math.round(elapsed) });
  const saveBtn = _lastReplay ? `<button class="btn replay-save-btn" style="margin-top:4px;">Save Replay</button>` : '';
  const ranked_note = cfg.ranked ? '' : '<div style="font-size:10px;color:var(--warn);margin-top:4px;">non-standard settings — not ranked</div>';
  const ov = document.getElementById('overlay');
  ov.innerHTML = `<h2 style="color:var(--accent2)">SPRINT DONE</h2><div class="time-display">${fmtTime(elapsed)}</div>${ranked_note}${saveBtn}<div class="sub">press hard drop to restart</div>`;
  ov.style.display = 'flex';
}

function spawnNext() {
  piece=mkPiece(soloDequeue(), cfg.boardWidth);
  dropAcc=0; lockMoves=0; _motionTrail=[]; _prevPiece=null;
  if (collide(piece.shape,piece.x,piece.y,grid) && cfg.mode!=='zen') { triggerGameOver(); return; }
  onMove();
}

export function doHold() {
  if (cfg.holdMode==='none') return;
  if (cfg.holdMode==='normal'&&holdUsed) { showToast('Hold used'); return; }
  saveUndo(); cancelLock();
  if (!_isReplayMode) recordAction('hold');
  if (heldKey===null) { heldKey=piece.key; spawnNext(); }
  else { const t=heldKey; heldKey=piece.key; piece=mkPiece(t, cfg.boardWidth);
    if (collide(piece.shape,piece.x,piece.y,grid)&&cfg.mode!=='zen') { triggerGameOver(); return; } }
  holdUsed=true; drawHold();
}

export function hardDrop() {
  playSfx('harddrop.wav'); saveUndo(); cancelLock();
  if (!_isReplayMode) recordAction('hardDrop');
  if (cfg.mode !== 'blitz') score+=2*(ghostY()-piece.y);
  _bounceImpulse(0, 1.8);
  if (cfg.dropTrailIntensity > 0) {
    const destY = ghostY();
    const dist  = destY - piece.y;
    if (dist > 0) {
      const now   = performance.now();
      const color = pieceColors[piece.key];
      const leftX  = piece.x * SZ;
      const rightX = (piece.x + piece.shape[0].length) * SZ;
      const y1px   = piece.y  * SZ;
      const y2px   = destY    * SZ;
      _dropLines.push({ x: leftX,  y1: y1px, y2: y2px, color, side: -1, t: now });
      _dropLines.push({ x: rightX, y1: y1px, y2: y2px, color, side:  1, t: now });
    }
  }
  if (cfg.motionBlurTrail > 0) {
    const now = performance.now();
    const dest = ghostY();
    const dist = dest - piece.y;
    if (dist > 0) {
      const maxEntries = cfg.motionBlurTrail + 2;
      const step = Math.max(1, Math.floor(dist / maxEntries));
      for (let dy = 0; dy < dist; dy += step) {
        _motionTrail.unshift({ x: piece.x, y: piece.y + dy, shape: piece.shape.map(r=>[...r]), key: piece.key, t: now - (dist - dy) * 4, hardDrop: true });
      }
      if (_motionTrail.length > maxEntries) _motionTrail.length = maxEntries;
    }
  }
  piece.y=ghostY(); doLock();
}

function doLock() {
  saveUndo();
  const willSpin = isSpin();
  const lockedKey = piece.key;
  for (let r=0;r<piece.shape.length;r++) for (let c=0;c<piece.shape[r].length;c++) {
    if (!piece.shape[r][c]) continue;
    const row=piece.y+r, col=piece.x+c;
    if (row<0) { if(cfg.mode!=='zen') triggerGameOver(); return; }
    grid[row][col] = cfg.invisibleLocked ? '__inv__' : pieceColors[piece.key];
  }
  clearLines(willSpin, lockedKey); spawnNext(); holdUsed=false;
}

// ── Drawing ───────────────────────────────────────────────────
export function drawHold() {
  hctx.globalAlpha=cfg.holdMode==='none'?0.2:1;
  drawMini(hctx,heldKey,hcanvas.width,hcanvas.height);
  hctx.globalAlpha=1;
  hcanvas.style.opacity=cfg.holdMode==='none'?'0.2':holdUsed?'0.45':'1';
}
export function buildPreviews() {
  const stack=document.getElementById('preview-stack'); stack.innerHTML='';
  for(let i=0;i<cfg.previewCount;i++) {
    const c=document.createElement('canvas');
    c.width=90; c.height=i===0?52:36; c.id='prev-'+i; stack.appendChild(c);
  }
  setupLimbo(stack, cfg.previewCount);
  drawPreviews();
}
function drawPreviews() {
  const q = limboQueue(soloQueue, cfg.previewCount);
  for(let i=0;i<cfg.previewCount;i++) {
    const c=document.getElementById('prev-'+i);
    if(c) drawMini(c.getContext('2d'),q[i]||null,c.width,c.height);
  }
}

// ── Gravity / loop ────────────────────────────────────────────
function getInterval() {
  if (cfg.gravMode==='static') return Math.max(33, 800/cfg.gravStatic);
  return Math.max(33, ((0.8-((level-1)*0.007))**(level-1))*1000);
}
function loop(ts) {
  if (!running) return;
  if (!paused) {
    const dt=Math.min(ts-lastTime,100); lastTime=ts;
    if (!isGrounded()) {
      dropAcc+=dt;
      if(dropAcc>getInterval()){dropAcc=0; piece.y++; onMove();}
    }
    const { circleGrid, circlePiece } = getCircleOffsets(ts);

    let motionTrail = null;
    if (cfg.motionBlurTrail > 0 && piece) {
      const now = performance.now();
      const trailDuration = cfg.motionBlurTrail * 40;
      const maxEntries    = cfg.motionBlurTrail + 2;
      if (_prevPiece && (_prevPiece.x !== piece.x || _prevPiece.y !== piece.y)) {
        _motionTrail.unshift({ x: _prevPiece.x, y: _prevPiece.y, shape: _prevPiece.shape, key: piece.key, t: now });
        if (_motionTrail.length > maxEntries) _motionTrail.pop();
      }
      _motionTrail = _motionTrail.filter(e => now - e.t < trailDuration);
      _prevPiece = { x: piece.x, y: piece.y, shape: piece.shape.map(r => [...r]) };
      if (_motionTrail.length > 0) {
        const intensityMult = cfg.motionBlurIntensity / 5;
        motionTrail = _motionTrail.map(e => {
          const t = Math.min(1, (now - e.t) / trailDuration);
          return {
            ...e,
            alpha: Math.pow(1 - t, 1.4) * 0.55 * intensityMult,
            blur:  t * SZ * 0.9
          };
        });
      }
    } else {
      _prevPiece = null;
    }

    let dropLines = null;
    if (_dropLines.length > 0) {
      const now = performance.now();
      const dur  = 420;
      _dropLines = _dropLines.filter(dl => now - dl.t < dur);
      if (_dropLines.length > 0) {
        const intensityMult = cfg.dropTrailIntensity / 5;
        dropLines = _dropLines.map(dl => ({
          ...dl,
          alpha: Math.pow(1 - (now - dl.t) / dur, 1.6) * 0.85 * intensityMult,
        }));
      }
    }

    let disintegrate = null;
    if (_disintParticles.length > 0) {
      const now = performance.now();
      const dur = 1400;
      _disintParticles = _disintParticles.filter(p => now - p.t < dur);
      if (_disintParticles.length > 0) {
        disintegrate = _disintParticles.map(p => {
          const elapsed = now - p.t;
          const progress = elapsed / dur;
          return {
            x: p.x + p.vx * elapsed,
            y: p.y + p.vy * elapsed + 0.5 * p.ay * elapsed * elapsed,
            color: p.color,
            alpha: Math.pow(1 - progress, 1.4),
            brightFactor: progress,
          };
        });
      }
    }

    board.draw({
      grid, piece,
      ghostY: (piece && cfg.ghostOpacity > 0) ? ghostY() : null,
      lockFlashing, lockBright,
      ghostOpacity: cfg.ghostOpacity,
      gridOn: cfg.gridOn, gridColor: cfg.gridColor, gridWidth: cfg.gridWidth,
      circleGrid, circlePiece, motionTrail, dropLines, disintegrate,
    });
    if (cfg.acid) _applyAcid();
    if (cfg.chromaticAberration) _applyChromatic();
    _springStep();
    drawPreviews(); drawHold();
  }
  rafId=requestAnimationFrame(loop);
}

// ── Start / game over ─────────────────────────────────────────
export function startGame() {
  _syncBoardSize();
  clearAttackSplash('board-wrap');
  _lastReplay = null; _motionTrail = []; _prevPiece = null; _dropLines = []; _disintParticles = []; _resetPhosphor();
  _maxCombo = 0;
  grid=mkGrid(cfg.boardWidth, cfg.boardHeight); score=0; lines=0; level=1; dropAcc=0; b2bCount=0; comboCount=0;
  if (cfg.overhang && cfg.boardWidth === 4) {
    const h = cfg.boardHeight, zc = pieceColors.Z;
    grid[h-2][2] = zc; grid[h-2][3] = zc;
    grid[h-1][3] = zc;
  }
  updateCounters('board-wrap', 0, 0);
  soloBag=[]; soloQueue=[]; heldKey=null; holdUsed=false;
  undoStack=[]; redoStack=[]; cancelLock();
  ['score','lines','level'].forEach(id=>document.getElementById(id).textContent=id==='level'?'1':'0');
  document.getElementById('game-mode-badge').textContent=
    ({marathon:'MARATHON',sprint:(cfg.subMode||'40')+'L SPRINT',blitz:'BLITZ '+(cfg.subMode||'2m').toUpperCase(),zen:'ZEN','combo-race':'COMBO RACE'}[cfg.mode]||cfg.mode.toUpperCase());
  document.getElementById('sprint-target-row').style.display=cfg.mode==='sprint'?'flex':'none';
  document.getElementById('sprint-left').textContent=cfg.subMode||'40';
  document.getElementById('combo-race-row').style.display=cfg.mode==='combo-race'?'flex':'none';
  document.getElementById('max-combo-val').textContent='0';
  document.getElementById('practice-badge').style.display=cfg.practice?'inline':'none';
  document.getElementById('game-timer').textContent=(cfg.mode==='blitz'||cfg.mode==='combo-race')?fmtTime(cfg.mode==='combo-race'?30000:blitzDuration):'0:00.000';
  if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  timerRunning=false;
  soloEnsureQueue(); buildPreviews();
  // During countdown, queue[0] will spawn at GO — show queue[1..N] so preview matches game start
  for (let i = 0; i < cfg.previewCount; i++) {
    const c = document.getElementById('prev-' + i);
    if (c) drawMini(c.getContext('2d'), soloQueue[i + 1] || null, c.width, c.height);
  }
  drawHold();
  running=false; paused=false;
  document.getElementById('overlay').style.display='none';
  const scoreLbl = document.getElementById('score-label');
  if (scoreLbl) scoreLbl.textContent = cfg.mode==='blitz' ? 'Lines Sent' : 'Score';
  cancelAnimationFrame(rafId);
  // Draw empty board with grid so it's visible behind the countdown
  board.draw({ grid, piece:null, ghostY:null, lockFlashing:false, lockBright:true,
    ghostOpacity:0, gridOn:true, gridColor:cfg.gridColor||'rgba(255,255,255,0.04)', gridWidth:cfg.gridWidth||0.5 });
  showCountdown('board-wrap', () => {
    startMusic('music/aperture.wav');
    if (_isReplayMode && _pendingEvents !== null) {
      scheduleReplayEvents(_pendingEvents, dispatchReplayAction);
      _pendingEvents = null;
    } else {
      startRecording(cfg.mode, cfg.subMode, cfg);
    }
    spawnNext();
    running=true;
    gameStartMs=sprintStartMs=performance.now();
    if (!_isReplayMode) markRecordingStart(gameStartMs);
    timerRunning=true;
    if(timerInterval) clearInterval(timerInterval);
    timerInterval=setInterval(()=>{
      if(!timerRunning||paused) return;
      blitzDuration = {'30s':30000,'1m':60000,'2m':120000}[cfg.subMode] || 120000;
      if(cfg.mode==='blitz'){
        const rem=Math.max(0,blitzDuration-(performance.now()-gameStartMs));
        document.getElementById('game-timer').textContent=fmtTime(rem);
        if(rem<=0) triggerGameOver();
      } else if (cfg.mode==='combo-race') {
        const rem=Math.max(0,30000-(performance.now()-gameStartMs));
        document.getElementById('game-timer').textContent=fmtTime(rem);
        if(rem<=0) triggerGameOver();
      } else {
        document.getElementById('game-timer').textContent=fmtTime(performance.now()-sprintStartMs);
      }
    },33);
    lastTime=performance.now();
    rafId=requestAnimationFrame(loop);
  });
  const st=loadStats(); st.gamesPlayed=(st.gamesPlayed||0)+1; saveStats(st);
}

export function triggerGameOver() {
  stopMusic();
  running=false; timerRunning=false; cancelLock();
  if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  const st=loadStats(); st.totalLines=(st.totalLines||0)+lines; saveStats(st);
  const ov=document.getElementById('overlay');

  if (_isReplayMode) {
    _onReplayEnd();
    ov.innerHTML = `<h2>REPLAY DONE</h2><div class="score-display">${score}</div><div class="sub">press hard drop to start new game</div>`;
    ov.style.display='flex';
    return;
  }

  _lastReplay = finishRecording({
    outcome: cfg.mode === 'blitz' ? 'blitz' : cfg.mode === 'combo-race' ? 'combo-race' : 'gameover',
    score, lines,
    time: Math.round(performance.now() - gameStartMs),
    ...(cfg.mode === 'combo-race' && { maxCombo: _maxCombo })
  });
  const saveBtn = _lastReplay ? `<button class="btn replay-save-btn" style="margin-top:4px;">Save Replay</button>` : '';

  if (cfg.mode === 'blitz') {
    if (cfg.ranked) recordBlitzScore(score, cfg.subMode || '2m');
    const ranked_note = cfg.ranked ? '' : '<div style="font-size:10px;color:var(--warn);margin-top:4px;">non-standard settings — not ranked</div>';
    ov.innerHTML = `<h2 style="color:var(--accent2)">TIME'S UP</h2><div class="score-display">${score} <span style="font-size:16px;color:var(--muted)">lines sent</span></div>${ranked_note}${saveBtn}<div class="sub">press hard drop to restart</div>`;
  } else if (cfg.mode === 'combo-race') {
    recordComboRaceScore(_maxCombo);
    ov.innerHTML = `<h2 style="color:var(--accent2)">TIME'S UP</h2><div class="score-display">${_maxCombo} <span style="font-size:16px;color:var(--muted)">max combo</span></div>${saveBtn}<div class="sub">press hard drop to restart</div>`;
  } else {
    ov.innerHTML = `<h2>GAME OVER</h2><div class="score-display">${score}</div>${saveBtn}<div class="sub">press hard drop to restart</div>`;
  }
  ov.style.display='flex';
}

export function stopGame() {
  running = false;
  cancelAnimationFrame(rafId);
  _queuedReplay = null;
  _resetBounce();
  _resetPhosphor();
  _disintParticles = [];
  if (_isReplayMode) _onReplayEnd();
}

export function togglePause() {
  paused = !paused;
  if (!paused) lastTime = performance.now();
}

export function isRunning() { return running; }

// ── DAS / input ───────────────────────────────────────────────
let dasTimer=null, dasInterval=null, dasDir=0, dasHeld=false;
let sdActive=false, sdInterval=null;

export function moveH(dx) {
  if(!running||!piece||paused) return;
  if(!collide(piece.shape,piece.x+dx,piece.y,grid)){
    piece.x+=dx; playSfx('move.wav');
    if (!_isReplayMode) recordAction(dx < 0 ? 'moveL' : 'moveR');
    _bounceImpulse(dx, 0);
    onMove();
  }
}
export function startDAS(dx) {
  stopDAS(); dasDir=dx; dasHeld=true; moveH(dx);
  dasTimer=setTimeout(()=>{
    if(!dasHeld) return;
    if(cfg.arr===0){let nx=piece.x;while(!collide(piece.shape,nx+dx,piece.y,grid))nx+=dx;piece.x=nx;onMove();}
    else dasInterval=setInterval(()=>{if(dasHeld)moveH(dasDir);},cfg.arr);
  },cfg.das);
}
export function stopDAS(){dasHeld=false;clearTimeout(dasTimer);clearInterval(dasInterval);dasTimer=dasInterval=null;}

export function startSoftDrop() {
  if(sdActive) return; sdActive=true;
  if(cfg.sdf===41){
    const gy=ghostY(); piece.y=gy; onMove(); sdActive=false;
    if (!_isReplayMode) recordAction('softTele');
    return;
  }
  if(!collide(piece.shape,piece.x,piece.y+1,grid)){
    piece.y++; onMove();
    if (!_isReplayMode) recordAction('softStep');
  }
  sdInterval=setInterval(()=>{
    if(!running||paused){stopSD();return;}
    if(!collide(piece.shape,piece.x,piece.y+1,grid)){
      piece.y++; onMove();
      if (!_isReplayMode) recordAction('softStep');
    }
  },Math.max(1,getInterval()/cfg.sdf));
}
export function stopSD(){sdActive=false;clearInterval(sdInterval);sdInterval=null;}

// ── In-game settings ──────────────────────────────────────────
export function closeIngame(){
  document.getElementById('ingame-settings').classList.remove('open');
  document.getElementById('ingame-overlay').classList.remove('open');
  paused=false; lastTime=performance.now();
}
function buildIngame(){
  document.getElementById('ingame-settings-body').innerHTML=`
    <div class="settings-group"><div class="settings-group-title">Gravity</div>
      <div class="setting-row"><div class="setting-label">Type</div>
        <select onchange="cfg.gravMode=this.value;document.getElementById('ig-sr').style.display=this.value==='static'?'flex':'none'">
          <option value="leveled"${cfg.gravMode==='leveled'?' selected':''}>Leveled</option>
          <option value="static"${cfg.gravMode==='static'?' selected':''}>Static</option>
        </select>
      </div>
      <div class="setting-row" id="ig-sr" style="display:${cfg.gravMode==='static'?'flex':'none'}">
        <div class="setting-label">Speed <span id="ig-gv">${cfg.gravStatic.toFixed(1)}×</span></div>
        <input type="range" min="0.1" max="20" step="0.1" value="${cfg.gravStatic}"
          oninput="cfg.gravStatic=parseFloat(this.value);document.getElementById('ig-gv').textContent=parseFloat(this.value).toFixed(1)+'×'">
      </div>
    </div>
    <div class="settings-group"><div class="settings-group-title">Rotation</div>
      <div class="setting-row"><div class="setting-label">Kicks</div>
        <select onchange="cfg.kicks=this.value">
          <option value="srs"${cfg.kicks==='srs'?' selected':''}>SRS</option>
          <option value="none"${cfg.kicks==='none'?' selected':''}>None</option>
        </select>
      </div>
    </div>
    <div class="settings-group"><div class="settings-group-title">Hold</div>
      <div class="setting-row"><div class="setting-label">Hold Mode</div>
        <select onchange="cfg.holdMode=this.value;drawHold()">
          <option value="normal"${cfg.holdMode==='normal'?' selected':''}>Hold</option>
          <option value="infinite"${cfg.holdMode==='infinite'?' selected':''}>Infinite</option>
          <option value="none"${cfg.holdMode==='none'?' selected':''}>None</option>
        </select>
      </div>
    </div>
    <div class="settings-group"><div class="settings-group-title">Visuals</div>
      <div class="setting-row"><div class="setting-label">Ghost opacity <span id="ig-go">${Math.round(cfg.ghostOpacity*100)}%</span></div>
        <input type="range" min="0" max="80" step="5" value="${Math.round(cfg.ghostOpacity*100)}"
          oninput="cfg.ghostOpacity=+this.value/100;document.getElementById('ig-go').textContent=this.value+'%'">
      </div>
      <div class="setting-row"><div class="setting-label">Grid</div>
        <select onchange="cfg.gridOn=this.value==='1'">
          <option value="1"${cfg.gridOn?' selected':''}>On</option>
          <option value="0"${!cfg.gridOn?' selected':''}>Off</option>
        </select>
      </div>
      <div class="setting-row"><div class="setting-label">Invisible lock</div>
        <select onchange="cfg.invisibleLocked=this.value==='1'">
          <option value="0"${!cfg.invisibleLocked?' selected':''}>Off</option>
          <option value="1"${cfg.invisibleLocked?' selected':''}>On</option>
        </select>
      </div>
    </div>
    <button class="big-btn primary" onclick="closeIngame()" style="margin-top:8px;">Resume</button>`;
}

// Wire gear-btn, close-ingame, ingame-overlay at module level
document.getElementById('gear-btn').onclick=()=>{
  if(!cfg.practice){showToast('Enable Practice Mode for live settings');return;}
  buildIngame();
  document.getElementById('ingame-settings').classList.add('open');
  document.getElementById('ingame-overlay').classList.add('open');
  paused=true;
};
document.getElementById('close-ingame').onclick=closeIngame;
document.getElementById('ingame-overlay').onclick=closeIngame;

// Expose closeIngame for inline onclick in buildIngame HTML
window.closeIngame = closeIngame;

// Save replay button — event delegation on overlay
document.getElementById('overlay').addEventListener('click', e => {
  if (e.target.closest('.replay-save-btn') && _lastReplay) downloadReplay(_lastReplay);
});
