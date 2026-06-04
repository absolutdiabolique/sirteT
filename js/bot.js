import { COLS, ROWS, VS_SZ, LOCK_DELAY, LOCK_FLASH, ROTATIONS, SRS, SRS_I } from './constants.js';
import { cfg, pieceColors } from './state.js';
import { mkGrid, mkPiece, collide, fillBag } from './pieces.js';
import { computeBestMove as computeBestMove1 } from './ai.js';


import { fmtTime, showToast, showSplash, showAttackSplash, clearAttackSplash, showCancelSplash, clearCancelSplash, updateGarbageBar, showRainbowSplash, updateCounters, drawMini, darken } from './ui.js';

let computeBestMove = computeBestMove1;

// Canvas refs
const myBoardEl  = document.getElementById('bot-my-board');
const myCtx      = myBoardEl.getContext('2d');
const oppBoardEl = document.getElementById('bot-opp-board');
const oppCtx     = oppBoardEl.getContext('2d');
const holdEl     = document.getElementById('bot-hold-canvas');
const holdCtx    = holdEl.getContext('2d');
const oppHoldEl  = document.getElementById('bot-opp-hold-canvas');
const oppHoldCtx = oppHoldEl.getContext('2d');

export let botRunning = false;
export let botRunLoop = false;
export let botPiece   = null; // player's active piece — exported so main.js can gate keyboard input

// ── Player state ──────────────────────────────────────────────
let pGrid, pPiece, pHeldKey, pHoldUsed;
let pBag = [], pQueue = [];
let pScore = 0, pLines = 0, pLevel = 1, pDropAcc = 0;
let pGarbageQueue = [];
let pComboCount = 0, pB2bCount = 0;
let pLockTimer = null, pLockFlashTimer = null;
let pLockFlashing = false, pLockBright = true, pLockMoves = 0;

// ── Bot state ─────────────────────────────────────────────────
let bGrid, bPiece, bHeldKey = null;
let bBag = [], bQueue = [];
let bScore = 0, bLines = 0, bLevel = 1;
let bGarbageQueue = [];
let bComboCount = 0, bB2bCount = 0;
let bTargetRot = 0, bTargetX = 0, bTargetY = 0;

// ── Stats tracking ────────────────────────────────────────────
let pLinesSent = 0, pPieces = 0;
let bLinesSent = 0, bPieces = 0;
let gameStartMs = 0;

// ── Timing ────────────────────────────────────────────────────
let botPps = 1.5;
let botMoveInterval = null;
let rafId = null, lastTime = 0, timerInterval = null;

// ── Shared helpers ────────────────────────────────────────────
function getCancelPower(cleared, spin) {
  if (spin) return [0, 2, 4, 8, 12][Math.min(cleared, 4)];
  return [0, 1, 2, 4, 6][Math.min(cleared, 4)];
}
function applyCancel(queue, power) {
  let remaining = power, cancelled = 0;
  while (remaining > 0 && queue.length > 0) {
    if (remaining >= queue[0]) { cancelled += queue[0]; remaining -= queue[0]; queue.shift(); }
    else { queue[0] -= remaining; cancelled += remaining; remaining = 0; }
  }
  return cancelled;
}

function baseAttack(cleared, spin) {
  if (spin) return [0, 2, 4, 7][Math.min(cleared, 3)];
  return [0, 0.5, 1, 2, 4][Math.min(cleared, 4)];
}
function b2bBonus(b2b) {
  if (b2b <= 2) return 0; if (b2b <= 5) return 1; if (b2b <= 10) return 2;
  if (b2b <= 20) return 3; if (b2b <= 50) return 4; if (b2b <= 100) return 5; return 6;
}
function addGarbage(g, n) {
  const col = Math.floor(Math.random() * COLS);
  for (let i = 0; i < n; i++) {
    g.shift();
    const row = Array(COLS).fill('#444455');
    row[col] = null;
    g.push(row);
  }
}

// ── Queue helpers ─────────────────────────────────────────────
function pEnsureQ() { while (pBag.length < 14) fillBag(pBag); while (pQueue.length < 6) pQueue.push(pBag.shift()); }
function pDequeue()  { pEnsureQ(); const k = pQueue.shift(); pEnsureQ(); return k; }
function bEnsureQ() { while (bBag.length < 14) fillBag(bBag); while (bQueue.length < 6) bQueue.push(bBag.shift()); }
function bDequeue()  { bEnsureQ(); const k = bQueue.shift(); bEnsureQ(); return k; }


// ── Bot piece placement ───────────────────────────────────────
function botDoMove() {
  if (!botRunLoop || !bPiece) return;
  const move = computeBestMove(bGrid, bPiece.key, bQueue.slice(0, 5), bHeldKey, bComboCount, bB2bCount);
  if (!move.valid) { botGameOver(); return; }

  // Execute hold if the search decided to hold
  if (move.hold) {
    if (bHeldKey === null) {
      bHeldKey = bPiece.key;
      bPiece = mkPiece(bDequeue());
    } else {
      const tmp = bHeldKey; bHeldKey = bPiece.key; bPiece = mkPiece(tmp);
    }
    if (collide(bPiece.shape, bPiece.x, bPiece.y, bGrid)) { botGameOver(); return; }
    drawBotHold();
  }

  bPiece.shape = ROTATIONS[bPiece.key][move.rot].map(r => [...r]);
  bPiece.rot   = move.rot;
  bPiece.x     = move.x;
  bPiece.y     = move.y;
  bTargetRot = move.rot; bTargetX = move.x; bTargetY = move.y;
  botLockPiece();
}

function botLockPiece() {
  bPieces++;
  for (let r = 0; r < bPiece.shape.length; r++) {
    for (let c = 0; c < bPiece.shape[r].length; c++) {
      if (!bPiece.shape[r][c]) continue;
      const row = bPiece.y + r, col = bPiece.x + c;
      if (row < 0) { botGameOver(); return; }
      if (row < ROWS) bGrid[row][col] = pieceColors[bPiece.key];
    }
  }
  const bCleared = botClearLines();
  botSpawnNext();
  if (bCleared === 0 && bGarbageQueue.length > 0) {
    addGarbage(bGrid, bGarbageQueue.shift());
    updateGarbageBar('bot-opp-garbage-bar', bGarbageQueue);
  }
}

function botClearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (bGrid[r].every(c => c)) { bGrid.splice(r, 1); bGrid.unshift(Array(COLS).fill(null)); cleared++; r++; }
  }
  if (cleared === 0) { bComboCount = 0; return 0; }
  bScore += [0, 100, 300, 500, 800][Math.min(cleared, 4)] * bLevel;
  bLines += cleared; bLevel = Math.floor(bLines / 10) + 1;
  const hasColoredLeft = bGrid.some(row => row.some(c => c && c !== '#444455'));
  const hasGarbageLeft = bGrid.some(row => row.some(c => c === '#444455'));
  const isPerfect = !hasColoredLeft && !hasGarbageLeft;
  const isColoredClear = !hasColoredLeft && hasGarbageLeft;
  const isB2B = cleared >= 4;

  // Cancel incoming garbage first
  if (bGarbageQueue.length > 0) {
    const cancelled = applyCancel(bGarbageQueue, getCancelPower(cleared, false));
    if (cancelled > 0) {
      updateGarbageBar('bot-opp-garbage-bar', bGarbageQueue);
      showCancelSplash('bot-opp-board-wrap', cancelled);
      if (isB2B || isPerfect || isColoredClear) bB2bCount++; else bB2bCount = 0;
      bComboCount++;
      if (isPerfect || isColoredClear) showRainbowSplash('bot-opp-board-wrap', isPerfect ? 'PERFECT CLEAR' : 'COLORED CLEAR', 'left');
      else showSplash('bot-opp-board-wrap', ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'][Math.min(cleared, 4)], null, false, 'left');
      return cleared;
    }
  }

  let rawBase;
  if (isPerfect) rawBase = 10;
  else if (isColoredClear) rawBase = 5;
  else rawBase = baseAttack(cleared, false) + (isB2B ? b2bBonus(bB2bCount) : 0);
  const garbage = Math.floor(rawBase * (1 + 0.2 * bComboCount));
  if (isB2B || isPerfect || isColoredClear) bB2bCount++; else bB2bCount = 0;
  bComboCount++;
  if (garbage > 0) {
    bLinesSent += garbage;
    showAttackSplash('bot-opp-board-wrap', garbage, (total) => { pGarbageQueue.push(total); updateGarbageBar('bot-garbage-bar', pGarbageQueue); });
  }
  if (isPerfect || isColoredClear) {
    showRainbowSplash('bot-opp-board-wrap', isPerfect ? 'PERFECT CLEAR' : 'COLORED CLEAR', 'left');
  } else {
    showSplash('bot-opp-board-wrap', ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'][Math.min(cleared, 4)], null, false, 'left');
  }
  return cleared;
}

function botSpawnNext() {
  bPiece = mkPiece(bDequeue());
  bEnsureQ();
  if (collide(bPiece.shape, bPiece.x, bPiece.y, bGrid)) { botGameOver(); return; }
  const m = computeBestMove(bGrid, bPiece.key, bQueue.slice(0, 5), bHeldKey, bComboCount, bB2bCount);
  bTargetRot = m.rot; bTargetX = m.x; bTargetY = m.y;
  buildBotPreviews();
}

function botGameOver() {
  if (!botRunLoop) return;
  botRunLoop = false;
  clearInterval(botMoveInterval); botMoveInterval = null;
  document.getElementById('bot-overlay').style.display = 'flex';
  document.getElementById('bot-overlay-title').textContent = 'YOU WIN!';
  document.getElementById('bot-overlay-sub').textContent = 'Bot topped out';
  document.getElementById('bot-rematch-btn').style.display = 'block';
}

// ── Player lock delay ─────────────────────────────────────────
function pGhostY() { let g = pPiece.y; while (!collide(pPiece.shape, pPiece.x, g + 1, pGrid)) g++; return g; }
function pIsGrounded() { return pPiece && collide(pPiece.shape, pPiece.x, pPiece.y + 1, pGrid); }
function pIsImmobile() {
  return collide(pPiece.shape, pPiece.x - 1, pPiece.y, pGrid) &&
         collide(pPiece.shape, pPiece.x + 1, pPiece.y, pGrid) &&
         collide(pPiece.shape, pPiece.x,     pPiece.y - 1, pGrid);
}

function pCancelLock(fullReset = false) {
  clearTimeout(pLockTimer); clearInterval(pLockFlashTimer);
  pLockTimer = pLockFlashTimer = null; pLockFlashing = false; pLockBright = true;
  if (fullReset) pLockMoves = 0;
}
function pSchedLock(isReset = false) {
  if (isReset && pLockMoves >= 15) return;
  if (isReset) pLockMoves++;
  pCancelLock();
  pLockFlashing = true; pLockBright = true;
  pLockFlashTimer = setInterval(() => { pLockBright = !pLockBright; }, LOCK_FLASH / 2);
  pLockTimer = setTimeout(() => { pCancelLock(); if (pIsGrounded()) pDoLock(); }, LOCK_DELAY);
}
function pOnMove() {
  if (pIsGrounded()) pSchedLock(pLockTimer !== null);
  else pCancelLock(true);
}

// ── Player rotation / movement ────────────────────────────────
export function botTryRotate(ccw = false) {
  if (!botRunLoop || !pPiece) return;
  const nr = ((pPiece.rot + (ccw ? -1 : 1)) + 4) % 4;
  const ns = ROTATIONS[pPiece.key][nr].map(r => [...r]);
  const dir = `${pPiece.rot}>>${nr}`;
  if (!collide(ns, pPiece.x, pPiece.y, pGrid)) { pPiece.shape = ns; pPiece.rot = nr; pOnMove(); return; }
  if (cfg.kicks === 'none') return;
  const table = pPiece.key === 'I' ? SRS_I : SRS;
  for (const [dx, dy] of (table[dir] || []).slice(1))
    if (!collide(ns, pPiece.x + dx, pPiece.y - dy, pGrid)) {
      pPiece.shape = ns; pPiece.rot = nr; pPiece.x += dx; pPiece.y -= dy; pOnMove(); return;
    }
}

export function botTryRotate180() {
  if (!botRunLoop || !pPiece) return;
  const nr = (pPiece.rot + 2) % 4;
  const ns = ROTATIONS[pPiece.key][nr].map(r => [...r]);
  if (!collide(ns, pPiece.x, pPiece.y, pGrid)) { pPiece.shape = ns; pPiece.rot = nr; pOnMove(); return; }
  if (cfg.kicks === 'none') return;
  for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]])
    if (!collide(ns, pPiece.x + dx, pPiece.y - dy, pGrid)) {
      pPiece.shape = ns; pPiece.rot = nr; pPiece.x += dx; pPiece.y -= dy; pOnMove(); return;
    }
}

export function botHardDrop() {
  if (!botRunLoop || !pPiece) return;
  pCancelLock(); pPiece.y = pGhostY(); pDoLock();
}

export function botDoHold() {
  if (!botRunLoop || !pPiece) return;
  if (cfg.holdMode === 'none') return;
  if (cfg.holdMode === 'normal' && pHoldUsed) { showToast('Hold used'); return; }
  pCancelLock();
  if (pHeldKey === null) { pHeldKey = pPiece.key; pSpawnNext(); }
  else {
    const t = pHeldKey; pHeldKey = pPiece.key; pPiece = mkPiece(t);
    if (collide(pPiece.shape, pPiece.x, pPiece.y, pGrid)) { playerGameOver(); return; }
  }
  pHoldUsed = true;
  holdCtx.fillStyle = '#0a0a0c'; holdCtx.fillRect(0, 0, holdEl.width, holdEl.height);
  drawMini(holdCtx, pHeldKey, holdEl.width, holdEl.height);
}

// ── Player lock / clear ───────────────────────────────────────
function pDoLock() {
  pPieces++;
  const willSpin = pIsImmobile();
  const lockedKey = pPiece.key;
  for (let r = 0; r < pPiece.shape.length; r++) {
    for (let c = 0; c < pPiece.shape[r].length; c++) {
      if (!pPiece.shape[r][c]) continue;
      const row = pPiece.y + r, col = pPiece.x + c;
      if (row < 0) { playerGameOver(); return; }
      pGrid[row][col] = pieceColors[pPiece.key];
    }
  }
  const pCleared = pClearLines(willSpin, lockedKey);
  pSpawnNext(); pHoldUsed = false;
  if (pCleared === 0 && pGarbageQueue.length > 0) {
    addGarbage(pGrid, pGarbageQueue.shift());
    updateGarbageBar('bot-garbage-bar', pGarbageQueue);
  }
}

function pClearLines(spin, pieceKey) {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (pGrid[r].every(c => c)) { pGrid.splice(r, 1); pGrid.unshift(Array(COLS).fill(null)); cleared++; r++; }
  }
  if (cleared === 0) {
    pComboCount = 0;
    if (spin) showSplash('bot-my-board-wrap', '', pieceKey, true, 'left');
    updateCounters('bot-my-board-wrap', 0, pB2bCount);
    return 0;
  }
  pScore += [0, 100, 300, 500, 800][Math.min(cleared, 4)] * pLevel;
  pLines += cleared; pLevel = Math.floor(pLines / 10) + 1;
  const hasColoredLeft = pGrid.some(row => row.some(c => c && c !== '#444455'));
  const hasGarbageLeft = pGrid.some(row => row.some(c => c === '#444455'));
  const isPerfect = !hasColoredLeft && !hasGarbageLeft;
  const isColoredClear = !hasColoredLeft && hasGarbageLeft;
  const isB2BEligible = cleared >= 4 || spin;

  // Cancel incoming garbage first
  if (pGarbageQueue.length > 0) {
    const cancelled = applyCancel(pGarbageQueue, getCancelPower(cleared, spin));
    if (cancelled > 0) {
      updateGarbageBar('bot-garbage-bar', pGarbageQueue);
      showCancelSplash('bot-my-board-wrap', cancelled);
      if (isB2BEligible || isPerfect || isColoredClear) pB2bCount++; else pB2bCount = 0;
      pComboCount++;
      updateCounters('bot-my-board-wrap', pComboCount, pB2bCount);
      if (isPerfect || isColoredClear) {
        showSplash('bot-my-board-wrap', null, pieceKey, spin, 'left');
        showRainbowSplash('bot-my-board-wrap', isPerfect ? 'PERFECT CLEAR' : 'COLORED CLEAR', 'left');
      } else {
        showSplash('bot-my-board-wrap', ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'][Math.min(cleared, 4)], pieceKey, spin, 'left');
      }
      return cleared;
    }
  }

  let rawBase;
  if (isPerfect) rawBase = 10;
  else if (isColoredClear) rawBase = 5;
  else rawBase = baseAttack(cleared, spin) + (isB2BEligible ? b2bBonus(pB2bCount) : 0);
  const garbage = Math.floor(rawBase * (1 + 0.2 * pComboCount));
  if (isB2BEligible || isPerfect || isColoredClear) pB2bCount++; else pB2bCount = 0;
  pComboCount++;
  if (garbage > 0) {
    pLinesSent += garbage;
    showAttackSplash('bot-my-board-wrap', garbage, (total) => { bGarbageQueue.push(total); updateGarbageBar('bot-opp-garbage-bar', bGarbageQueue); });
  }
  updateCounters('bot-my-board-wrap', pComboCount, pB2bCount);
  if (isPerfect || isColoredClear) {
    showSplash('bot-my-board-wrap', null, pieceKey, spin, 'left');
    showRainbowSplash('bot-my-board-wrap', isPerfect ? 'PERFECT CLEAR' : 'COLORED CLEAR', 'left');
  } else {
    showSplash('bot-my-board-wrap', ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'][Math.min(cleared, 4)], pieceKey, spin, 'left');
  }
  return cleared;
}

function pSpawnNext() {
  pPiece = mkPiece(pDequeue());
  botPiece = pPiece; // keep exported reference in sync
  pDropAcc = 0; pLockMoves = 0;
  if (collide(pPiece.shape, pPiece.x, pPiece.y, pGrid)) { playerGameOver(); return; }
  buildPlayerPreviews(); pOnMove();
}

function playerGameOver() {
  if (!botRunLoop) return;
  botRunLoop = false;
  clearInterval(botMoveInterval); botMoveInterval = null;
  document.getElementById('bot-overlay').style.display = 'flex';
  document.getElementById('bot-overlay-title').textContent = 'GAME OVER';
  document.getElementById('bot-overlay-sub').textContent = 'Bot wins!';
  document.getElementById('bot-rematch-btn').style.display = 'block';
}

// ── Gravity / game loop ───────────────────────────────────────
function getGravInterval() {
  if (cfg.gravMode === 'static') return Math.max(33, 800 / cfg.gravStatic);
  return Math.max(33, ((0.8 - ((pLevel - 1) * 0.007)) ** (pLevel - 1)) * 1000);
}

function gameLoop(ts) {
  if (!botRunLoop) return;
  const dt = Math.min(ts - lastTime, 100); lastTime = ts;
  if (pPiece && !pIsGrounded()) {
    pDropAcc += dt;
    if (pDropAcc > getGravInterval()) { pDropAcc = 0; pPiece.y++; pOnMove(); }
  }
  drawPlayerBoard(); drawBotBoard(); drawPlayerPreviews(); drawBotPreviews();
  rafId = requestAnimationFrame(gameLoop);
}

// ── Rendering ─────────────────────────────────────────────────
function drawCell(ctx, color, x, y, alpha = 1) {
  if (!color) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x * VS_SZ + 1, y * VS_SZ + 1, VS_SZ - 2, VS_SZ - 2);
  ctx.globalAlpha = 1;
}

function drawGridLines(ctx, el) {
  ctx.fillStyle = '#0a0a0c'; ctx.fillRect(0, 0, el.width, el.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
  for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * VS_SZ); ctx.lineTo(COLS * VS_SZ, r * VS_SZ); ctx.stroke(); }
  for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * VS_SZ, 0); ctx.lineTo(c * VS_SZ, ROWS * VS_SZ); ctx.stroke(); }
}

function drawPlayerBoard() {
  drawGridLines(myCtx, myBoardEl);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (pGrid[r][c]) drawCell(myCtx, pGrid[r][c], c, r);
  if (pPiece) {
    const gy = pGhostY();
    for (let r = 0; r < pPiece.shape.length; r++)
      for (let c = 0; c < pPiece.shape[r].length; c++)
        if (pPiece.shape[r][c]) drawCell(myCtx, pieceColors[pPiece.key], pPiece.x + c, gy + r, cfg.ghostOpacity || 0.25);
    const col = pLockFlashing && !pLockBright ? darken(pieceColors[pPiece.key]) : pieceColors[pPiece.key];
    for (let r = 0; r < pPiece.shape.length; r++)
      for (let c = 0; c < pPiece.shape[r].length; c++)
        if (pPiece.shape[r][c]) drawCell(myCtx, col, pPiece.x + c, pPiece.y + r);
  }
}

function drawBotBoard() {
  drawGridLines(oppCtx, oppBoardEl);
  if (bGrid)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (bGrid[r][c]) drawCell(oppCtx, bGrid[r][c], c, r);
  // Show bot's precomputed landing target as a dim preview
  if (bPiece && botRunLoop) {
    const shape = ROTATIONS[bPiece.key][bTargetRot];
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        if (shape[r][c]) drawCell(oppCtx, pieceColors[bPiece.key], bTargetX + c, bTargetY + r, 0.55);
  }
}

function buildPlayerPreviews() {
  const s = document.getElementById('bot-preview-stack'); s.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const cv = document.createElement('canvas');
    cv.width = 70; cv.height = i === 0 ? 44 : 32; cv.id = 'bot-prev-' + i; s.appendChild(cv);
  }
  drawPlayerPreviews();
}
function drawPlayerPreviews() {
  for (let i = 0; i < 3; i++) {
    const cv = document.getElementById('bot-prev-' + i);
    if (cv) drawMini(cv.getContext('2d'), pQueue[i] || null, cv.width, cv.height);
  }
}
function drawBotHold() {
  oppHoldCtx.fillStyle = '#0a0a0c';
  oppHoldCtx.fillRect(0, 0, oppHoldEl.width, oppHoldEl.height);
  drawMini(oppHoldCtx, bHeldKey, oppHoldEl.width, oppHoldEl.height);
}

function buildBotPreviews() {
  const s = document.getElementById('bot-opp-preview-stack'); s.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const cv = document.createElement('canvas');
    cv.width = 60; cv.height = i === 0 ? 38 : 28; cv.id = 'bot-oprev-' + i; s.appendChild(cv);
  }
  drawBotPreviews();
}
function drawBotPreviews() {
  for (let i = 0; i < 3; i++) {
    const cv = document.getElementById('bot-oprev-' + i);
    if (cv) drawMini(cv.getContext('2d'), bQueue[i] || null, cv.width, cv.height);
  }
}

// ── Start / stop ──────────────────────────────────────────────
const BOT_MAX_THRESHOLD = 20;

function scheduleBotMaxMove() {
  if (!botRunLoop || botPps <= BOT_MAX_THRESHOLD) return;
  botDoMove();
  setTimeout(scheduleBotMaxMove, 0);
}

export function startBotGame(pps, aiVersion = 1) {
  _lastAiVersion = aiVersion;
  computeBestMove = computeBestMove1;
  botPps = pps || 1.5;

  // Player init
  pGrid = mkGrid(); pPiece = null; pHeldKey = null; pHoldUsed = false;
  pBag = []; pQueue = []; pScore = 0; pLines = 0; pLevel = 1; pDropAcc = 0;
  pGarbageQueue = []; pComboCount = 0; pB2bCount = 0; pLinesSent = 0; pPieces = 0;
  pCancelLock();
  updateCounters('bot-my-board-wrap', 0, 0);
  ['bot-my-lines','bot-my-lines-sent','bot-my-pieces','bot-my-apm','bot-my-pps'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '0';
  });

  // Bot init
  bGrid = mkGrid(); bPiece = null; bHeldKey = null;
  bBag = []; bQueue = []; bScore = 0; bLines = 0; bLevel = 1;
  bGarbageQueue = []; bComboCount = 0; bB2bCount = 0; bLinesSent = 0; bPieces = 0;
  ['bot-opp-lines','bot-opp-lines-sent','bot-opp-pieces','bot-opp-apm','bot-opp-pps'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '0';
  });

  // UI reset
  clearAttackSplash('bot-my-board-wrap');  clearAttackSplash('bot-opp-board-wrap');
  clearCancelSplash('bot-my-board-wrap');  clearCancelSplash('bot-opp-board-wrap');
  updateGarbageBar('bot-garbage-bar', pGarbageQueue);
  updateGarbageBar('bot-opp-garbage-bar', bGarbageQueue);
  document.getElementById('bot-overlay').style.display = 'none';
  document.getElementById('bot-rematch-btn').style.display = 'none';
  holdCtx.fillStyle = '#0a0a0c'; holdCtx.fillRect(0, 0, holdEl.width, holdEl.height);
  drawMini(holdCtx, null, holdEl.width, holdEl.height);
  drawBotHold();
  document.getElementById('bot-my-label').textContent  = 'You';
  document.getElementById('bot-opp-label').textContent = botPps > BOT_MAX_THRESHOLD ? 'Bot (MAX)' : `Bot (${botPps} PPS)`;

  // Spawn first pieces
  pEnsureQ(); pSpawnNext(); buildPlayerPreviews();
  bEnsureQ(); botSpawnNext(); buildBotPreviews();

  // Start loops
  botRunning = true; botRunLoop = true;
  cancelAnimationFrame(rafId);
  lastTime = performance.now();
  rafId = requestAnimationFrame(gameLoop);

  clearInterval(botMoveInterval); botMoveInterval = null;
  if (botPps > BOT_MAX_THRESHOLD) {
    setTimeout(scheduleBotMaxMove, 0);
  } else {
    botMoveInterval = setInterval(() => { if (botRunLoop) botDoMove(); }, Math.round(1000 / botPps));
  }

  if (timerInterval) clearInterval(timerInterval);
  gameStartMs = performance.now();
  timerInterval = setInterval(() => {
    const elapsed = performance.now() - gameStartMs;
    const sec = elapsed / 1000, min = sec / 60;
    document.getElementById('bot-timer').textContent = fmtTime(elapsed).slice(0, 7);
    document.getElementById('bot-my-lines').textContent = pLines;
    document.getElementById('bot-my-lines-sent').textContent = pLinesSent;
    document.getElementById('bot-my-pieces').textContent = pPieces;
    document.getElementById('bot-my-apm').textContent = min > 0.1 ? (pLinesSent / min).toFixed(1) : '0';
    document.getElementById('bot-my-pps').textContent = sec > 1 ? (pPieces / sec).toFixed(2) : '0.00';
    document.getElementById('bot-opp-lines').textContent = bLines;
    document.getElementById('bot-opp-lines-sent').textContent = bLinesSent;
    document.getElementById('bot-opp-pieces').textContent = bPieces;
    document.getElementById('bot-opp-apm').textContent = min > 0.1 ? (bLinesSent / min).toFixed(1) : '0';
    document.getElementById('bot-opp-pps').textContent = sec > 1 ? (bPieces / sec).toFixed(2) : '0.00';
  }, 500);
}

export function stopBotGame() {
  botRunLoop = false; botRunning = false; botPiece = null;
  cancelAnimationFrame(rafId);
  clearInterval(botMoveInterval); botMoveInterval = null;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  pCancelLock();
}

let _lastAiVersion = 1;
export function botRematchGame() { startBotGame(botPps, _lastAiVersion); }

// ── DAS / soft drop ───────────────────────────────────────────
let dasBotTimer = null, dasBotInterval = null, dasBotHeld = false;
let sdBotActive = false, sdBotInterval = null;

function pMoveH(dx) {
  if (!botRunLoop || !pPiece) return;
  if (!collide(pPiece.shape, pPiece.x + dx, pPiece.y, pGrid)) { pPiece.x += dx; pOnMove(); }
}

export function botStartDAS(dx) {
  botStopDAS(); dasBotHeld = true; pMoveH(dx);
  dasBotTimer = setTimeout(() => {
    if (!dasBotHeld) return;
    if (cfg.arr === 0) {
      let nx = pPiece.x;
      while (!collide(pPiece.shape, nx + dx, pPiece.y, pGrid)) nx += dx;
      pPiece.x = nx; pOnMove();
    } else dasBotInterval = setInterval(() => { if (dasBotHeld) pMoveH(dx); }, cfg.arr);
  }, cfg.das);
}
export function botStopDAS() {
  dasBotHeld = false;
  clearTimeout(dasBotTimer); clearInterval(dasBotInterval);
  dasBotTimer = dasBotInterval = null;
}
export function botStartSD() {
  if (sdBotActive || !pPiece) return; sdBotActive = true;
  if (cfg.sdf === 41) { pPiece.y = pGhostY(); pOnMove(); sdBotActive = false; return; }
  if (!collide(pPiece.shape, pPiece.x, pPiece.y + 1, pGrid)) { pPiece.y++; pOnMove(); }
  sdBotInterval = setInterval(() => {
    if (!botRunLoop) { botStopSD(); return; }
    if (!collide(pPiece.shape, pPiece.x, pPiece.y + 1, pGrid)) { pPiece.y++; pOnMove(); }
  }, Math.max(1, getGravInterval() / cfg.sdf));
}
export function botStopSD() { sdBotActive = false; clearInterval(sdBotInterval); sdBotInterval = null; }
