// mr.js — Custom Multi-Player Room (2–8 players)
// Firebase paths:
//   rooms_mr/{roomId}/players/{uid}        — own state
//   rooms_mr/{roomId}/attacks/{targetUid}/ — any player writes, only target reads & consumes

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
import { ref, set, get, push, remove, onValue, onChildAdded, onDisconnect, update, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const MR_ROOT    = 'rooms_mr';
const MR_PREVIEW = 5;

// ── Canvas setup ───────────────────────────────────────────────────────────────
const mrBoardEl = document.getElementById('mr-board');
const mrBrd     = createBoard(mrBoardEl, SZ);
const mrHoldEl  = document.getElementById('mr-hold-canvas');
const mrHoldCtx = mrHoldEl.getContext('2d');

// ── Room state ─────────────────────────────────────────────────────────────────
let mrRoomId     = null;
let mrMyUid      = null;
let mrMyUsername = null;
let mrIsOwner    = false;
let mrSettings   = { maxPlayers: 4, garbMult: 1.0 };
let mrGameId     = null;

let mrRoomUnsub    = null;
let mrAttacksUnsub = null;
let mrMyRef        = null;

// ── Game state ─────────────────────────────────────────────────────────────────
export let mrRunning = false;
export let mrPiece   = null;

let mrGrid, mrBag, mrQueue, mrHeld, mrHoldUsed;
let mrScore, mrScoreAccum, mrAlive, mrWon;
let mrCombo, mrB2b;
let mrGarbage, mrLastKiller, mrKoSet;
let mrLevel, mrDropAcc;
let mrRafId, mrLastTime;
let mrLockTimer = null, mrLockFlashTimer = null;
let mrLockFlashing = false, mrLockBright = true, mrLockMoves = 0;

let mrDasTimer = null, mrDasInterval = null, mrDasDx = 0, mrDasHeld = false;
let mrSdActive = false, mrSdInterval = null;

let mrSyncPending = false;
let mrPlayers = {};

function genCode() { return Math.random().toString(36).slice(2,8).toUpperCase(); }
function mrPlayerEntry() {
  return { username: mrMyUsername, alive: true, score: 0, next: [], hold: null, lastSeen: Date.now(), killedBy: null };
}

// ── Create / Join ──────────────────────────────────────────────────────────────
export async function createMrRoom() {
  const user = currentUser();
  if (!user) { showToast('Sign in to create a room'); return; }
  if (!db)   { showToast('Firebase not configured'); return; }

  mrMyUid      = user.uid;
  mrMyUsername = currentUsername() || user.email;
  mrRoomId     = genCode();
  mrIsOwner    = true;
  mrSettings   = { maxPlayers: 4, garbMult: 1.0 };
  mrGameId     = null;

  await set(ref(db, `${MR_ROOT}/${mrRoomId}`), {
    ownerId : mrMyUid,
    status  : 'waiting',
    settings: mrSettings,
    players : { [mrMyUid]: mrPlayerEntry() }
  });
  onDisconnect(ref(db, `${MR_ROOT}/${mrRoomId}/players/${mrMyUid}`)).remove();

  applyWaitRoom();
  listenRoom();
  window.showScreen('screen-mr-wait');
}

export async function joinMrRoom() {
  const user = currentUser();
  if (!user) { showToast('Sign in to join a room'); return; }
  if (!db)   { showToast('Firebase not configured'); return; }

  const code = (document.getElementById('mr-code-input').value || '').trim().toUpperCase();
  if (!code) { showToast('Enter a room code'); return; }

  let snap;
  try { snap = await get(ref(db, `${MR_ROOT}/${code}`)); }
  catch(e) { showToast('Network error'); return; }
  if (!snap.exists()) { showToast('Room not found'); return; }

  const data = snap.val();
  if (data.status !== 'waiting') { showToast('Game already started'); return; }
  const count = Object.keys(data.players || {}).length;
  const maxP  = (data.settings || {}).maxPlayers || 4;
  if (count >= maxP) { showToast('Room is full'); return; }

  mrMyUid      = user.uid;
  mrMyUsername = currentUsername() || user.email;
  mrRoomId     = code;
  mrIsOwner    = false;
  mrSettings   = data.settings || { maxPlayers: 4, garbMult: 1.0 };
  mrGameId     = null;

  await update(ref(db, `${MR_ROOT}/${mrRoomId}/players`), { [mrMyUid]: mrPlayerEntry() });
  onDisconnect(ref(db, `${MR_ROOT}/${mrRoomId}/players/${mrMyUid}`)).remove();

  applyWaitRoom();
  listenRoom();
  window.showScreen('screen-mr-wait');
}

// ── Waiting room UI ────────────────────────────────────────────────────────────
function applyWaitRoom() {
  document.getElementById('mr-wait-code').textContent   = mrRoomId;
  document.getElementById('mr-start-btn').style.display = mrIsOwner ? 'block' : 'none';
  document.getElementById('mr-wait-msg').textContent    = mrIsOwner
    ? 'You are the host. Configure settings and press Start.'
    : 'Waiting for the host to start the game…';
  const controls = document.querySelectorAll('.mr-setting-ctrl');
  controls.forEach(el => el.disabled = !mrIsOwner);
  applySettingsUI();
}

function applySettingsUI() {
  document.getElementById('mr-set-max').value  = mrSettings.maxPlayers;
  document.getElementById('mr-set-garb').value = mrSettings.garbMult;
}

export function onMrSettingChange() {
  if (!mrIsOwner || !db || !mrRoomId) return;
  mrSettings.maxPlayers = parseInt(document.getElementById('mr-set-max').value);
  mrSettings.garbMult   = parseFloat(document.getElementById('mr-set-garb').value);
  update(ref(db, `${MR_ROOT}/${mrRoomId}`), { settings: mrSettings });
}

function updateWaitPlayers(data) {
  const players = data.players || {};
  const maxP    = mrSettings.maxPlayers;
  document.getElementById('mr-wait-count').textContent = `${Object.keys(players).length} / ${maxP}`;

  const list = document.getElementById('mr-wait-players');
  list.innerHTML = '';
  Object.entries(players).forEach(([uid, p]) => {
    const div = document.createElement('div');
    div.className = 'mr-wait-player';
    let tags = '';
    if (uid === data.ownerId) tags += '<span class="mr-host-tag">HOST</span>';
    if (uid === mrMyUid)      tags += '<span class="mr-you-tag">YOU</span>';
    div.innerHTML = `<span class="mr-wait-name">${p.username || uid.slice(0,8)}</span>${tags}`;
    list.appendChild(div);
  });
}

// ── Start game (host only) ─────────────────────────────────────────────────────
export async function startMrGameFromHost() {
  if (!mrIsOwner || !db || !mrRoomId) return;
  const snap    = await get(ref(db, `${MR_ROOT}/${mrRoomId}/players`));
  const pCount  = Object.keys(snap.val() || {}).length;
  if (pCount < 2) { showToast('Need at least 2 players'); return; }
  const gameId  = genCode();
  await update(ref(db, `${MR_ROOT}/${mrRoomId}`), {
    status: 'playing', gameId, startTime: serverTimestamp()
  });
}

// ── Room listener ──────────────────────────────────────────────────────────────
function listenRoom() {
  if (mrRoomUnsub) { mrRoomUnsub(); mrRoomUnsub = null; }
  mrRoomUnsub = onValue(ref(db, `${MR_ROOT}/${mrRoomId}`), snap => {
    if (!snap.exists()) { leaveMrRoom(); return; }
    const data = snap.val();
    mrSettings = data.settings || mrSettings;

    if (!mrRunning) {
      updateWaitPlayers(data);
      applySettingsUI();
      if (data.status === 'playing' && data.gameId && data.gameId !== mrGameId) {
        mrGameId = data.gameId;
        enterMrGame();
      }
    } else {
      // Update player panel during game
      const players = data.players || {};
      for (const [uid, p] of Object.entries(players)) {
        if (uid === mrMyUid) continue;
        mrPlayers[uid] = p;
        if (p.killedBy === mrMyUid && p.alive === false && !mrKoSet.has(uid)) {
          mrKoSet.add(uid);
          mrScore += 15;
        }
      }
      updateMrPanel();
      checkMrWin();
    }
  });
}

// ── Enter game ─────────────────────────────────────────────────────────────────
function enterMrGame() {
  window.showScreen('screen-mr');
  initMrGame();
}

function initMrGame() {
  clearAttackSplash('mr-board-wrap');
  updateCounters('mr-board-wrap', 0, 0);
  updateGarbageBar('mr-garbage-bar', []);
  document.getElementById('mr-dead-overlay').style.display = 'none';
  document.getElementById('mr-win-overlay').style.display  = 'none';
  document.getElementById('mr-players-list').innerHTML     = '';

  mrGrid = mkGrid(); mrBag = []; mrQueue = [];
  mrHeld = null; mrHoldUsed = false; mrPiece = null;
  mrScore = 0; mrScoreAccum = 0; mrAlive = true; mrWon = false;
  mrCombo = 0; mrB2b = 0;
  mrGarbage = []; mrLastKiller = null; mrKoSet = new Set();
  mrLevel = 1; mrDropAcc = 0;
  mrPlayers = {};
  mrCancelLock();

  mrMyRef = ref(db, `${MR_ROOT}/${mrRoomId}/players/${mrMyUid}`);

  if (mrAttacksUnsub) { mrAttacksUnsub(); mrAttacksUnsub = null; }
  mrAttacksUnsub = onChildAdded(ref(db, `${MR_ROOT}/${mrRoomId}/attacks/${mrMyUid}`), snap => {
    const atk = snap.val();
    if (!atk) return;
    mrGarbage.push({ lines: atk.lines, from: atk.from });
    updateGarbageBar('mr-garbage-bar', mrGarbage.map(g => g.lines));
    remove(snap.ref);
  });

  mrEnsureQueue();
  mrBuildPreviews();   // previews show queue before spawn
  mrDrawHold();
  // Draw empty board with gridlines visible behind countdown
  mrBrd.draw({ grid: mrGrid, piece: null, ghostY: null, lockFlashing: false, lockBright: true,
    ghostOpacity: 0, gridOn: true, gridColor: cfg.gridColor, gridWidth: cfg.gridWidth });

  mrRunning = false;
  cancelAnimationFrame(mrRafId);
  showCountdown('mr-board-wrap', () => {
    mrSpawnNext();      // first piece spawns when GO! fires
    mrRunning  = true;
    mrLastTime = performance.now();
    mrRafId = requestAnimationFrame(mrLoop);
  });
}

// ── Queue ──────────────────────────────────────────────────────────────────────
function mrEnsureQueue() {
  while (mrBag.length < 14) fillBag(mrBag);
  while (mrQueue.length < MR_PREVIEW + 1) mrQueue.push(mrBag.shift());
}
function mrDequeue() {
  mrEnsureQueue();
  const k = mrQueue.shift();
  mrEnsureQueue();
  return k;
}

// ── Physics ────────────────────────────────────────────────────────────────────
function mrGrounded() { return mrPiece && collide(mrPiece.shape, mrPiece.x, mrPiece.y + 1, mrGrid); }
function mrGhostY()   { let g = mrPiece.y; while (!collide(mrPiece.shape, mrPiece.x, g + 1, mrGrid)) g++; return g; }

function mrSchedLock(isReset = false) {
  if (isReset && mrLockMoves >= 15) return;
  if (isReset) mrLockMoves++;
  mrCancelLock();
  mrLockFlashing = true; mrLockBright = true;
  mrLockFlashTimer = setInterval(() => { mrLockBright = !mrLockBright; }, LOCK_FLASH / 2);
  mrLockTimer = setTimeout(() => { mrCancelLock(); if (mrGrounded()) mrDoLock(); }, LOCK_DELAY);
}
function mrCancelLock(full = false) {
  clearTimeout(mrLockTimer); clearInterval(mrLockFlashTimer);
  mrLockTimer = mrLockFlashTimer = null;
  mrLockFlashing = false; mrLockBright = true;
  if (full) mrLockMoves = 0;
}
function mrOnMove() {
  if (mrGrounded()) mrSchedLock(mrLockTimer !== null);
  else mrCancelLock(true);
}

// ── Rotation / movement ────────────────────────────────────────────────────────
export function mrTryRotate(ccw = false) {
  if (!mrRunning || !mrPiece || !mrAlive) return;
  const nr  = ((mrPiece.rot + (ccw ? -1 : 1)) + 4) % 4;
  const ns  = ROTATIONS[mrPiece.key][nr].map(r => [...r]);
  const dir = `${mrPiece.rot}>>${nr}`;
  if (!collide(ns, mrPiece.x, mrPiece.y, mrGrid)) { mrPiece.shape = ns; mrPiece.rot = nr; mrOnMove(); return; }
  if (cfg.kicks === 'none') return;
  const table = mrPiece.key === 'I' ? SRS_I : SRS;
  for (const [dx, dy] of (table[dir] || []).slice(1)) {
    if (!collide(ns, mrPiece.x + dx, mrPiece.y - dy, mrGrid)) {
      mrPiece.shape = ns; mrPiece.rot = nr; mrPiece.x += dx; mrPiece.y -= dy; mrOnMove(); return;
    }
  }
}
export function mrTryRotate180() {
  if (!mrRunning || !mrPiece || !mrAlive) return;
  const nr = (mrPiece.rot + 2) % 4;
  const ns = ROTATIONS[mrPiece.key][nr].map(r => [...r]);
  if (!collide(ns, mrPiece.x, mrPiece.y, mrGrid)) { mrPiece.shape = ns; mrPiece.rot = nr; mrOnMove(); return; }
  if (cfg.kicks === 'none') return;
  for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]) {
    if (!collide(ns, mrPiece.x + dx, mrPiece.y - dy, mrGrid)) {
      mrPiece.shape = ns; mrPiece.rot = nr; mrPiece.x += dx; mrPiece.y -= dy; mrOnMove(); return;
    }
  }
}
function mrMoveH(dx) {
  if (!mrRunning || !mrPiece || !mrAlive) return;
  if (!collide(mrPiece.shape, mrPiece.x + dx, mrPiece.y, mrGrid)) { mrPiece.x += dx; mrOnMove(); }
}
export function mrHardDrop() {
  if (!mrRunning || !mrPiece || !mrAlive) return;
  mrCancelLock(); mrPiece.y = mrGhostY(); mrDoLock();
}
export function mrDoHold() {
  if (!mrRunning || !mrAlive) return;
  if (cfg.holdMode === 'none') return;
  if (cfg.holdMode === 'normal' && mrHoldUsed) { showToast('Hold used'); return; }
  mrCancelLock();
  if (mrHeld === null) {
    mrHeld = mrPiece.key; mrSpawnNext();
  } else {
    const t = mrHeld; mrHeld = mrPiece.key;
    mrPiece = mkPiece(t);
    if (collide(mrPiece.shape, mrPiece.x, mrPiece.y, mrGrid)) { mrTopOut(); return; }
  }
  mrHoldUsed = true; mrDrawHold();
}

// ── Spawn ──────────────────────────────────────────────────────────────────────
function mrSpawnNext() {
  mrPiece = mkPiece(mrDequeue());
  mrDropAcc = 0; mrLockMoves = 0;
  if (collide(mrPiece.shape, mrPiece.x, mrPiece.y, mrGrid)) { mrTopOut(); return; }
  mrOnMove(); mrDrawPreviews(); schedMrSync();
}

// ── Lock ───────────────────────────────────────────────────────────────────────
function mrDoLock() {
  const spin = mrIsSpin(), lockedKey = mrPiece.key;
  for (let r = 0; r < mrPiece.shape.length; r++) {
    for (let c = 0; c < mrPiece.shape[r].length; c++) {
      if (!mrPiece.shape[r][c]) continue;
      const row = mrPiece.y + r, col = mrPiece.x + c;
      if (row < 0) { mrTopOut(); return; }
      mrGrid[row][col] = cfg.invisibleLocked ? '__inv__' : pieceColors[mrPiece.key];
    }
  }
  mrApplyGarbage();
  mrClearLines(spin, lockedKey);
  mrSpawnNext();
  mrHoldUsed = false;
}
function mrIsSpin() {
  return collide(mrPiece.shape, mrPiece.x-1, mrPiece.y,   mrGrid) &&
         collide(mrPiece.shape, mrPiece.x+1, mrPiece.y,   mrGrid) &&
         collide(mrPiece.shape, mrPiece.x,   mrPiece.y-1, mrGrid);
}

// ── Garbage ────────────────────────────────────────────────────────────────────
function mrApplyGarbage() {
  if (!mrGarbage.length) return;
  const seg  = mrGarbage.shift();
  mrLastKiller = seg.from;
  const hole = Math.floor(Math.random() * COLS);
  for (let i = 0; i < seg.lines; i++) {
    mrGrid.shift();
    const row = Array(COLS).fill('#444455'); row[hole] = null;
    mrGrid.push(row);
  }
  updateGarbageBar('mr-garbage-bar', mrGarbage.map(g => g.lines));
}

// ── Clear lines ────────────────────────────────────────────────────────────────
function mrBaseAtk(n, spin) { return spin ? [0,2,4,7][Math.min(n,3)] : [0,0.5,1,2,4][Math.min(n,4)]; }
function mrB2bBonus(b) {
  if (b<=2) return 0; if (b<=5) return 1; if (b<=10) return 2;
  if (b<=20) return 3; if (b<=50) return 4; if (b<=100) return 5; return 6;
}

function mrClearLines(spin, key) {
  let reg = 0, garb = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (mrGrid[r].every(c => c)) {
      if (mrGrid[r].some(c => c === '#444455')) garb++;
      else reg++;
      mrGrid.splice(r, 1); mrGrid.unshift(Array(COLS).fill(null)); r++;
    }
  }
  const total = reg + garb;
  mrScore += reg * 1 + garb * 0.5;

  if (total === 0) {
    mrCombo = 0;
    if (spin) showSplash('mr-board-wrap', '', key, true, 'left');
    updateCounters('mr-board-wrap', 0, mrB2b);
    return;
  }

  const empty   = mrGrid.every(row => row.every(c => !c));
  const perfect = empty && garb === 0;
  const colored = empty && garb > 0;
  const b2bElig = total >= 4 || spin;

  let base = 0;
  if (perfect)      base = 10;
  else if (colored) base = 5;
  else              base = mrBaseAtk(total, spin) + (b2bElig ? mrB2bBonus(mrB2b) : 0);

  const mult   = mrSettings.garbMult || 1.0;
  const attack = Math.floor(base * (1 + 0.2 * mrCombo) * mult);

  if (b2bElig || perfect || colored) mrB2b++;
  else mrB2b = 0;
  mrCombo++;
  updateCounters('mr-board-wrap', mrCombo, mrB2b);

  if (attack > 0) {
    showAttackSplash('mr-board-wrap', attack);
    sendMrAttack(attack);
  }

  const lbl = perfect ? 'PERFECT CLEAR' : colored ? 'COLORED CLEAR'
    : ['','SINGLE','DOUBLE','TRIPLE','QUAD'][Math.min(total,4)];
  showSplash('mr-board-wrap', lbl, key, spin, 'left');
}

// ── Top out ────────────────────────────────────────────────────────────────────
function mrTopOut() {
  mrAlive = false;
  const ov = document.getElementById('mr-dead-overlay');
  ov.style.display = 'flex';
  document.getElementById('mr-dead-score').textContent = mrScore.toFixed(1);
  if (mrMyRef) {
    set(mrMyRef, {
      username: mrMyUsername,
      score:    parseFloat(mrScore.toFixed(1)),
      alive:    false,
      killedBy: mrLastKiller || null,
      lastSeen: Date.now()
    });
  }
}

// ── Win detection ──────────────────────────────────────────────────────────────
function checkMrWin() {
  if (!mrAlive || mrWon) return;
  const others = Object.entries(mrPlayers).filter(([, p]) => p.alive !== false);
  if (Object.keys(mrPlayers).length > 0 && others.length === 0) {
    mrWon = true;
    const ov = document.getElementById('mr-win-overlay');
    ov.style.display = 'flex';
    document.getElementById('mr-win-score').textContent = mrScore.toFixed(1);
  }
}

// ── Targeting (score-based, same as QP) ───────────────────────────────────────
function getMrTarget() {
  const now   = Date.now();
  const alive = Object.entries(mrPlayers)
    .filter(([, p]) => p.alive !== false && now - (p.lastSeen || 0) < 30000)
    .map(([uid, p]) => ({ uid, score: p.score || 0 }));
  if (!alive.length) return null;
  const all = [...alive, { uid: mrMyUid, score: mrScore }].sort((a, b) => a.score - b.score);
  const i   = all.findIndex(p => p.uid === mrMyUid);
  return i === all.length - 1 ? (i > 0 ? all[i-1].uid : null) : all[i+1].uid;
}

async function sendMrAttack(lines) {
  if (!db) return;
  const target = getMrTarget();
  if (!target) return;
  try { await push(ref(db, `${MR_ROOT}/${mrRoomId}/attacks/${target}`), { from: mrMyUid, lines }); }
  catch(e) {}
}

// ── Firebase sync (throttled 100ms) ───────────────────────────────────────────
function schedMrSync() {
  if (mrSyncPending) return;
  mrSyncPending = true;
  setTimeout(() => {
    mrSyncPending = false;
    if (!mrMyRef || !mrAlive) return;
    set(mrMyRef, {
      username: mrMyUsername,
      score:    parseFloat(mrScore.toFixed(1)),
      alive:    true,
      next:     mrQueue.slice(0, 5),
      hold:     mrHeld || null,
      lastSeen: Date.now(),
      killedBy: null
    });
  }, 100);
}

// ── Players panel ──────────────────────────────────────────────────────────────
function updateMrPanel() {
  const el = document.getElementById('mr-players-list');
  if (!el) return;
  const target = getMrTarget();
  const now    = Date.now();
  const sorted = Object.entries(mrPlayers)
    .filter(([, p]) => now - (p.lastSeen || 0) < 30000)
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

  el.innerHTML = sorted.map(([uid, p]) => {
    const alive    = p.alive !== false;
    const targeted = uid === target;
    return `<div class="qp-player-item${alive ? '' : ' qp-dead'}${targeted ? ' qp-targeted' : ''}">
      <span class="qp-player-name">${p.username || uid.slice(0,8)}</span>
      <span class="qp-player-score">${(p.score||0).toFixed(1)}</span>
    </div>`;
  }).join('') || '<div style="font-size:11px;color:var(--muted);padding:8px 6px;">Waiting for others…</div>';
}

// ── Draw helpers ───────────────────────────────────────────────────────────────
export function mrDrawHold() {
  mrHoldCtx.globalAlpha = cfg.holdMode === 'none' ? 0.2 : 1;
  drawMini(mrHoldCtx, mrHeld, mrHoldEl.width, mrHoldEl.height);
  mrHoldCtx.globalAlpha = 1;
  mrHoldEl.style.opacity = mrHoldUsed ? '0.45' : '1';
}
function mrBuildPreviews() {
  const stack = document.getElementById('mr-preview-stack');
  stack.innerHTML = '';
  for (let i = 0; i < MR_PREVIEW; i++) {
    const c = document.createElement('canvas');
    c.width = 90; c.height = i === 0 ? 52 : 36; c.id = 'mr-prev-' + i;
    stack.appendChild(c);
  }
  mrDrawPreviews();
}
function mrDrawPreviews() {
  for (let i = 0; i < MR_PREVIEW; i++) {
    const c = document.getElementById('mr-prev-' + i);
    if (c) drawMini(c.getContext('2d'), mrQueue[i] || null, c.width, c.height);
  }
}

// ── DAS / Soft drop ────────────────────────────────────────────────────────────
export function mrStartDAS(dx) {
  mrStopDAS(); mrDasDx = dx; mrDasHeld = true; mrMoveH(dx);
  mrDasTimer = setTimeout(() => {
    if (!mrDasHeld) return;
    if (cfg.arr === 0) {
      let nx = mrPiece.x;
      while (!collide(mrPiece.shape, nx + dx, mrPiece.y, mrGrid)) nx += dx;
      mrPiece.x = nx; mrOnMove();
    } else {
      mrDasInterval = setInterval(() => { if (mrDasHeld) mrMoveH(mrDasDx); }, cfg.arr);
    }
  }, cfg.das);
}
export function mrStopDAS() {
  mrDasHeld = false;
  clearTimeout(mrDasTimer); clearInterval(mrDasInterval);
  mrDasTimer = mrDasInterval = null;
}
export function mrStartSD() {
  if (mrSdActive) return; mrSdActive = true;
  const iv = Math.max(33, ((0.8-(mrLevel-1)*0.007)**(mrLevel-1))*1000);
  if (cfg.sdf === 41) { mrPiece.y = mrGhostY(); mrOnMove(); mrSdActive = false; return; }
  if (!collide(mrPiece.shape, mrPiece.x, mrPiece.y+1, mrGrid)) { mrPiece.y++; mrOnMove(); }
  mrSdInterval = setInterval(() => {
    if (!mrRunning || !mrAlive) { mrStopSD(); return; }
    if (!collide(mrPiece.shape, mrPiece.x, mrPiece.y+1, mrGrid)) { mrPiece.y++; mrOnMove(); }
  }, Math.max(1, iv / cfg.sdf));
}
export function mrStopSD() { mrSdActive = false; clearInterval(mrSdInterval); mrSdInterval = null; }

// ── Game loop ──────────────────────────────────────────────────────────────────
function mrLoop(ts) {
  if (!mrRunning) return;
  const dt = Math.min(ts - mrLastTime, 100);
  mrLastTime = ts;

  if (mrAlive) {
    mrScoreAccum += dt;
    while (mrScoreAccum >= 1000) { mrScore += 0.1; mrScoreAccum -= 1000; }

    if (!mrGrounded()) {
      mrDropAcc += dt;
      const iv = Math.max(33, ((0.8-(mrLevel-1)*0.007)**(mrLevel-1))*1000);
      if (mrDropAcc >= iv) { mrDropAcc = 0; mrPiece.y++; mrOnMove(); }
    }
  }

  mrBrd.draw({
    grid: mrGrid, piece: mrAlive ? mrPiece : null,
    ghostY:      (mrAlive && mrPiece && cfg.ghostOpacity > 0) ? mrGhostY() : null,
    lockFlashing: mrLockFlashing, lockBright: mrLockBright,
    ghostOpacity: cfg.ghostOpacity,
    gridOn: cfg.gridOn, gridColor: cfg.gridColor, gridWidth: cfg.gridWidth,
  });
  mrDrawPreviews();
  mrDrawHold();

  document.getElementById('mr-score-val').textContent = mrScore.toFixed(1);
  const tUid  = getMrTarget();
  const tName = (tUid && mrPlayers[tUid]?.username) || (tUid ? '…' : '—');
  document.getElementById('mr-target-val').textContent = tName;

  schedMrSync();
  mrRafId = requestAnimationFrame(mrLoop);
}

// ── Stop / Leave ───────────────────────────────────────────────────────────────
export function stopMrGame() {
  mrRunning = false;
  cancelAnimationFrame(mrRafId);
  mrCancelLock(); mrStopDAS(); mrStopSD();
  if (mrAttacksUnsub) { mrAttacksUnsub(); mrAttacksUnsub = null; }
  mrPiece = null;
}

export async function leaveMrRoom() {
  stopMrGame();
  if (mrRoomUnsub) { mrRoomUnsub(); mrRoomUnsub = null; }
  if (db && mrRoomId && mrMyUid) {
    if (mrIsOwner) {
      // Owner leaving closes the room
      remove(ref(db, `${MR_ROOT}/${mrRoomId}`)).catch(() => {});
    } else {
      update(ref(db, `${MR_ROOT}/${mrRoomId}/players`), { [mrMyUid]: null }).catch(() => {});
    }
  }
  mrRoomId = mrMyUid = null; mrIsOwner = false; mrMyRef = null;
  window.showScreen('screen-mr-lobby');
}
