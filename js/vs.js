import { COLS, ROWS, VS_SZ, LOCK_DELAY, LOCK_FLASH, ROTATIONS, SRS, SRS_I } from './constants.js';
import { cfg, pieceColors } from './state.js';
import { mkGrid, mkPiece, collide, buildSharedSeq } from './pieces.js';
import { fmtTime, showToast, showVsSplash, showSplash, updateCounters, drawMini, darken } from './ui.js';
import { db } from './firebase.js';
import { ref, set, get, onValue, off, serverTimestamp, remove, update }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Canvas setup
const vsBoardEl  = document.getElementById('vs-my-board');
const vsCtx      = vsBoardEl.getContext('2d');
const vsOppEl    = document.getElementById('vs-opp-board');
const vsOppCtx   = vsOppEl.getContext('2d');
const vsHoldEl   = document.getElementById('vs-hold-canvas');
const vsHoldCtx  = vsHoldEl.getContext('2d');

// VS game state
export let vsRunning=false, vsSpectating=false, vsRunLoop=false;
let vsGrid;
export let vsPiece=null;
let vsHeldKey, vsHoldUsed, vsQueue=[];
let vsScore=0, vsLines=0, vsLevel=1, vsDropAcc=0;
let vsPendingGarbage=0, oppGrid=null, oppNextQueue=[];
let vsComboCount=0, vsB2bCount=0;
let vsRafId=null, vsLastTime=0, vsTimerInterval=null;
let vsLockTimer=null, vsLockFlashTimer=null, vsLockFlashing=false, vsLockBright=true;
let vsLockMoves=0;

let myPlayerId=null, roomId=null, mySlot=null;
let roomRef=null, roomListener=null;
let currentGameId=null;

// Shared sequence for VS bags
let sharedSeq=[], vsSeqIdx=0;

function genCode() { return Math.random().toString(36).slice(2,8).toUpperCase(); }
function genId()   { return Math.random().toString(36).slice(2,10); }

export async function createRoom() {
  if(!db){showToast('Firebase not configured');return;}
  myPlayerId=genId(); roomId=genCode();
  const seed=Date.now()%2147483647;
  await set(ref(db,`rooms/${roomId}`),{
    bagSeed:seed, status:'waiting',
    players:{[myPlayerId]:{slot:1,score:0,lines:0,board:null,queue:[],alive:true}}
  });
  mySlot=1; showRoomCard(); listenRoom();
}

export async function joinRoom() {
  if(!db){showToast('Firebase not configured');return;}
  const code=document.getElementById('room-code-input').value.trim().toUpperCase();
  if(!code){showToast('Enter a room code');return;}
  const snap=await get(ref(db,`rooms/${code}`));
  if(!snap.exists()){setLobbyStatus('Room not found.');return;}
  const data=snap.val();
  const players=data.players||{};
  const count=Object.values(players).filter(p=>p&&p.slot).length;
  myPlayerId=genId(); roomId=code;
  const started=data.status==='playing'||data.status==='gameover';
  if(!started&&count<2){
    mySlot=2;
    await update(ref(db,`rooms/${roomId}/players`),{[myPlayerId]:{slot:2,score:0,lines:0,board:null,queue:[],alive:true}});
  } else {
    mySlot=0;
    await update(ref(db,`rooms/${roomId}/spectators`),{[myPlayerId]:true});
    setLobbyStatus('Joined as spectator.');
  }
  showRoomCard(); listenRoom();
}

function showRoomCard() {
  document.getElementById('room-card-wrap').style.display='block';
  document.getElementById('room-display-code').textContent=roomId;
  document.getElementById('lobby-status').textContent='';
}
function setLobbyStatus(msg){document.getElementById('lobby-status').textContent=msg;}

function listenRoom() {
  if(roomListener) off(roomRef);
  roomRef=ref(db,`rooms/${roomId}`);
  roomListener=onValue(roomRef,snap=>{
    if(!snap.exists()) return;
    const data=snap.val();
    const players=data.players||{};
    const p1=Object.values(players).find(p=>p&&p.slot===1);
    const p2=Object.values(players).find(p=>p&&p.slot===2);
    const sl1=document.getElementById('slot-p1'),sl2=document.getElementById('slot-p2');
    sl1.textContent='P1 — '+(p1?'ready':'waiting');
    sl1.className='player-slot'+(p1?mySlot===1?' me':' filled':'');
    sl2.textContent='P2 — '+(p2?'ready':'waiting');
    sl2.className='player-slot'+(p2?mySlot===2?' me':' filled':'');
    const specCount=Object.keys(data.spectators||{}).length;
    document.getElementById('spectator-info').textContent=specCount?`+${specCount} spectator${specCount>1?'s':''}` :'';
    const bothReady=p1&&p2;
    document.getElementById('room-play-btn').style.display=bothReady&&mySlot===1?'block':'none';
    document.getElementById('room-card-sub').textContent=bothReady?'Both players ready!':'Waiting for opponent...';
    const newGameId=data.gameId||null;
    if(data.status==='playing'){
      if(!vsRunning){currentGameId=newGameId;enterVsGame(data,mySlot===0);}
      else if(newGameId&&newGameId!==currentGameId){currentGameId=newGameId;handleRematch(data);}
    }
    if(vsRunning) updateOppBoard(data);
  });
}

export async function startVsGame(){
  const gameId=genCode();
  await update(ref(db,`rooms/${roomId}`),{status:'playing',gameId,startTime:serverTimestamp()});
}

export async function rematchGame(){
  if(!db||!roomId||!myPlayerId)return;
  const seed=Date.now()%2147483647;
  const gameId=genCode();
  await set(ref(db,`rooms/${roomId}/garbage`),null);
  await update(ref(db,`rooms/${roomId}`),{bagSeed:seed,gameId,status:'playing',startTime:serverTimestamp()});
}

function handleRematch(data){
  vsCancelLock();
  sharedSeq=buildSharedSeq(data.bagSeed||12345); vsSeqIdx=0;
  if(db&&roomId&&myPlayerId)
    update(ref(db,`rooms/${roomId}/players/${myPlayerId}`),{alive:true,score:0,lines:0,board:null,queue:[]});
  initVsGame();
}

function enterVsGame(data,spectate=false) {
  vsSpectating=spectate; vsRunning=true;
  currentGameId=data.gameId||null;
  window.showScreen('screen-vs');
  const players=data.players||{};
  const opp=Object.entries(players).find(([id])=>id!==myPlayerId);
  document.getElementById('vs-my-label').textContent=mySlot===1?'P1 (You)':'P2 (You)';
  document.getElementById('vs-opp-label').textContent=opp?`P${opp[1].slot}`:'Opponent';
  sharedSeq=buildSharedSeq(data.bagSeed||12345); vsSeqIdx=0;
  if(spectate){
    buildVsPreviews(); buildOppPreviews();
    document.getElementById('vs-overlay').style.display='flex';
    document.getElementById('vs-overlay-title').textContent='SPECTATING';
    document.getElementById('vs-overlay-sub').textContent='Game in progress';
    setTimeout(()=>document.getElementById('vs-overlay').style.display='none',2000);
    vsRunLoop=false; vsRafId=requestAnimationFrame(vsSpectatorLoop);
    return;
  }
  initVsGame();
}

function initVsGame() {
  vsGrid=mkGrid(); vsPiece=null; vsHeldKey=null; vsHoldUsed=false;
  vsQueue=[]; vsScore=0; vsLines=0; vsLevel=1; vsDropAcc=0;
  vsPendingGarbage=0; oppGrid=mkGrid(); oppNextQueue=[];
  vsComboCount=0; vsB2bCount=0;
  updateCounters('vs-my-board-wrap', 0, 0);
  document.getElementById('vs-score').textContent='0';
  document.getElementById('vs-lines').textContent='0';
  document.getElementById('vs-overlay').style.display='none';
  const _rb=document.getElementById('vs-rematch-btn');if(_rb)_rb.style.display='none';
  vsEnsureQueue(); vsSpawnNext(); buildVsPreviews(); buildOppPreviews();
  vsRunLoop=true; vsLastTime=performance.now();
  cancelAnimationFrame(vsRafId);
  vsRafId=requestAnimationFrame(vsLoop);
  const t0=performance.now();
  if(vsTimerInterval) clearInterval(vsTimerInterval);
  vsTimerInterval=setInterval(()=>{
    document.getElementById('vs-timer').textContent=fmtTime(performance.now()-t0).slice(0,7);
  },500);
}

function vsEnsureQueue(){while(vsQueue.length<5)vsQueue.push(sharedSeq[vsSeqIdx++]);}
function vsDequeue(){vsEnsureQueue();const k=vsQueue.shift();vsEnsureQueue();return k;}

function vsBaseAttack(cleared,spin){
  if(spin) return [0,2,4,7][Math.min(cleared,3)];
  return [0,0.5,1,2,4][Math.min(cleared,4)];
}
function vsB2bBonus(b2b){
  if(b2b<=2)return 0;if(b2b<=5)return 1;if(b2b<=10)return 2;
  if(b2b<=20)return 3;if(b2b<=50)return 4;if(b2b<=100)return 5;return 6;
}

function vsIsGrounded(){return vsPiece&&collide(vsPiece.shape,vsPiece.x,vsPiece.y+1,vsGrid);}
function vsIsImmobile(){return collide(vsPiece.shape,vsPiece.x-1,vsPiece.y,vsGrid)&&collide(vsPiece.shape,vsPiece.x+1,vsPiece.y,vsGrid)&&collide(vsPiece.shape,vsPiece.x,vsPiece.y-1,vsGrid);}
function vsIsSpin(){return vsIsImmobile();}
function vsGhostY(){let g=vsPiece.y;while(!collide(vsPiece.shape,vsPiece.x,g+1,vsGrid))g++;return g;}

function vsSchedLock(isReset=false){
  if(isReset && vsLockMoves>=15) return;
  if(isReset) vsLockMoves++;
  vsCancelLock(); vsLockFlashing=true; vsLockBright=true;
  vsLockFlashTimer=setInterval(()=>{vsLockBright=!vsLockBright;},LOCK_FLASH/2);
  vsLockTimer=setTimeout(()=>{vsCancelLock();if(vsIsGrounded())vsDoLock();},LOCK_DELAY);
}
function vsCancelLock(fullReset=false){clearTimeout(vsLockTimer);clearInterval(vsLockFlashTimer);vsLockTimer=vsLockFlashTimer=null;vsLockFlashing=false;vsLockBright=true;if(fullReset)vsLockMoves=0;}
function vsOnMove(){if(vsIsGrounded()){vsSchedLock(vsLockTimer!==null);}else{vsCancelLock(true);}}

export function vsTryRotate(ccw=false){
  const nr=((vsPiece.rot+(ccw?-1:1))+4)%4;
  const ns=ROTATIONS[vsPiece.key][nr].map(r=>[...r]);
  const dir=`${vsPiece.rot}>>${nr}`;
  if(!collide(ns,vsPiece.x,vsPiece.y,vsGrid)){vsPiece.shape=ns;vsPiece.rot=nr;vsOnMove();pushBoard();return;}
  if(cfg.kicks==='none') return;
  const table=vsPiece.key==='I'?SRS_I:SRS;
  const kicks=(table[dir]||[]).slice(1);
  for(const [dx,dy] of kicks){
    if(!collide(ns,vsPiece.x+dx,vsPiece.y-dy,vsGrid)){vsPiece.shape=ns;vsPiece.rot=nr;vsPiece.x+=dx;vsPiece.y-=dy;vsOnMove();pushBoard();return;}
  }
}
export function vsTryRotate180(){
  const nr=(vsPiece.rot+2)%4;
  const ns=ROTATIONS[vsPiece.key][nr].map(r=>[...r]);
  if(!collide(ns,vsPiece.x,vsPiece.y,vsGrid)){vsPiece.shape=ns;vsPiece.rot=nr;vsOnMove();pushBoard();return;}
  if(cfg.kicks==='none') return;
  const kicks180=[[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
  for(const [dx,dy] of kicks180){
    if(!collide(ns,vsPiece.x+dx,vsPiece.y-dy,vsGrid)){vsPiece.shape=ns;vsPiece.rot=nr;vsPiece.x+=dx;vsPiece.y-=dy;vsOnMove();pushBoard();return;}
  }
}
function vsMoveH(dx){if(!vsRunLoop||!vsPiece)return;if(!collide(vsPiece.shape,vsPiece.x+dx,vsPiece.y,vsGrid)){vsPiece.x+=dx;vsOnMove();pushBoard();}}
export function vsHardDrop(){vsCancelLock();vsScore+=2*(vsGhostY()-vsPiece.y);vsPiece.y=vsGhostY();vsDoLock();}
export function vsDoHold(){
  if(cfg.holdMode==='none')return;
  if(cfg.holdMode==='normal'&&vsHoldUsed){showToast('Hold used');return;}
  vsCancelLock();
  if(vsHeldKey===null){vsHeldKey=vsPiece.key;vsSpawnNext();}
  else{const t=vsHeldKey;vsHeldKey=vsPiece.key;vsPiece=mkPiece(t);if(collide(vsPiece.shape,vsPiece.x,vsPiece.y,vsGrid)){vsGameOver();return;}}
  vsHoldUsed=true; drawVsHold();
}
function vsSpawnNext(){
  vsPiece=mkPiece(vsDequeue());
  vsDropAcc=0; vsLockMoves=0;
  if(collide(vsPiece.shape,vsPiece.x,vsPiece.y,vsGrid)){vsGameOver();return;}
  buildVsPreviews();
  vsOnMove();
}
function vsDoLock(){
  const willSpin=vsIsSpin();
  const lockedKey=vsPiece.key;
  for(let r=0;r<vsPiece.shape.length;r++)for(let c=0;c<vsPiece.shape[r].length;c++){
    if(!vsPiece.shape[r][c])continue;
    const row=vsPiece.y+r,col=vsPiece.x+c;
    if(row<0){vsGameOver();return;}
    vsGrid[row][col]=pieceColors[vsPiece.key];
  }
  vsClearLines(willSpin,lockedKey); vsSpawnNext(); vsHoldUsed=false;
  if(vsPendingGarbage>0){addGarbage(vsGrid,vsPendingGarbage);vsPendingGarbage=0;}
  pushBoard();
}
function vsClearLines(spin,pieceKey){
  let cleared=0;
  for(let r=ROWS-1;r>=0;r--){if(vsGrid[r].every(c=>c)){vsGrid.splice(r,1);vsGrid.unshift(Array(COLS).fill(null));cleared++;r++;}}
  if(cleared===0){
    vsComboCount=0;
    if(spin) showSplash('vs-my-board-wrap','',pieceKey,true,'left');
    updateCounters('vs-my-board-wrap',0,vsB2bCount);
    return;
  }
  vsScore+=[0,100,300,500,800][cleared]*vsLevel;
  vsLines+=cleared; vsLevel=Math.floor(vsLines/10)+1;
  document.getElementById('vs-score').textContent=vsScore;
  document.getElementById('vs-lines').textContent=vsLines;
  const isPerfect=vsGrid.every(row=>row.every(c=>!c));
  const isB2BEligible=cleared>=4||spin;
  let rawBase;
  if(isPerfect){ rawBase=10; }
  else{ rawBase=vsBaseAttack(cleared,spin)+(isB2BEligible?vsB2bBonus(vsB2bCount):0); }
  const garbage=Math.floor(rawBase*(1+0.2*vsComboCount));
  if(isB2BEligible||isPerfect) vsB2bCount++; else vsB2bCount=0;
  vsComboCount++;
  updateCounters('vs-my-board-wrap',vsComboCount,vsB2bCount);
  if(isPerfect) showVsSplash('PERFECT\nCLEAR',garbage);
  else if(garbage>0) showVsSplash(cleared>=4?'QUAD':cleared>=3?'TRIPLE':'+'+garbage+' LINE'+(cleared>1?'S':''),garbage);
  if(garbage>0) sendGarbage(garbage);
  const vsLabel=isPerfect?'PERFECT CLEAR':['','SINGLE','DOUBLE','TRIPLE','QUAD'][Math.min(cleared,4)];
  showSplash('vs-my-board-wrap',vsLabel,pieceKey,spin,'left');
}
function addGarbage(g,n){
  const col=Math.floor(Math.random()*COLS);
  for(let i=0;i<n;i++){g.shift();const row=Array(COLS).fill('#444455');row[col]=null;g.push(row);}
}

function serializeGrid(g){return g.map(r=>r.map(c=>c?'1':'0').join('')).join('|');}
function deserializeGrid(s){if(!s)return mkGrid();return s.split('|').map(r=>r.split('').map(c=>c==='1'?'#888899':null));}

async function pushBoard(){
  if(!db||!roomId||!myPlayerId)return;
  await update(ref(db,`rooms/${roomId}/players/${myPlayerId}`),{
    board:serializeGrid(vsGrid), score:vsScore, lines:vsLines, alive:true, queue:vsQueue.slice(0,3)
  });
}
async function sendGarbage(n){
  if(!db||!roomId||!myPlayerId)return;
  await set(ref(db,`rooms/${roomId}/garbage/${Date.now()}`),{from:myPlayerId,lines:n});
}
function updateOppBoard(data){
  const players=data.players||{};
  if(vsSpectating){
    const p1=Object.values(players).find(p=>p&&p.slot===1);
    const p2=Object.values(players).find(p=>p&&p.slot===2);
    if(p1){vsGrid=deserializeGrid(p1.board);document.getElementById('vs-score').textContent=p1.score||0;if(Array.isArray(p1.queue)){vsQueue=[...p1.queue];drawVsPreviews();}}
    if(p2){oppGrid=deserializeGrid(p2.board);document.getElementById('vs-opp-score').textContent=p2.score||0;if(Array.isArray(p2.queue)){oppNextQueue=p2.queue;drawOppPreviews();}}
    return;
  }
  const opp=Object.entries(players).find(([id])=>id!==myPlayerId);
  if(opp){
    const od=opp[1];
    oppGrid=deserializeGrid(od.board);
    document.getElementById('vs-opp-score').textContent=od.score||0;
    document.getElementById('vs-opp-lines').textContent=od.lines||0;
    if(Array.isArray(od.queue)){oppNextQueue=od.queue;drawOppPreviews();}
    if(od.alive===false)handleVsWin();
  }
  const garb=data.garbage||{};
  Object.entries(garb).forEach(([key,g])=>{
    if(g.from!==myPlayerId){vsPendingGarbage+=g.lines;remove(ref(db,`rooms/${roomId}/garbage/${key}`));}
  });
  document.getElementById('vs-garbage-fill').style.height=Math.min(100,vsPendingGarbage/20*100)+'%';
}

async function vsGameOver(){
  vsRunLoop=false; vsCancelLock(); cancelAnimationFrame(vsRafId);
  if(vsTimerInterval){clearInterval(vsTimerInterval);vsTimerInterval=null;}
  if(db&&roomId&&myPlayerId) await update(ref(db,`rooms/${roomId}/players/${myPlayerId}`),{alive:false});
  document.getElementById('vs-overlay').style.display='flex';
  document.getElementById('vs-overlay-title').textContent='GAME OVER';
  document.getElementById('vs-overlay-sub').textContent='Opponent still going...';
  if(mySlot===1){const btn=document.getElementById('vs-rematch-btn');if(btn)btn.style.display='block';}
}
function handleVsWin(){
  if(!vsRunLoop)return;
  vsRunLoop=false; vsCancelLock(); cancelAnimationFrame(vsRafId);
  document.getElementById('vs-overlay').style.display='flex';
  document.getElementById('vs-overlay-title').textContent='YOU WIN!';
  document.getElementById('vs-overlay-sub').textContent='Opponent topped out';
  if(mySlot===1){const btn=document.getElementById('vs-rematch-btn');if(btn)btn.style.display='block';}
}

export function stopVsGame(){
  vsRunLoop=false; vsCancelLock(); cancelAnimationFrame(vsRafId);
  if(vsTimerInterval){clearInterval(vsTimerInterval);vsTimerInterval=null;}
  if(roomRef&&roomListener)off(roomRef);
  vsRunning=false;
}

export async function leaveRoom(){
  stopVsGame();
  if(db&&roomId&&myPlayerId) await update(ref(db,`rooms/${roomId}/players`),{[myPlayerId]:null}).catch(()=>{});
  roomId=myPlayerId=mySlot=null;
  document.getElementById('room-card-wrap').style.display='none';
  document.getElementById('room-code-input').value='';
  window.showScreen('screen-lobby');
}

function getVsInterval(){return Math.max(33,((0.8-((vsLevel-1)*0.007))**(vsLevel-1))*1000);}

function vsLoop(ts){
  if(!vsRunLoop)return;
  const dt=Math.min(ts-vsLastTime,100);vsLastTime=ts;
  if(vsPiece&&!vsIsGrounded()){vsDropAcc+=dt;if(vsDropAcc>getVsInterval()){vsDropAcc=0;vsPiece.y++;vsOnMove();pushBoard();}}
  drawVsBoard();drawOppBoard();drawVsPreviews();drawOppPreviews();drawVsHold();
  vsRafId=requestAnimationFrame(vsLoop);
}
function vsSpectatorLoop(ts){
  drawVsBoard();drawOppBoard();drawVsPreviews();drawOppPreviews();
  vsRafId=requestAnimationFrame(vsSpectatorLoop);
}

// VS rendering
function drawVsCell(c,x,y,alpha=1,cx=vsCtx){
  if(!c||c==='__inv__')return;cx.globalAlpha=alpha;cx.fillStyle=c;
  cx.fillRect(x*VS_SZ+1,y*VS_SZ+1,VS_SZ-2,VS_SZ-2);cx.globalAlpha=1;
}
function drawVsBoard(){
  vsCtx.fillStyle='#0a0a0c';vsCtx.fillRect(0,0,vsBoardEl.width,vsBoardEl.height);
  vsCtx.strokeStyle='rgba(255,255,255,0.04)';vsCtx.lineWidth=0.5;
  for(let r=0;r<=ROWS;r++){vsCtx.beginPath();vsCtx.moveTo(0,r*VS_SZ);vsCtx.lineTo(COLS*VS_SZ,r*VS_SZ);vsCtx.stroke();}
  for(let c=0;c<=COLS;c++){vsCtx.beginPath();vsCtx.moveTo(c*VS_SZ,0);vsCtx.lineTo(c*VS_SZ,ROWS*VS_SZ);vsCtx.stroke();}
  if(vsGrid)for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(vsGrid[r][c])drawVsCell(vsGrid[r][c],c,r);
  if(vsPiece){
    const gy=vsGhostY();
    for(let r=0;r<vsPiece.shape.length;r++)for(let c=0;c<vsPiece.shape[r].length;c++)
      if(vsPiece.shape[r][c])drawVsCell(pieceColors[vsPiece.key],vsPiece.x+c,gy+r,0.25);
    const col2=vsLockFlashing&&!vsLockBright?darken(pieceColors[vsPiece.key]):pieceColors[vsPiece.key];
    for(let r=0;r<vsPiece.shape.length;r++)for(let c=0;c<vsPiece.shape[r].length;c++)
      if(vsPiece.shape[r][c])drawVsCell(col2,vsPiece.x+c,vsPiece.y+r);
  }
}
function drawOppBoard(){
  vsOppCtx.fillStyle='#0a0a0c';vsOppCtx.fillRect(0,0,vsOppEl.width,vsOppEl.height);
  vsOppCtx.strokeStyle='rgba(255,255,255,0.04)';vsOppCtx.lineWidth=0.5;
  for(let r=0;r<=ROWS;r++){vsOppCtx.beginPath();vsOppCtx.moveTo(0,r*VS_SZ);vsOppCtx.lineTo(COLS*VS_SZ,r*VS_SZ);vsOppCtx.stroke();}
  for(let c=0;c<=COLS;c++){vsOppCtx.beginPath();vsOppCtx.moveTo(c*VS_SZ,0);vsOppCtx.lineTo(c*VS_SZ,ROWS*VS_SZ);vsOppCtx.stroke();}
  if(oppGrid)for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)if(oppGrid[r][c])drawVsCell(oppGrid[r][c],c,r,1,vsOppCtx);
}
export function drawVsHold(){vsHoldCtx.fillStyle='#0a0a0c';vsHoldCtx.fillRect(0,0,vsHoldEl.width,vsHoldEl.height);drawMini(vsHoldCtx,vsHeldKey,vsHoldEl.width,vsHoldEl.height);}
function buildVsPreviews(){
  const s=document.getElementById('vs-preview-stack');s.innerHTML='';
  for(let i=0;i<3;i++){const c=document.createElement('canvas');c.width=70;c.height=i===0?44:32;c.id='vsp-'+i;s.appendChild(c);}
  drawVsPreviews();
}
function drawVsPreviews(){for(let i=0;i<3;i++){const c=document.getElementById('vsp-'+i);if(c)drawMini(c.getContext('2d'),vsQueue[i]||null,c.width,c.height);}}
function buildOppPreviews(){
  const s=document.getElementById('vs-opp-preview-stack');s.innerHTML='';
  for(let i=0;i<3;i++){const c=document.createElement('canvas');c.width=60;c.height=i===0?38:28;c.id='oppp-'+i;s.appendChild(c);}
}
function drawOppPreviews(){for(let i=0;i<3;i++){const c=document.getElementById('oppp-'+i);if(c)drawMini(c.getContext('2d'),oppNextQueue[i]||null,c.width,c.height);}}

// VS DAS
let vsDasTimer=null,vsDasInterval=null,vsDasDir=0,vsDasHeld=false;
let vsSDActive=false,vsSDInterval=null;

export function vsStartDAS(dx){
  vsStopDAS();vsDasDir=dx;vsDasHeld=true;vsMoveH(dx);
  vsDasTimer=setTimeout(()=>{
    if(!vsDasHeld)return;
    if(cfg.arr===0){let nx=vsPiece.x;while(!collide(vsPiece.shape,nx+dx,vsPiece.y,vsGrid))nx+=dx;vsPiece.x=nx;vsOnMove();pushBoard();}
    else vsDasInterval=setInterval(()=>{if(vsDasHeld)vsMoveH(dx);},cfg.arr);
  },cfg.das);
}
export function vsStopDAS(){vsDasHeld=false;clearTimeout(vsDasTimer);clearInterval(vsDasInterval);vsDasTimer=vsDasInterval=null;}
export function vsStartSD(){
  if(vsSDActive)return;vsSDActive=true;
  if(cfg.sdf===41){const gy=vsGhostY();vsPiece.y=gy;vsOnMove();vsSDActive=false;return;}
  if(!collide(vsPiece.shape,vsPiece.x,vsPiece.y+1,vsGrid)){vsPiece.y++;vsOnMove();}
  vsSDInterval=setInterval(()=>{
    if(!vsRunLoop){vsStopSD();return;}
    if(!collide(vsPiece.shape,vsPiece.x,vsPiece.y+1,vsGrid)){vsPiece.y++;vsOnMove();}
  },Math.max(1,getVsInterval()/cfg.sdf));
}
export function vsStopSD(){vsSDActive=false;clearInterval(vsSDInterval);vsSDInterval=null;}
