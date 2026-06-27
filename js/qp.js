// Quick Play — always-open ranked free-for-all
// Socket events:
//   qp:join       — register presence, starts receiving qp:players / qp:attack
//   qp:syncBoard  — throttled board state broadcast
//   qp:topOut     — mark as dead
//   qp:leave      — remove presence
//   qp:players    — all current players snapshot (server → client)
//   qp:attack     — incoming garbage (server → client, consumed server-side)

import { COLS, ROWS, SZ, LOCK_DELAY, LOCK_FLASH, ROTATIONS, SRS, SRS_I } from './constants.js';
import { cfg, pieceColors } from './state.js';
import { mkGrid, mkPiece, collide, fillBag } from './pieces.js';
import {
  showToast, showAttackSplash, clearAttackSplash,
  showSplash, updateCounters, updateGarbageBar, drawMini, showCountdown
} from './ui.js';
import { playSfx, playLineClearTone, stopMusic } from './sound.js';
import { createBoard } from './board.js';
import { currentUser, currentUsername } from './account.js';
import { getSocket } from './api.js';
import { limboQueue, setupLimbo, getCircleOffsets } from './stupid.js';

const QP_PREVIEW = 5;

// ── Canvas setup ──────────────────────────────────────────────────────────────
const qpBoardEl   = document.getElementById('qp-board');
const qpBrd       = createBoard(qpBoardEl, SZ);
const _qpBoardWrap = document.getElementById('qp-board-wrap');
const qpHoldEl  = document.getElementById('qp-hold-canvas');
const qpHoldCtx = qpHoldEl.getContext('2d');

// ── Game state ────────────────────────────────────────────────────────────────
export let qpRunning = false;
export let qpPiece   = null;

let qpGrid, qpBag, qpQueue, qpHeld, qpHoldUsed;
let qpScore, qpAlive;
let qpCombo, qpB2b;
let qpGarbage, qpLastKiller, qpKoSet;
let qpLevel, qpDropAcc;
let qpRafId, qpLastTime;
let qpLockTimer = null, qpLockFlashTimer = null;
let qpLockFlashing = false, qpLockBright = true, qpLockMoves = 0;

// ── DAS / soft drop ───────────────────────────────────────────────────────────
let qpDasTimer = null, qpDasInterval = null, qpDasDir = 0, qpDasHeld = false;
let qpSdActive = false, qpSdInterval = null;

// ── Player state ──────────────────────────────────────────────────────────────
let qpMyUid = null, qpMyUsername = null;
let qpSyncPending = false;
let otherPlayers = {};

// ── Client-side buffering ─────────────────────────────────────────────────────
let _qpAtkBuf = 0, _qpAtkFlushTimer = null;
let _qpLastSyncTs = 0;
let _qpClimbSpeed = 0;
let _qpBx = 0, _qpBy = 0;
let _qpDropLines = [];
let _qpMotionTrail = [], _qpPrevPiece = null;

// ── Board bounce spring ───────────────────────────────────────────────────────
function _qpBounceImpulse(dx, dy) {
  if (!cfg.boardBounce) return;
  const s = cfg.boardBounce * 0.6;
  _qpBx += dx * s; _qpBy += dy * s;
}
function _qpSpringStep() {
  const decay = 0.70 + (cfg.boardElasticity / 10) * 0.22;
  _qpBx *= decay; _qpBy *= decay;
  if (Math.abs(_qpBx) < 0.01) _qpBx = 0;
  if (Math.abs(_qpBy) < 0.01) _qpBy = 0;
  _qpBoardWrap.style.transform = (_qpBx === 0 && _qpBy === 0) ? '' : `translate(${_qpBx.toFixed(2)}px,${_qpBy.toFixed(2)}px)`;
}

// ── Climb speed tiers ─────────────────────────────────────────────────────────
const _QP_TIERS = [
  { min: 0.999,   max: 0.3,  color: '#ef4444' }, // Red
  { min: 0.3, max: 0.6,  color: '#eab308' }, // Yellow
  { min: 0.6, max: 1.0,  color: '#22c55e' }, // Green
  { min: 1.0, max: 1.5,  color: '#3b82f6' }, // Blue
  { min: 1.5, max: 2.3,  color: '#d946ef' }, // Magenta
  { min: 2.3, max: 1000.0,  color: '#ffffff' }, // White
];

function _qpUpdateClimbBar(speed) {
  const speedEl = document.getElementById('qp-climb-speed-val');
  if (speedEl) speedEl.textContent = speed.toFixed(2);

  const mainEl = document.getElementById('qp-climb-bar-main');
  const nextEl = document.getElementById('qp-climb-bar-next');
  if (!mainEl || !nextEl) return;

  let ti = 0;
  for (let i = _QP_TIERS.length - 1; i >= 0; i--) {
    if (speed >= _QP_TIERS[i].min) { ti = i; break; }
  }
  const tier = _QP_TIERS[ti];
  mainEl.style.background = speed > 0 ? tier.color : 'transparent';
  const pct = Math.min(100, ((speed - tier.min) / (tier.max - tier.min)) * 100);
  if (ti < _QP_TIERS.length - 1) {
    nextEl.style.width = pct + '%';
    nextEl.style.background = _QP_TIERS[ti + 1].color;
  } else {
    nextEl.style.width = '0';
  }
}

// ── Queue ─────────────────────────────────────────────────────────────────────
function qpEnsureQueue() {
  while (qpBag.length < 14) fillBag(qpBag);
  while (qpQueue.length < QP_PREVIEW + 1) qpQueue.push(qpBag.shift());
}
function qpDequeue() {
  qpEnsureQueue();
  const k = qpQueue.shift();
  qpEnsureQueue();
  return k;
}

// ── Physics helpers ───────────────────────────────────────────────────────────
function qpGrounded() { return qpPiece && collide(qpPiece.shape, qpPiece.x, qpPiece.y + 1, qpGrid); }
function qpGhostY()   { let g = qpPiece.y; while (!collide(qpPiece.shape, qpPiece.x, g + 1, qpGrid)) g++; return g; }

// ── Lock delay ────────────────────────────────────────────────────────────────
function qpSchedLock(isReset = false) {
  if (isReset && qpLockMoves >= 15) return;
  if (isReset) qpLockMoves++;
  qpCancelLock();
  qpLockFlashing = true; qpLockBright = true;
  qpLockFlashTimer = setInterval(() => { qpLockBright = !qpLockBright; }, LOCK_FLASH / 2);
  qpLockTimer = setTimeout(() => { qpCancelLock(); if (qpGrounded()) qpDoLock(); }, LOCK_DELAY);
}
function qpCancelLock(full = false) {
  clearTimeout(qpLockTimer); clearInterval(qpLockFlashTimer);
  qpLockTimer = qpLockFlashTimer = null;
  qpLockFlashing = false; qpLockBright = true;
  if (full) qpLockMoves = 0;
}
function qpOnMove() {
  if (qpGrounded()) qpSchedLock(qpLockTimer !== null);
  else qpCancelLock(true);
}

// ── Rotation ──────────────────────────────────────────────────────────────────
export function qpTryRotate(ccw = false) {
  if (!qpRunning || !qpPiece || !qpAlive) return;
  const nr  = ((qpPiece.rot + (ccw ? -1 : 1)) + 4) % 4;
  const ns  = ROTATIONS[qpPiece.key][nr].map(r => [...r]);
  const dir = `${qpPiece.rot}>>${nr}`;
  if (!collide(ns, qpPiece.x, qpPiece.y, qpGrid)) { qpPiece.shape = ns; qpPiece.rot = nr; playSfx('rotate.wav'); qpOnMove(); return; }
  if (cfg.kicks === 'none') return;
  const table = qpPiece.key === 'I' ? SRS_I : SRS;
  for (const [dx, dy] of (table[dir] || []).slice(1)) {
    if (!collide(ns, qpPiece.x + dx, qpPiece.y - dy, qpGrid)) {
      qpPiece.shape = ns; qpPiece.rot = nr; qpPiece.x += dx; qpPiece.y -= dy; playSfx('rotate.wav'); qpOnMove(); return;
    }
  }
}

export function qpTryRotate180() {
  if (!qpRunning || !qpPiece || !qpAlive) return;
  const nr = (qpPiece.rot + 2) % 4;
  const ns = ROTATIONS[qpPiece.key][nr].map(r => [...r]);
  if (!collide(ns, qpPiece.x, qpPiece.y, qpGrid)) { qpPiece.shape = ns; qpPiece.rot = nr; playSfx('rotate.wav'); qpOnMove(); return; }
  if (cfg.kicks === 'none') return;
  for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]) {
    if (!collide(ns, qpPiece.x + dx, qpPiece.y - dy, qpGrid)) {
      qpPiece.shape = ns; qpPiece.rot = nr; qpPiece.x += dx; qpPiece.y -= dy; playSfx('rotate.wav'); qpOnMove(); return;
    }
  }
}

// ── Hold ──────────────────────────────────────────────────────────────────────
export function qpDoHold() {
  if (!qpRunning || !qpAlive) return;
  if (cfg.holdMode === 'none') return;
  if (cfg.holdMode === 'normal' && qpHoldUsed) { showToast('Hold used'); return; }
  qpCancelLock();
  if (qpHeld === null) {
    qpHeld = qpPiece.key; qpSpawnNext();
  } else {
    const t = qpHeld; qpHeld = qpPiece.key;
    qpPiece = mkPiece(t);
    if (collide(qpPiece.shape, qpPiece.x, qpPiece.y, qpGrid)) { qpTopOut(); return; }
  }
  qpHoldUsed = true; qpDrawHold();
}

// ── Hard drop ─────────────────────────────────────────────────────────────────
export function qpHardDrop() {
  if (!qpRunning || !qpPiece || !qpAlive) return;
  playSfx('harddrop.wav'); qpCancelLock();
  _qpBounceImpulse(0, 1.8);
  if (cfg.dropTrailIntensity > 0) {
    const destY = qpGhostY();
    const dist  = destY - qpPiece.y;
    if (dist > 0) {
      const now    = performance.now();
      const color  = pieceColors[qpPiece.key];
      const leftX  = qpPiece.x * SZ;
      const rightX = (qpPiece.x + qpPiece.shape[0].length) * SZ;
      const y1px   = qpPiece.y * SZ;
      const y2px   = destY * SZ;
      _qpDropLines.push({ x: leftX,  y1: y1px, y2: y2px, color, side: -1, t: now });
      _qpDropLines.push({ x: rightX, y1: y1px, y2: y2px, color, side:  1, t: now });
    }
  }
  if (cfg.motionBlurTrail > 0) {
    const now  = performance.now();
    const dest = qpGhostY();
    const dist = dest - qpPiece.y;
    if (dist > 0) {
      const maxEntries = cfg.motionBlurTrail + 2;
      const step = Math.max(1, Math.floor(dist / maxEntries));
      for (let dy = 0; dy < dist; dy += step) {
        _qpMotionTrail.unshift({ x: qpPiece.x, y: qpPiece.y + dy, shape: qpPiece.shape.map(r => [...r]), key: qpPiece.key, t: now - (dist - dy) * 4, hardDrop: true });
      }
      if (_qpMotionTrail.length > maxEntries) _qpMotionTrail.length = maxEntries;
    }
  }
  qpPiece.y = qpGhostY();
  qpDoLock();
}

// ── Spin detection ────────────────────────────────────────────────────────────
function qpIsSpin() {
  return collide(qpPiece.shape, qpPiece.x - 1, qpPiece.y,     qpGrid) &&
         collide(qpPiece.shape, qpPiece.x + 1, qpPiece.y,     qpGrid) &&
         collide(qpPiece.shape, qpPiece.x,     qpPiece.y - 1, qpGrid);
}

// ── Attack calculation ────────────────────────────────────────────────────────
function qpBaseAtk(n, spin) { return spin ? [0,2,4,7][Math.min(n,3)] : [0,0.5,1,2,4][Math.min(n,4)]; }
function qpB2bBonus(b) {
  if (b<=2) return 0; if (b<=5) return 1; if (b<=10) return 2;
  if (b<=20) return 3; if (b<=50) return 4; if (b<=100) return 5; return 6;
}

// ── Clear lines ───────────────────────────────────────────────────────────────
function qpClearLines(spin, key) {
  let reg = 0, garb = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (qpGrid[r].every(c => c)) {
      if (qpGrid[r].some(c => c === '#444455')) garb++;
      else reg++;
      qpGrid.splice(r, 1); qpGrid.unshift(Array(COLS).fill(null)); r++;
    }
  }
  const total = reg + garb;
  if (total > 0) _qpClimbSpeed += total * 0.1;

  if (total === 0) {
    qpCombo = 0;
    if (spin) showSplash('qp-board-wrap', '', key, true, 'left');
    updateCounters('qp-board-wrap', 0, qpB2b);
    return;
  }

  const empty   = qpGrid.every(row => row.every(c => !c));
  const perfect = empty && garb === 0;
  const colored = empty && garb > 0;
  const b2bElig = total >= 4 || spin;

  let base = 0;
  if (perfect)      base = 10;
  else if (colored) base = 5;
  else              base = qpBaseAtk(total, spin) + (b2bElig ? qpB2bBonus(qpB2b) : 0);

  const attack = Math.floor(base * (1 + 0.2 * qpCombo));

  if (b2bElig || perfect || colored) qpB2b++;
  else qpB2b = 0;
  playLineClearTone(qpCombo, total, spin);
  qpCombo++;
  updateCounters('qp-board-wrap', qpCombo, qpB2b);

  if (attack > 0) {
    _qpClimbSpeed += attack * 0.1;
    const inCombo = qpCombo >= 2;
    showAttackSplash('qp-board-wrap', attack, null, inCombo);
    if (inCombo) {
      sendQpAttack(attack);
    } else {
      _qpAtkBuf += attack;
      flushQpAttack();
    }
  }

  const lbl = perfect ? 'PERFECT CLEAR' : colored ? 'COLORED CLEAR'
    : ['','SINGLE','DOUBLE','TRIPLE','QUAD'][Math.min(total,4)];
  showSplash('qp-board-wrap', lbl, key, spin, 'left');
}

// ── Lock ──────────────────────────────────────────────────────────────────────
function qpDoLock() {
  const spin = qpIsSpin(), lockedKey = qpPiece.key;
  for (let r = 0; r < qpPiece.shape.length; r++) {
    for (let c = 0; c < qpPiece.shape[r].length; c++) {
      if (!qpPiece.shape[r][c]) continue;
      const row = qpPiece.y + r, col = qpPiece.x + c;
      if (row < 0) { qpTopOut(); return; }
      qpGrid[row][col] = cfg.invisibleLocked ? '__inv__' : pieceColors[qpPiece.key];
    }
  }
  qpApplyGarbage();
  qpClearLines(spin, lockedKey);
  qpSpawnNext();
  qpHoldUsed = false;
}

// ── Garbage ───────────────────────────────────────────────────────────────────
function qpApplyGarbage() {
  if (!qpGarbage.length) return;
  const seg  = qpGarbage.shift();
  qpLastKiller = seg.from;
  const hole = Math.floor(Math.random() * COLS);
  for (let i = 0; i < seg.lines; i++) {
    qpGrid.shift();
    const row = Array(COLS).fill('#444455'); row[hole] = null;
    qpGrid.push(row);
  }
  updateGarbageBar('qp-garbage-bar', qpGarbage.map(g => g.lines));
}

// ── Spawn ─────────────────────────────────────────────────────────────────────
function qpSpawnNext() {
  qpPiece = mkPiece(qpDequeue());
  qpDropAcc = 0; qpLockMoves = 0;
  if (collide(qpPiece.shape, qpPiece.x, qpPiece.y, qpGrid)) { qpTopOut(); return; }
  qpOnMove();
  qpDrawPreviews();
  schedQpSync();
}

// ── Top out ───────────────────────────────────────────────────────────────────
function qpTopOut() {
  stopMusic();
  qpAlive = false;
  const ov = document.getElementById('qp-dead-overlay');
  ov.style.display = 'flex';
  document.getElementById('qp-dead-score').textContent = qpScore.toFixed(1);
  const socket = getSocket();
  if (socket) {
    socket.emit('qp:topOut', {
      username: qpMyUsername,
      score: parseFloat(qpScore.toFixed(1)),
      alive: false,
      killedBy: qpLastKiller || null,
      lastSeen: Date.now()
    });
  }
}

// ── Target calculation ────────────────────────────────────────────────────────
function getQpTarget() {
  const now = Date.now();
  const alive = Object.entries(otherPlayers)
    .filter(([, p]) => p.alive !== false && now - (p.lastSeen || 0) < 30000)
    .map(([uid, p]) => ({ uid, score: p.score || 0, speed: p.speed || 0.1 }));
  if (!alive.length) return null;

  // Sort by score to find rank neighbors
  const all = [...alive, { uid: qpMyUid, score: qpScore, speed: _qpClimbSpeed }]
    .sort((a, b) => a.score - b.score);
  const myIdx = all.findIndex(p => p.uid === qpMyUid);

  // 5 nearest below + 5 nearest above in score rank (up to 10 candidates)
  const candidates = [
    ...all.slice(Math.max(0, myIdx - 5), myIdx),
    ...all.slice(myIdx + 1, myIdx + 6),
  ];
  if (!candidates.length) return null;

  // Weighted random: higher climb speed = higher probability of being targeted
  const weights = candidates.map(p => Math.max(p.speed, 0.1));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i].uid;
  }
  return candidates[candidates.length - 1].uid;
}

function flushQpAttack() {
  _qpAtkFlushTimer = null;
  if (!qpAlive || _qpAtkBuf <= 0) { _qpAtkBuf = 0; return; }
  const target = getQpTarget();
  if (target) {
    const socket = getSocket();
    if (socket) socket.emit('qp:sendAttack', { targetId: target, lines: _qpAtkBuf });
  }
  _qpAtkBuf = 0;
}

function sendQpAttack(lines) {
  _qpAtkBuf += lines;
  if (!_qpAtkFlushTimer) _qpAtkFlushTimer = setTimeout(flushQpAttack, 150);
}

// ── Socket sync (throttled 100ms) ─────────────────────────────────────────────
function schedQpSync() {
  if (qpSyncPending) return;
  qpSyncPending = true;
  setTimeout(() => {
    qpSyncPending = false;
    if (!qpAlive) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit('qp:syncBoard', {
      username: qpMyUsername,
      score:    parseFloat(qpScore.toFixed(1)),
      speed:    parseFloat(_qpClimbSpeed.toFixed(2)),
      alive:    true,
      next:     qpQueue.slice(0, 5),
      hold:     qpHeld || null,
      lastSeen: Date.now(),
      killedBy: null
    });
  }, 100);
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function updateQpPanel() {
  const el = document.getElementById('qp-players-list');
  if (!el || !qpMyUid) return;
  const now = Date.now();

  const all = [];
  for (const [uid, p] of Object.entries(otherPlayers)) {
    if (now - (p.lastSeen || 0) > 30000) continue;
    all.push({ uid, username: p.username || uid.slice(0, 8), score: p.score || 0, alive: p.alive !== false });
  }
  all.push({ uid: qpMyUid, username: qpMyUsername, score: parseFloat(qpScore.toFixed(1)), alive: qpAlive });
  all.sort((a, b) => b.score - a.score);

  const myRank = all.findIndex(p => p.uid === qpMyUid);

  function renderRow(p, rank) {
    const isSelf = p.uid === qpMyUid;
    return `<div class="qp-lb-row${isSelf ? ' qp-lb-self' : ''}${!p.alive ? ' qp-dead' : ''}">` +
      `<span class="qp-lb-rank">#${rank}</span>` +
      `<span class="qp-lb-name">${p.username}</span>` +
      `<span class="qp-player-score">${p.score.toFixed(1)}</span>` +
      `</div>`;
  }

  let html;
  if (myRank < 20) {
    html = all.slice(0, 20).map((p, i) => renderRow(p, i + 1)).join('');
  } else {
    const ctxStart = Math.max(10, Math.min(all.length - 10, myRank - 4));
    html = all.slice(0, 10).map((p, i) => renderRow(p, i + 1)).join('') +
      `<div class="qp-lb-divider"></div>` +
      all.slice(ctxStart, ctxStart + 10).map((p, i) => renderRow(p, ctxStart + i + 1)).join('');
  }
  el.innerHTML = html;
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
function qpDrawHold() {
  qpHoldCtx.globalAlpha = cfg.holdMode === 'none' ? 0.2 : 1;
  drawMini(qpHoldCtx, qpHeld, qpHoldEl.width, qpHoldEl.height);
  qpHoldCtx.globalAlpha = 1;
  qpHoldEl.style.opacity = qpHoldUsed ? '0.45' : '1';
}

function qpBuildPreviews() {
  const stack = document.getElementById('qp-preview-stack');
  stack.innerHTML = '';
  for (let i = 0; i < QP_PREVIEW; i++) {
    const c = document.createElement('canvas');
    c.width = 90; c.height = i === 0 ? 52 : 36; c.id = 'qp-prev-' + i;
    stack.appendChild(c);
  }
  setupLimbo(stack, QP_PREVIEW);
  qpDrawPreviews();
}

function qpDrawPreviews() {
  const q = limboQueue(qpQueue, QP_PREVIEW);
  for (let i = 0; i < QP_PREVIEW; i++) {
    const c = document.getElementById('qp-prev-' + i);
    if (c) drawMini(c.getContext('2d'), q[i] || null, c.width, c.height);
  }
}

// ── DAS / soft drop ───────────────────────────────────────────────────────────
function qpMoveH(dx) {
  if (!qpRunning || !qpPiece || !qpAlive) return;
  if (!collide(qpPiece.shape, qpPiece.x + dx, qpPiece.y, qpGrid)) { qpPiece.x += dx; playSfx('move.wav'); _qpBounceImpulse(dx, 0); qpOnMove(); }
}

export function qpStartDAS(dx) {
  qpStopDAS(); qpDasDir = dx; qpDasHeld = true; qpMoveH(dx);
  qpDasTimer = setTimeout(() => {
    if (!qpDasHeld) return;
    if (cfg.arr === 0) {
      let nx = qpPiece.x;
      while (!collide(qpPiece.shape, nx + dx, qpPiece.y, qpGrid)) nx += dx;
      qpPiece.x = nx; qpOnMove();
    } else {
      qpDasInterval = setInterval(() => { if (qpDasHeld) qpMoveH(qpDasDir); }, cfg.arr);
    }
  }, cfg.das);
}
export function qpStopDAS() {
  qpDasHeld = false;
  clearTimeout(qpDasTimer); clearInterval(qpDasInterval);
  qpDasTimer = qpDasInterval = null;
}

export function qpStartSD() {
  if (qpSdActive) return; qpSdActive = true;
  const iv = Math.max(33, ((0.8 - (qpLevel-1)*0.007)**(qpLevel-1)) * 1000);
  if (cfg.sdf === 41) { qpPiece.y = qpGhostY(); qpOnMove(); qpSdActive = false; return; }
  if (!collide(qpPiece.shape, qpPiece.x, qpPiece.y+1, qpGrid)) { qpPiece.y++; qpOnMove(); }
  qpSdInterval = setInterval(() => {
    if (!qpRunning || !qpAlive) { qpStopSD(); return; }
    if (!collide(qpPiece.shape, qpPiece.x, qpPiece.y+1, qpGrid)) { qpPiece.y++; qpOnMove(); }
  }, Math.max(1, iv / cfg.sdf));
}
export function qpStopSD() { qpSdActive = false; clearInterval(qpSdInterval); qpSdInterval = null; }

// ── Game loop ─────────────────────────────────────────────────────────────────
function qpLoop(ts) {
  if (!qpRunning) return;
  const dt = Math.min(ts - qpLastTime, 100);
  qpLastTime = ts;

  if (qpAlive) {
    _qpClimbSpeed *= Math.pow(0.90, dt / 1000);
    if (_qpClimbSpeed < 0.1) _qpClimbSpeed = 0.1;
    qpScore += _qpClimbSpeed * (dt / 1000);

    _qpUpdateClimbBar(_qpClimbSpeed);

    if (!qpGrounded()) {
      qpDropAcc += dt;
      const iv = Math.max(33, ((0.8-(qpLevel-1)*0.007)**(qpLevel-1))*1000);
      if (qpDropAcc >= iv) { qpDropAcc = 0; qpPiece.y++; qpOnMove(); }
    }
  }

  const { circleGrid, circlePiece } = getCircleOffsets(ts);

  const curPiece = qpAlive ? qpPiece : null;
  let motionTrail = null;
  if (cfg.motionBlurTrail > 0 && curPiece) {
    const now = performance.now();
    const trailDuration = cfg.motionBlurTrail * 40;
    const maxEntries    = cfg.motionBlurTrail + 2;
    if (_qpPrevPiece && (_qpPrevPiece.x !== curPiece.x || _qpPrevPiece.y !== curPiece.y)) {
      _qpMotionTrail.unshift({ x: _qpPrevPiece.x, y: _qpPrevPiece.y, shape: _qpPrevPiece.shape, key: curPiece.key, t: now });
      if (_qpMotionTrail.length > maxEntries) _qpMotionTrail.pop();
    }
    _qpMotionTrail = _qpMotionTrail.filter(e => now - e.t < trailDuration);
    _qpPrevPiece = { x: curPiece.x, y: curPiece.y, shape: curPiece.shape.map(r => [...r]) };
    if (_qpMotionTrail.length > 0) {
      const intensityMult = cfg.motionBlurIntensity / 5;
      motionTrail = _qpMotionTrail.map(e => {
        const t = Math.min(1, (now - e.t) / trailDuration);
        return { ...e, alpha: Math.pow(1 - t, 1.4) * 0.55 * intensityMult, blur: t * SZ * 0.9 };
      });
    }
  } else {
    _qpPrevPiece = null;
  }

  let dropLines = null;
  if (_qpDropLines.length > 0) {
    const now = performance.now();
    const dur = 420;
    _qpDropLines = _qpDropLines.filter(dl => now - dl.t < dur);
    if (_qpDropLines.length > 0) {
      const intensityMult = cfg.dropTrailIntensity / 5;
      dropLines = _qpDropLines.map(dl => ({
        ...dl, alpha: Math.pow(1 - (now - dl.t) / dur, 1.6) * 0.85 * intensityMult,
      }));
    }
  }

  qpBrd.draw({
    grid: qpGrid, piece: curPiece,
    ghostY:      (qpAlive && qpPiece && cfg.ghostOpacity > 0) ? qpGhostY() : null,
    lockFlashing: qpLockFlashing, lockBright: qpLockBright,
    ghostOpacity: cfg.ghostOpacity,
    gridOn: cfg.gridOn, gridColor: cfg.gridColor, gridWidth: cfg.gridWidth,
    circleGrid, circlePiece, motionTrail, dropLines,
  });
  _qpSpringStep();
  qpDrawPreviews();
  qpDrawHold();

  document.getElementById('qp-score-val').textContent = qpScore.toFixed(1);
  const tUid  = getQpTarget();
  const tName = (tUid && otherPlayers[tUid]?.username) || (tUid ? '...' : '—');
  document.getElementById('qp-target-val').textContent = tName;

  if (ts - _qpLastSyncTs > 2000) { _qpLastSyncTs = ts; schedQpSync(); }
  qpRafId = requestAnimationFrame(qpLoop);
}

// ── Start ─────────────────────────────────────────────────────────────────────
export function startQpGame() {
  const user   = currentUser();
  const socket = getSocket();
  if (!socket) { showToast('Not connected'); return; }

  if (user) {
    qpMyUid      = user.uid;
    qpMyUsername = currentUsername() || user.email;
  } else {
    const rnd    = String(Math.floor(10000000 + Math.random() * 90000000));
    qpMyUid      = 'anon_' + rnd;
    qpMyUsername = 'Player ' + rnd;
  }

  qpGrid = mkGrid(); qpBag = []; qpQueue = [];
  qpHeld = null; qpHoldUsed = false; qpPiece = null;
  qpScore = 0; qpAlive = true; _qpClimbSpeed = 0.1;
  qpCombo = 0; qpB2b = 0;
  qpGarbage = []; qpLastKiller = null; qpKoSet = new Set();
  qpLevel = 1; qpDropAcc = 0;
  qpCancelLock();
  otherPlayers = {};
  _qpAtkBuf = 0; if (_qpAtkFlushTimer) { clearTimeout(_qpAtkFlushTimer); _qpAtkFlushTimer = null; }
  _qpLastSyncTs = 0;
  _qpBx = 0; _qpBy = 0; _qpBoardWrap.style.transform = '';
  _qpDropLines = []; _qpMotionTrail = []; _qpPrevPiece = null;

  clearAttackSplash('qp-board-wrap');
  updateCounters('qp-board-wrap', 0, 0);
  updateGarbageBar('qp-garbage-bar', []);
  document.getElementById('qp-dead-overlay').style.display = 'none';
  updateQpPanel();

  // Remove stale listeners before re-joining
  socket.off('qp:players');
  socket.off('qp:attack');

  // Listen for player list updates
  socket.on('qp:players', data => {
    const now = Date.now();
    otherPlayers = {};
    for (const [uid, p] of Object.entries(data)) {
      if (uid === qpMyUid) continue;
      if (now - (p.lastSeen || 0) > 30000) continue;
      otherPlayers[uid] = p;
      if (p.killedBy === qpMyUid && p.alive === false && !qpKoSet.has(uid)) {
        qpKoSet.add(uid);
        qpScore += 15;
      }
    }
    updateQpPanel();
  });

  // Listen for incoming attacks
  socket.on('qp:attack', ({ from, lines }) => {
    qpGarbage.push({ lines, from });
    updateGarbageBar('qp-garbage-bar', qpGarbage.map(g => g.lines));
  });

  // Tell server we're joining
  socket.emit('qp:join', { uid: qpMyUid, username: qpMyUsername }, res => {
    if (res?.error) showToast('QP join failed: ' + res.error);
  });

  qpEnsureQueue();
  qpBuildPreviews();
  qpDrawHold();
  qpBrd.draw({ grid: qpGrid, piece: null, ghostY: null, lockFlashing: false, lockBright: true,
    ghostOpacity: 0, gridOn: true, gridColor: cfg.gridColor, gridWidth: cfg.gridWidth });

  qpRunning = false;
  cancelAnimationFrame(qpRafId);
  showCountdown('qp-board-wrap', () => {
    // startMusic('music/aperture.wav');
    qpSpawnNext();
    qpRunning = true;
    qpLastTime = performance.now();
    qpRafId = requestAnimationFrame(qpLoop);
  });
}

// ── Stop / Leave ──────────────────────────────────────────────────────────────
export function stopQpGame() {
  stopMusic();
  qpRunning = false;
  cancelAnimationFrame(qpRafId);
  qpCancelLock(); qpStopDAS(); qpStopSD();
  _qpAtkBuf = 0; if (_qpAtkFlushTimer) { clearTimeout(_qpAtkFlushTimer); _qpAtkFlushTimer = null; }
  const socket = getSocket();
  if (socket) {
    socket.off('qp:players');
    socket.off('qp:attack');
    socket.emit('qp:leave');
  }
}
