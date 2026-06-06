// Quick Play — always-open ranked free-for-all
// Firebase paths:
//   quickplay/players/{uid}         — own state (own uid write, all read)
//   quickplay/attacks/{targetUid}/  — any auth user writes, only target reads & consumes

import { COLS, ROWS, SZ, LOCK_DELAY, LOCK_FLASH, ROTATIONS, SRS, SRS_I } from './constants.js';
import { cfg, pieceColors } from './state.js';
import { mkGrid, mkPiece, collide, fillBag } from './pieces.js';
import {
  showToast, showAttackSplash, clearAttackSplash,
  showSplash, updateCounters, updateGarbageBar, drawMini, showCountdown
} from './ui.js';
import { createBoard } from './board.js';
import { db } from './firebase.js';
import { currentUser, currentUsername } from './account.js';
import { ref, set, push, remove, onValue, onChildAdded, onDisconnect }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const QP_PREVIEW = 5;
const QP_ROOT    = 'quickplay';

// ── Canvas setup (module-level, elements always present) ──────────────────
const qpBoardEl = document.getElementById('qp-board');
const qpBrd     = createBoard(qpBoardEl, SZ);
const qpHoldEl  = document.getElementById('qp-hold-canvas');
const qpHoldCtx = qpHoldEl.getContext('2d');

// ── Game state ────────────────────────────────────────────────────────────
export let qpRunning = false;
export let qpPiece   = null;

let qpGrid, qpBag, qpQueue, qpHeld, qpHoldUsed;
let qpScore, qpScoreAccum, qpAlive;
let qpCombo, qpB2b;
let qpGarbage, qpLastKiller, qpKoSet;
let qpLevel, qpDropAcc;
let qpRafId, qpLastTime;
let qpLockTimer = null, qpLockFlashTimer = null;
let qpLockFlashing = false, qpLockBright = true, qpLockMoves = 0;

// ── DAS / soft drop ───────────────────────────────────────────────────────
let qpDasTimer = null, qpDasInterval = null, qpDasDir = 0, qpDasHeld = false;
let qpSdActive = false, qpSdInterval = null;

// ── Firebase ──────────────────────────────────────────────────────────────
let qpMyUid = null, qpMyUsername = null;
let qpMyRef = null;
let qpPlayersUnsub = null, qpAttacksUnsub = null;
let qpSyncPending = false;
let otherPlayers = {};

// ── Queue ─────────────────────────────────────────────────────────────────
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

// ── Physics helpers ───────────────────────────────────────────────────────
function qpGrounded() { return qpPiece && collide(qpPiece.shape, qpPiece.x, qpPiece.y + 1, qpGrid); }
function qpGhostY()   { let g = qpPiece.y; while (!collide(qpPiece.shape, qpPiece.x, g + 1, qpGrid)) g++; return g; }

// ── Lock delay ────────────────────────────────────────────────────────────
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

// ── Rotation ──────────────────────────────────────────────────────────────
export function qpTryRotate(ccw = false) {
  if (!qpRunning || !qpPiece || !qpAlive) return;
  const nr  = ((qpPiece.rot + (ccw ? -1 : 1)) + 4) % 4;
  const ns  = ROTATIONS[qpPiece.key][nr].map(r => [...r]);
  const dir = `${qpPiece.rot}>>${nr}`;
  if (!collide(ns, qpPiece.x, qpPiece.y, qpGrid)) { qpPiece.shape = ns; qpPiece.rot = nr; qpOnMove(); return; }
  if (cfg.kicks === 'none') return;
  const table = qpPiece.key === 'I' ? SRS_I : SRS;
  for (const [dx, dy] of (table[dir] || []).slice(1)) {
    if (!collide(ns, qpPiece.x + dx, qpPiece.y - dy, qpGrid)) {
      qpPiece.shape = ns; qpPiece.rot = nr; qpPiece.x += dx; qpPiece.y -= dy; qpOnMove(); return;
    }
  }
}

export function qpTryRotate180() {
  if (!qpRunning || !qpPiece || !qpAlive) return;
  const nr = (qpPiece.rot + 2) % 4;
  const ns = ROTATIONS[qpPiece.key][nr].map(r => [...r]);
  if (!collide(ns, qpPiece.x, qpPiece.y, qpGrid)) { qpPiece.shape = ns; qpPiece.rot = nr; qpOnMove(); return; }
  if (cfg.kicks === 'none') return;
  for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]) {
    if (!collide(ns, qpPiece.x + dx, qpPiece.y - dy, qpGrid)) {
      qpPiece.shape = ns; qpPiece.rot = nr; qpPiece.x += dx; qpPiece.y -= dy; qpOnMove(); return;
    }
  }
}

// ── Hold ──────────────────────────────────────────────────────────────────
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

// ── Hard drop ─────────────────────────────────────────────────────────────
export function qpHardDrop() {
  if (!qpRunning || !qpPiece || !qpAlive) return;
  qpCancelLock();
  qpPiece.y = qpGhostY();
  qpDoLock();
}

// ── Spin detection ────────────────────────────────────────────────────────
function qpIsSpin() {
  return collide(qpPiece.shape, qpPiece.x - 1, qpPiece.y,     qpGrid) &&
         collide(qpPiece.shape, qpPiece.x + 1, qpPiece.y,     qpGrid) &&
         collide(qpPiece.shape, qpPiece.x,     qpPiece.y - 1, qpGrid);
}

// ── Attack calculation ────────────────────────────────────────────────────
function qpBaseAtk(n, spin) { return spin ? [0,2,4,7][Math.min(n,3)] : [0,0.5,1,2,4][Math.min(n,4)]; }
function qpB2bBonus(b) {
  if (b<=2) return 0; if (b<=5) return 1; if (b<=10) return 2;
  if (b<=20) return 3; if (b<=50) return 4; if (b<=100) return 5; return 6;
}

// ── Clear lines ───────────────────────────────────────────────────────────
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

  // QP scoring: +1 per regular line, +0.5 per garbage line cleared
  qpScore += reg * 1 + garb * 0.5;

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
  qpCombo++;
  updateCounters('qp-board-wrap', qpCombo, qpB2b);

  if (attack > 0) {
    showAttackSplash('qp-board-wrap', attack);
    sendQpAttack(attack);
  }

  const lbl = perfect ? 'PERFECT CLEAR' : colored ? 'COLORED CLEAR'
    : ['','SINGLE','DOUBLE','TRIPLE','QUAD'][Math.min(total,4)];
  showSplash('qp-board-wrap', lbl, key, spin, 'left');
}

// ── Lock ──────────────────────────────────────────────────────────────────
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

// ── Garbage application ───────────────────────────────────────────────────
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

// ── Spawn ─────────────────────────────────────────────────────────────────
function qpSpawnNext() {
  qpPiece = mkPiece(qpDequeue());
  qpDropAcc = 0; qpLockMoves = 0;
  if (collide(qpPiece.shape, qpPiece.x, qpPiece.y, qpGrid)) { qpTopOut(); return; }
  qpOnMove();
  qpDrawPreviews();
  schedQpSync();
}

// ── Top out ───────────────────────────────────────────────────────────────
function qpTopOut() {
  qpAlive = false;
  const ov = document.getElementById('qp-dead-overlay');
  ov.style.display = 'flex';
  document.getElementById('qp-dead-score').textContent = qpScore.toFixed(1);
  if (qpMyRef) {
    set(qpMyRef, {
      username: qpMyUsername,
      score: parseFloat(qpScore.toFixed(1)),
      alive: false,
      killedBy: qpLastKiller || null,
      lastSeen: Date.now()
    });
  }
}

// ── Target calculation ────────────────────────────────────────────────────
function getQpTarget() {
  const now   = Date.now();
  const alive = Object.entries(otherPlayers)
    .filter(([, p]) => p.alive !== false && now - (p.lastSeen || 0) < 30000)
    .map(([uid, p]) => ({ uid, score: p.score || 0 }));

  if (!alive.length) return null;

  const all = [...alive, { uid: qpMyUid, score: qpScore }]
    .sort((a, b) => a.score - b.score);
  const i = all.findIndex(p => p.uid === qpMyUid);

  // Highest score → target player just below; otherwise → target player just above
  return i === all.length - 1
    ? (i > 0 ? all[i - 1].uid : null)
    : all[i + 1].uid;
}

// ── Send attack ───────────────────────────────────────────────────────────
async function sendQpAttack(lines) {
  if (!db) return;
  const target = getQpTarget();
  if (!target) return;
  try { await push(ref(db, `${QP_ROOT}/attacks/${target}`), { from: qpMyUid, lines }); }
  catch(e) {}
}

// ── Firebase sync (throttled 100ms) ──────────────────────────────────────
function schedQpSync() {
  if (qpSyncPending) return;
  qpSyncPending = true;
  setTimeout(() => {
    qpSyncPending = false;
    if (!qpMyRef || !qpAlive) return;
    set(qpMyRef, {
      username: qpMyUsername,
      score:    parseFloat(qpScore.toFixed(1)),
      alive:    true,
      next:     qpQueue.slice(0, 5),
      hold:     qpHeld || null,
      lastSeen: Date.now(),
      killedBy: null
    });
  }, 100);
}

// ── Players panel ─────────────────────────────────────────────────────────
function updateQpPanel() {
  const el = document.getElementById('qp-players-list');
  if (!el) return;
  const target = getQpTarget();
  const now    = Date.now();
  const entries = Object.entries(otherPlayers)
    .filter(([, p]) => now - (p.lastSeen || 0) < 30000)
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

  el.innerHTML = entries.map(([uid, p]) => {
    const alive    = p.alive !== false;
    const targeted = uid === target;
    return `<div class="qp-player-item${alive ? '' : ' qp-dead'}${targeted ? ' qp-targeted' : ''}">
      <span class="qp-player-name">${p.username || uid.slice(0,8)}</span>
      <span class="qp-player-score">${(p.score||0).toFixed(1)}</span>
    </div>`;
  }).join('') || '<div style="font-size:11px;color:var(--muted);padding:8px 6px;">No other players</div>';
}

// ── Draw helpers ──────────────────────────────────────────────────────────
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
  qpDrawPreviews();
}

function qpDrawPreviews() {
  for (let i = 0; i < QP_PREVIEW; i++) {
    const c = document.getElementById('qp-prev-' + i);
    if (c) drawMini(c.getContext('2d'), qpQueue[i] || null, c.width, c.height);
  }
}

// ── DAS / soft drop ───────────────────────────────────────────────────────
function qpMoveH(dx) {
  if (!qpRunning || !qpPiece || !qpAlive) return;
  if (!collide(qpPiece.shape, qpPiece.x + dx, qpPiece.y, qpGrid)) { qpPiece.x += dx; qpOnMove(); }
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

// ── Game loop ─────────────────────────────────────────────────────────────
function qpLoop(ts) {
  if (!qpRunning) return;
  const dt = Math.min(ts - qpLastTime, 100);
  qpLastTime = ts;

  if (qpAlive) {
    // Passive score: +0.1 per second
    qpScoreAccum += dt;
    while (qpScoreAccum >= 1000) { qpScore += 0.1; qpScoreAccum -= 1000; }

    // Gravity (leveled)
    if (!qpGrounded()) {
      qpDropAcc += dt;
      const iv = Math.max(33, ((0.8-(qpLevel-1)*0.007)**(qpLevel-1))*1000);
      if (qpDropAcc >= iv) { qpDropAcc = 0; qpPiece.y++; qpOnMove(); }
    }
  }

  qpBrd.draw({
    grid: qpGrid, piece: qpAlive ? qpPiece : null,
    ghostY:      (qpAlive && qpPiece && cfg.ghostOpacity > 0) ? qpGhostY() : null,
    lockFlashing: qpLockFlashing, lockBright: qpLockBright,
    ghostOpacity: cfg.ghostOpacity,
    gridOn: cfg.gridOn, gridColor: cfg.gridColor, gridWidth: cfg.gridWidth,
  });
  qpDrawPreviews();
  qpDrawHold();

  document.getElementById('qp-score-val').textContent = qpScore.toFixed(1);
  const tUid  = getQpTarget();
  const tName = (tUid && otherPlayers[tUid]?.username) || (tUid ? '...' : '—');
  document.getElementById('qp-target-val').textContent = tName;

  schedQpSync();
  qpRafId = requestAnimationFrame(qpLoop);
}

// ── Start ─────────────────────────────────────────────────────────────────
export function startQpGame() {
  const user = currentUser();
  if (!user || !db) { showToast('Sign in required'); return; }

  qpMyUid      = user.uid;
  qpMyUsername = currentUsername() || user.email;

  qpGrid = mkGrid(); qpBag = []; qpQueue = [];
  qpHeld = null; qpHoldUsed = false; qpPiece = null;
  qpScore = 0; qpScoreAccum = 0; qpAlive = true;
  qpCombo = 0; qpB2b = 0;
  qpGarbage = []; qpLastKiller = null; qpKoSet = new Set();
  qpLevel = 1; qpDropAcc = 0;
  qpCancelLock();
  otherPlayers = {};

  clearAttackSplash('qp-board-wrap');
  updateCounters('qp-board-wrap', 0, 0);
  updateGarbageBar('qp-garbage-bar', []);
  document.getElementById('qp-dead-overlay').style.display = 'none';
  document.getElementById('qp-players-list').innerHTML = '';

  // Own presence in Firebase
  qpMyRef = ref(db, `${QP_ROOT}/players/${qpMyUid}`);
  onDisconnect(qpMyRef).remove();

  // Listen to all players
  if (qpPlayersUnsub) { qpPlayersUnsub(); qpPlayersUnsub = null; }
  qpPlayersUnsub = onValue(ref(db, `${QP_ROOT}/players`), snap => {
    const data = snap.val() || {};
    const now  = Date.now();
    otherPlayers = {};
    for (const [uid, p] of Object.entries(data)) {
      if (uid === qpMyUid) continue;
      if (now - (p.lastSeen || 0) > 30000) continue; // skip stale
      otherPlayers[uid] = p;
      // KO bonus: +15 if someone died because of my garbage
      if (p.killedBy === qpMyUid && p.alive === false && !qpKoSet.has(uid)) {
        qpKoSet.add(uid);
        qpScore += 15;
      }
    }
    updateQpPanel();
  });

  // Listen for incoming attacks
  if (qpAttacksUnsub) { qpAttacksUnsub(); qpAttacksUnsub = null; }
  qpAttacksUnsub = onChildAdded(ref(db, `${QP_ROOT}/attacks/${qpMyUid}`), snap => {
    const atk = snap.val();
    if (!atk) return;
    qpGarbage.push({ lines: atk.lines, from: atk.from });
    updateGarbageBar('qp-garbage-bar', qpGarbage.map(g => g.lines));
    remove(snap.ref); // consume immediately
  });

  qpEnsureQueue();
  qpBuildPreviews();   // previews show queue before spawn
  qpDrawHold();
  // Draw empty board with gridlines visible behind countdown
  qpBrd.draw({ grid: qpGrid, piece: null, ghostY: null, lockFlashing: false, lockBright: true,
    ghostOpacity: 0, gridOn: true, gridColor: cfg.gridColor, gridWidth: cfg.gridWidth });

  qpRunning = false;
  cancelAnimationFrame(qpRafId);
  showCountdown('qp-board-wrap', () => {
    qpSpawnNext();      // first piece spawns when GO! fires
    qpRunning = true;
    qpLastTime = performance.now();
    qpRafId = requestAnimationFrame(qpLoop);
  });
}

// ── Stop / Leave ──────────────────────────────────────────────────────────
export function stopQpGame() {
  qpRunning = false;
  cancelAnimationFrame(qpRafId);
  qpCancelLock(); qpStopDAS(); qpStopSD();
  if (qpPlayersUnsub) { qpPlayersUnsub(); qpPlayersUnsub = null; }
  if (qpAttacksUnsub) { qpAttacksUnsub(); qpAttacksUnsub = null; }
  if (qpMyRef) { remove(qpMyRef); qpMyRef = null; }
}
