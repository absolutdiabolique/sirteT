import { COLS, ROWS, VS_SZ, LOCK_DELAY, LOCK_FLASH, ROTATIONS, SRS, SRS_I } from './constants.js';
import { cfg, pieceColors } from './state.js';
import { mkGrid, mkPiece, collide, buildSharedSeq } from './pieces.js';
import { fmtTime, showToast, showAttackSplash, clearAttackSplash, showCancelSplash, clearCancelSplash, updateGarbageBar, showSplash, showRainbowSplash, updateCounters, drawMini } from './ui.js';
import { createBoard } from './board.js';
import { db } from './firebase.js';
import { ref, set, get, onValue, off, serverTimestamp, remove, update }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Canvas setup
const vsBoardEl  = document.getElementById('vs-my-board');
const myBoard    = createBoard(vsBoardEl, VS_SZ);
const vsOppEl    = document.getElementById('vs-opp-board');
const oppBoard   = createBoard(vsOppEl, VS_SZ);
const vsHoldEl   = document.getElementById('vs-hold-canvas');
const vsHoldCtx  = vsHoldEl.getContext('2d');

// VS game state
export let vsRunning=false, vsSpectating=false, vsRunLoop=false;
let vsGrid;
export let vsPiece=null;
let vsHeldKey, vsHoldUsed, vsQueue=[];
let vsScore=0, vsLines=0, vsLevel=1, vsDropAcc=0;
let vsGarbageQueue=[], oppGrid=null, oppNextQueue=[];
let vsComboCount=0, vsB2bCount=0;
let vsRafId=null, vsLastTime=0, vsTimerInterval=null;
let vsLockTimer=null, vsLockFlashTimer=null, vsLockFlashing=false, vsLockBright=true;
let vsLockMoves=0;

let myPlayerId=null, roomId=null, mySlot=null;
let roomRef=null, roomListener=null;
let currentGameId=null;
let vsLinesSent=0, vsPieces=0, vsGameStartMs=0;

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
  clearAttackSplash('vs-my-board-wrap');
  clearCancelSplash('vs-my-board-wrap');
  vsGrid=mkGrid(); vsPiece=null; vsHeldKey=null; vsHoldUsed=false;
  vsQueue=[]; vsScore=0; vsLines=0; vsLevel=1; vsDropAcc=0;
  vsGarbageQueue=[]; oppGrid=mkGrid(); oppNextQueue=[];
  updateGarbageBar('vs-garbage-bar', vsGarbageQueue);
  vsComboCount=0; vsB2bCount=0;
  vsLinesSent=0; vsPieces=0;
  updateCounters('vs-my-board-wrap', 0, 0);
  ['vs-lines','vs-lines-sent','vs-pieces','vs-apm','vs-pps'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='0';});
  ['vs-opp-lines','vs-opp-lines-sent','vs-opp-pieces','vs-opp-apm','vs-opp-pps'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='0';});
  document.getElementById('vs-overlay').style.display='none';
  const _rb=document.getElementById('vs-rematch-btn');if(_rb)_rb.style.display='none';
  vsEnsureQueue(); vsSpawnNext(); buildVsPreviews(); buildOppPreviews();
  vsRunLoop=true; vsLastTime=performance.now();
  cancelAnimationFrame(vsRafId);
  vsRafId=requestAnimationFrame(vsLoop);
  vsGameStartMs=performance.now();
  if(vsTimerInterval) clearInterval(vsTimerInterval);
  vsTimerInterval=setInterval(()=>{
    const elapsed=performance.now()-vsGameStartMs;
    const sec=elapsed/1000, min=sec/60;
    document.getElementById('vs-timer').textContent=fmtTime(elapsed).slice(0,7);
    document.getElementById('vs-lines').textContent=vsLines;
    document.getElementById('vs-lines-sent').textContent=vsLinesSent;
    document.getElementById('vs-pieces').textContent=vsPieces;
    document.getElementById('vs-apm').textContent=min>0.1?(vsLinesSent/min).toFixed(1):'0';
    document.getElementById('vs-pps').textContent=sec>1?(vsPieces/sec).toFixed(2):'0.00';
  },500);
}

function vsEnsureQueue(){while(vsQueue.length<5)vsQueue.push(sharedSeq[vsSeqIdx++]);}
function vsDequeue(){vsEnsureQueue();const k=vsQueue.shift();vsEnsureQueue();return k;}

function getCancelPower(cleared,spin){
  if(spin) return [0,2,4,8,12][Math.min(cleared,4)];
  return [0,1,2,4,6][Math.min(cleared,4)];
}
function applyCancel(queue,power){
  let remaining=power,cancelled=0;
  while(remaining>0&&queue.length>0){
    if(remaining>=queue[0]){cancelled+=queue[0];remaining-=queue[0];queue.shift();}
    else{queue[0]-=remaining;cancelled+=remaining;remaining=0;}
  }
  return cancelled;
}

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
  vsPieces++;
  const willSpin=vsIsSpin();
  const lockedKey=vsPiece.key;
  for(let r=0;r<vsPiece.shape.length;r++)for(let c=0;c<vsPiece.shape[r].length;c++){
    if(!vsPiece.shape[r][c])continue;
    const row=vsPiece.y+r,col=vsPiece.x+c;
    if(row<0){vsGameOver();return;}
    vsGrid[row][col]=pieceColors[vsPiece.key];
  }
  const cleared=vsClearLines(willSpin,lockedKey);
  vsSpawnNext(); vsHoldUsed=false;
  if(cleared===0&&vsGarbageQueue.length>0){
    addGarbage(vsGrid,vsGarbageQueue.shift());
    updateGarbageBar('vs-garbage-bar',vsGarbageQueue);
  }
  pushBoard();
}
function vsClearLines(spin,pieceKey){
  let cleared=0;
  for(let r=ROWS-1;r>=0;r--){
    if(vsGrid[r].every(c=>c)){vsGrid.splice(r,1);vsGrid.unshift(Array(COLS).fill(null));cleared++;r++;}
  }
  if(cleared===0){
    vsComboCount=0;
    if(spin) showSplash('vs-my-board-wrap','',pieceKey,true,'left');
    updateCounters('vs-my-board-wrap',0,vsB2bCount);
    return 0;
  }
  vsScore+=[0,100,300,500,800][cleared]*vsLevel;
  vsLines+=cleared; vsLevel=Math.floor(vsLines/10)+1;
  const hasColoredLeft=vsGrid.some(row=>row.some(c=>c&&c!=='#444455'));
  const hasGarbageLeft=vsGrid.some(row=>row.some(c=>c==='#444455'));
  const isPerfect=!hasColoredLeft&&!hasGarbageLeft;
  const isColoredClear=!hasColoredLeft&&hasGarbageLeft;
  const isB2BEligible=cleared>=4||spin;

  // Try to cancel incoming garbage first
  if(vsGarbageQueue.length>0){
    const cancelPow=getCancelPower(cleared,spin);
    const cancelled=applyCancel(vsGarbageQueue,cancelPow);
    if(cancelled>0){
      updateGarbageBar('vs-garbage-bar',vsGarbageQueue);
      showCancelSplash('vs-my-board-wrap',cancelled);
      if(isB2BEligible||isPerfect||isColoredClear) vsB2bCount++; else vsB2bCount=0;
      vsComboCount++;
      updateCounters('vs-my-board-wrap',vsComboCount,vsB2bCount);
      if(isPerfect||isColoredClear){
        showSplash('vs-my-board-wrap',null,pieceKey,spin,'left');
        showRainbowSplash('vs-my-board-wrap',isPerfect?'PERFECT CLEAR':'COLORED CLEAR','left');
      } else {
        showSplash('vs-my-board-wrap',['','SINGLE','DOUBLE','TRIPLE','QUAD'][Math.min(cleared,4)],pieceKey,spin,'left');
      }
      return cleared;
    }
  }

  // Normal attack flow
  let rawBase;
  if(isPerfect){rawBase=10;}
  else if(isColoredClear){rawBase=5;}
  else{rawBase=vsBaseAttack(cleared,spin)+(isB2BEligible?vsB2bBonus(vsB2bCount):0);}
  const garbage=Math.floor(rawBase*(1+0.2*vsComboCount));
  if(isB2BEligible||isPerfect||isColoredClear) vsB2bCount++; else vsB2bCount=0;
  vsComboCount++;
  updateCounters('vs-my-board-wrap',vsComboCount,vsB2bCount);
  if(garbage>0){
    vsLinesSent+=garbage;
    showAttackSplash('vs-my-board-wrap',garbage,(total)=>{
      if(!vsRunLoop)return;
      if(!db||!roomId||!myPlayerId)return;
      set(ref(db,`rooms/${roomId}/garbage/${Date.now()}`),{from:myPlayerId,lines:total});
    });
  }
  if(isPerfect||isColoredClear){
    showSplash('vs-my-board-wrap',null,pieceKey,spin,'left');
    showRainbowSplash('vs-my-board-wrap',isPerfect?'PERFECT CLEAR':'COLORED CLEAR','left');
  } else {
    showSplash('vs-my-board-wrap',['','SINGLE','DOUBLE','TRIPLE','QUAD'][Math.min(cleared,4)],pieceKey,spin,'left');
  }
  return cleared;
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
    board:serializeGrid(vsGrid), score:vsScore, lines:vsLines, alive:true,
    queue:vsQueue.slice(0,3), linesSent:vsLinesSent, pieces:vsPieces
  });
}

function updateOppBoard(data){
  const players=data.players||{};
  const elapsed=performance.now()-vsGameStartMs;
  const sec=elapsed/1000, min=sec/60;
  if(vsSpectating){
    const p1=Object.values(players).find(p=>p&&p.slot===1);
    const p2=Object.values(players).find(p=>p&&p.slot===2);
    if(p1){
      vsGrid=deserializeGrid(p1.board);
      if(Array.isArray(p1.queue)){vsQueue=[...p1.queue];drawVsPreviews();}
      document.getElementById('vs-lines').textContent=p1.lines||0;
      document.getElementById('vs-lines-sent').textContent=p1.linesSent||0;
      document.getElementById('vs-pieces').textContent=p1.pieces||0;
      document.getElementById('vs-apm').textContent=min>0.1?((p1.linesSent||0)/min).toFixed(1):'0';
      document.getElementById('vs-pps').textContent=sec>1?((p1.pieces||0)/sec).toFixed(2):'0.00';
    }
    if(p2){
      oppGrid=deserializeGrid(p2.board);
      if(Array.isArray(p2.queue)){oppNextQueue=p2.queue;drawOppPreviews();}
      document.getElementById('vs-opp-lines').textContent=p2.lines||0;
      document.getElementById('vs-opp-lines-sent').textContent=p2.linesSent||0;
      document.getElementById('vs-opp-pieces').textContent=p2.pieces||0;
      document.getElementById('vs-opp-apm').textContent=min>0.1?((p2.linesSent||0)/min).toFixed(1):'0';
      document.getElementById('vs-opp-pps').textContent=sec>1?((p2.pieces||0)/sec).toFixed(2):'0.00';
    }
    return;
  }
  const opp=Object.entries(players).find(([id])=>id!==myPlayerId);
  if(opp){
    const od=opp[1];
    oppGrid=deserializeGrid(od.board);
    document.getElementById('vs-opp-lines').textContent=od.lines||0;
    document.getElementById('vs-opp-lines-sent').textContent=od.linesSent||0;
    document.getElementById('vs-opp-pieces').textContent=od.pieces||0;
    document.getElementById('vs-opp-apm').textContent=min>0.1?((od.linesSent||0)/min).toFixed(1):'0';
    document.getElementById('vs-opp-pps').textContent=sec>1?((od.pieces||0)/sec).toFixed(2):'0.00';
    if(Array.isArray(od.queue)){oppNextQueue=od.queue;drawOppPreviews();}
    if(od.alive===false)handleVsWin();
  }
  const garb=data.garbage||{};
  let garbChanged=false;
  Object.entries(garb).forEach(([key,g])=>{
    if(g.from!==myPlayerId){vsGarbageQueue.push(g.lines);garbChanged=true;remove(ref(db,`rooms/${roomId}/garbage/${key}`));}
  });
  if(garbChanged) updateGarbageBar('vs-garbage-bar',vsGarbageQueue);
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
  myBoard.draw({
    grid:vsGrid, piece:vsPiece,
    ghostY:vsPiece?vsGhostY():null,
    lockFlashing:vsLockFlashing, lockBright:vsLockBright,
    ghostOpacity:cfg.ghostOpacity, gridOn:true,
  });
  oppBoard.draw({grid:oppGrid, gridOn:true});
  drawVsPreviews();drawOppPreviews();drawVsHold();
  vsRafId=requestAnimationFrame(vsLoop);
}
function vsSpectatorLoop(ts){
  myBoard.draw({grid:vsGrid, gridOn:true});
  oppBoard.draw({grid:oppGrid, gridOn:true});
  drawVsPreviews();drawOppPreviews();
  vsRafId=requestAnimationFrame(vsSpectatorLoop);
}

// VS rendering
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
