import { COLS, ROWS, SZ, LOCK_DELAY, LOCK_FLASH, ROTATIONS, SRS, SRS_I } from './constants.js';
import { cfg, pieceColors } from './state.js';
import { mkGrid, mkPiece, collide, fillBag } from './pieces.js';
import { fmtTime, showToast, showSoloSplash, showSplash, updateCounters, drawMini, darken } from './ui.js';
import { loadStats, saveStats, recordSprintTime, recordBlitzScore } from './stats.js';

// Canvas setup
const boardEl = document.getElementById('board');
const ctx     = boardEl.getContext('2d');
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

export let running = false;
export let paused  = false;

// Attack tracking
let b2bCount   = 0;
let comboCount = 0;

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
  while (soloBag.length<14) fillBag(soloBag);
  while (soloQueue.length<cfg.previewCount+1) soloQueue.push(soloBag.shift());
}
function soloDequeue() { soloEnsureQueue(); const k=soloQueue.shift(); soloEnsureQueue(); return k; }

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
    piece.shape=ns; piece.rot=nr; onMove(); return;
  }
  if (cfg.kicks === 'none') return;
  const table = piece.key==='I' ? SRS_I : SRS;
  const kicks = (table[dir] || []).slice(1);
  for (const [dx,dy] of kicks) {
    if (!collide(ns, piece.x+dx, piece.y-dy, grid)) {
      piece.shape=ns; piece.rot=nr; piece.x+=dx; piece.y-=dy; onMove(); return;
    }
  }
}
export function tryRotate180() {
  const nr = (piece.rot + 2) % 4;
  const ns = ROTATIONS[piece.key][nr].map(r=>[...r]);
  if (!collide(ns, piece.x, piece.y, grid)) {
    piece.shape=ns; piece.rot=nr; onMove(); return;
  }
  if (cfg.kicks === 'none') return;
  const kicks180 = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [dx,dy] of kicks180) {
    if (!collide(ns, piece.x+dx, piece.y-dy, grid)) {
      piece.shape=ns; piece.rot=nr; piece.x+=dx; piece.y-=dy; onMove(); return;
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
  for (let r = ROWS-1; r >= 0; r--) {
    if (grid[r].every(c => c)) {
      if (grid[r].some(c => c === '#888899')) hadGarbage = true;
      grid.splice(r, 1); grid.unshift(Array(COLS).fill(null)); cleared++; r++;
    }
  }
  if (cleared === 0) {
    comboCount = 0;
    if (spin) showSplash('board-wrap', '', pieceKey, true, 'left');
    updateCounters('board-wrap', 0, b2bCount);
    return;
  }

  const boardEmpty     = grid.every(row => row.every(c => !c));
  const isPerfectClear = boardEmpty && !hadGarbage;
  const isColoredClear = boardEmpty && hadGarbage;
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

  showSoloSplash(cleared, attack, isPerfectClear, isColoredClear, spin);

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
  if (cfg.ranked) recordSprintTime(elapsed, cfg.subMode || '40');
  const ov = document.getElementById('overlay');
  const ranked_note = cfg.ranked ? '' : '<div style="font-size:10px;color:var(--warn);margin-top:4px;">non-standard settings — not ranked</div>';
  ov.innerHTML = `<h2 style="color:var(--accent2)">SPRINT DONE</h2><div class="time-display">${fmtTime(elapsed)}</div>${ranked_note}<div class="sub">press hard drop to restart</div>`;
  ov.style.display = 'flex';
}

function spawnNext() {
  piece=mkPiece(soloDequeue());
  dropAcc=0; lockMoves=0;
  if (collide(piece.shape,piece.x,piece.y,grid) && cfg.mode!=='zen') { triggerGameOver(); return; }
  onMove();
}

export function doHold() {
  if (cfg.holdMode==='none') return;
  if (cfg.holdMode==='normal'&&holdUsed) { showToast('Hold used'); return; }
  saveUndo(); cancelLock();
  if (heldKey===null) { heldKey=piece.key; spawnNext(); }
  else { const t=heldKey; heldKey=piece.key; piece=mkPiece(t);
    if (collide(piece.shape,piece.x,piece.y,grid)&&cfg.mode!=='zen') { triggerGameOver(); return; } }
  holdUsed=true; drawHold();
}

export function hardDrop() {
  saveUndo(); cancelLock();
  if (cfg.mode !== 'blitz') score+=2*(ghostY()-piece.y);
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
function drawCell(c,x,y,alpha=1,cx=ctx,sz=SZ) {
  if(!c||c==='__inv__') return;
  cx.globalAlpha=alpha; cx.fillStyle=c;
  cx.fillRect(x*sz+1,y*sz+1,sz-2,sz-2);
  cx.globalAlpha=1;
}
function drawBoard() {
  ctx.fillStyle='#0a0a0c'; ctx.fillRect(0,0,boardEl.width,boardEl.height);
  if (cfg.gridOn) {
    ctx.strokeStyle=cfg.gridColor; ctx.lineWidth=cfg.gridWidth;
    for(let r=0;r<=ROWS;r++){ctx.beginPath();ctx.moveTo(0,r*SZ);ctx.lineTo(COLS*SZ,r*SZ);ctx.stroke();}
    for(let c=0;c<=COLS;c++){ctx.beginPath();ctx.moveTo(c*SZ,0);ctx.lineTo(c*SZ,ROWS*SZ);ctx.stroke();}
  }
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++) if(grid[r][c]&&grid[r][c]!=='__inv__') drawCell(grid[r][c],c,r);
  if (piece&&cfg.ghostOpacity>0) {
    const gy=ghostY();
    for(let r=0;r<piece.shape.length;r++) for(let c=0;c<piece.shape[r].length;c++)
      if(piece.shape[r][c]) drawCell(pieceColors[piece.key],piece.x+c,gy+r,cfg.ghostOpacity);
  }
  if (piece) {
    const col=lockFlashing&&!lockBright ? darken(pieceColors[piece.key]) : pieceColors[piece.key];
    for(let r=0;r<piece.shape.length;r++) for(let c=0;c<piece.shape[r].length;c++)
      if(piece.shape[r][c]) drawCell(col,piece.x+c,piece.y+r);
  }
}
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
  drawPreviews();
}
function drawPreviews() {
  for(let i=0;i<cfg.previewCount;i++) {
    const c=document.getElementById('prev-'+i);
    if(c) drawMini(c.getContext('2d'),soloQueue[i]||null,c.width,c.height);
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
    drawBoard(); drawPreviews(); drawHold();
  }
  rafId=requestAnimationFrame(loop);
}

// ── Start / game over ─────────────────────────────────────────
export function startGame() {
  grid=mkGrid(); score=0; lines=0; level=1; dropAcc=0; b2bCount=0; comboCount=0;
  updateCounters('board-wrap', 0, 0);
  soloBag=[]; soloQueue=[]; heldKey=null; holdUsed=false;
  undoStack=[]; redoStack=[]; cancelLock();
  ['score','lines','level'].forEach(id=>document.getElementById(id).textContent=id==='level'?'1':'0');
  document.getElementById('game-mode-badge').textContent=
    ({marathon:'MARATHON',sprint:(cfg.subMode||'40')+'L SPRINT',blitz:'BLITZ '+(cfg.subMode||'2m').toUpperCase(),zen:'ZEN'}[cfg.mode]||cfg.mode.toUpperCase());
  document.getElementById('sprint-target-row').style.display=cfg.mode==='sprint'?'flex':'none';
  document.getElementById('sprint-left').textContent=cfg.subMode||'40';
  document.getElementById('practice-badge').style.display=cfg.practice?'inline':'none';
  document.getElementById('game-timer').textContent=cfg.mode==='blitz'?fmtTime(blitzDuration):'0:00.000';
  gameStartMs=sprintStartMs=performance.now();
  soloEnsureQueue(); spawnNext(); buildPreviews(); drawHold();
  running=true; paused=false;
  document.getElementById('overlay').style.display='none';
  const scoreLbl = document.getElementById('score-label');
  if (scoreLbl) scoreLbl.textContent = cfg.mode==='blitz' ? 'Lines Sent' : 'Score';
  cancelAnimationFrame(rafId); lastTime=performance.now();
  timerRunning=true;
  if(timerInterval) clearInterval(timerInterval);
  timerInterval=setInterval(()=>{
    if(!timerRunning||paused) return;
    blitzDuration = {'30s':30000,'1m':60000,'2m':120000}[cfg.subMode] || 120000;
    if(cfg.mode==='blitz'){
      const rem=Math.max(0,blitzDuration-(performance.now()-gameStartMs));
      document.getElementById('game-timer').textContent=fmtTime(rem);
      if(rem<=0) triggerGameOver();
    } else {
      document.getElementById('game-timer').textContent=fmtTime(performance.now()-sprintStartMs);
    }
  },33);
  rafId=requestAnimationFrame(loop);
  const st=loadStats(); st.gamesPlayed=(st.gamesPlayed||0)+1; saveStats(st);
}

export function triggerGameOver() {
  running=false; timerRunning=false; cancelLock();
  if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  const st=loadStats(); st.totalLines=(st.totalLines||0)+lines; saveStats(st);
  const ov=document.getElementById('overlay');
  if (cfg.mode === 'blitz') {
    if (cfg.ranked) recordBlitzScore(score, cfg.subMode || '2m');
    const ranked_note = cfg.ranked ? '' : '<div style="font-size:10px;color:var(--warn);margin-top:4px;">non-standard settings — not ranked</div>';
    ov.innerHTML = `<h2 style="color:var(--accent2)">TIME'S UP</h2><div class="score-display">${score} <span style="font-size:16px;color:var(--muted)">lines sent</span></div>${ranked_note}<div class="sub">press hard drop to restart</div>`;
  } else {
    ov.innerHTML = `<h2>GAME OVER</h2><div class="score-display">${score}</div><div class="sub">press hard drop to restart</div>`;
  }
  ov.style.display='flex';
}

export function stopGame() {
  running = false;
  cancelAnimationFrame(rafId);
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
  if(!collide(piece.shape,piece.x+dx,piece.y,grid)){piece.x+=dx;onMove();}
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
  if(cfg.sdf===41){const gy=ghostY();piece.y=gy;onMove();sdActive=false;return;}
  if(!collide(piece.shape,piece.x,piece.y+1,grid)){piece.y++;onMove();}
  sdInterval=setInterval(()=>{
    if(!running||paused){stopSD();return;}
    if(!collide(piece.shape,piece.x,piece.y+1,grid)){piece.y++;onMove();}
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
