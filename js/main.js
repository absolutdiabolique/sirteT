import { db } from './firebase.js';
import { loadGlobal, cfg, keybinds, checkBind, saveGlobal } from './state.js';
import { showScreen as _showScreen, drawMini } from './ui.js';
import { renderStats } from './stats.js';
import { syncSettingsUI, updateHandlingSummary, buildKeybindTable, buildPieceColorPickers,
  resetSettings, selectMode, selectedMode, applyPreset, readSetupCfg,
  getListeningFor, captureKey, selectSub } from './settings.js';
import { startGame, togglePause, stopGame, running, paused,
  hardDrop, doHold, tryRotate, tryRotate180,
  startDAS, stopDAS, startSoftDrop, stopSD,
  doUndo, doRedo, drawHold, buildPreviews } from './solo.js';
import { vsRunning, vsRunLoop, vsPiece, stopVsGame, createRoom, joinRoom,
  startVsGame, leaveRoom, rematchGame, vsStartDAS, vsStopDAS, vsStartSD, vsStopSD,
  vsTryRotate, vsTryRotate180, vsHardDrop, vsDoHold } from './vs.js';

// Full showScreen with side effects
function showScreen(id) {
  _showScreen(id);
  if (id === 'screen-stats') renderStats();
  if (id === 'screen-setup') { updateHandlingSummary(); selectMode(selectedMode || 'marathon'); }
  if (id === 'screen-menu') {
    if (running) stopGame();
    if (vsRunning) stopVsGame();
  }
}

function setFbStatus(s) {
  document.getElementById('fb-dot').className = 'fb-dot ' + s;
  document.getElementById('fb-label').textContent = s === 'ok' ? 'Online' : s === 'err' ? 'Offline' : '–';
}

// Window exposures
window.showScreen    = showScreen;
window.beginGame     = () => { readSetupCfg(); showScreen('screen-game'); startGame(); };
window.applyPreset   = applyPreset;
window.createRoom    = createRoom;
window.joinRoom      = joinRoom;
window.startVsGame   = startVsGame;
window.leaveRoom     = leaveRoom;
window.vsRematch     = rematchGame;
window.clearStats    = () => { if(confirm('Clear all stats?')) { localStorage.removeItem('sirtet_stats'); renderStats(); } };
window.resetSettings = resetSettings;
window.selectMode    = selectMode;
window.selectSub     = selectSub;
window.cfg           = cfg;
window.drawHold      = drawHold;

// Keyboard handler
document.addEventListener('keydown', e => {
  // Always block scroll keys
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();

  // Keybind capture mode
  if (captureKey(e.code)) {
    e.stopPropagation();
    return;
  }

  // Undo/redo
  if ((e.metaKey||e.ctrlKey) && e.code==='KeyZ') { e.preventDefault(); doUndo(); return; }
  if ((e.metaKey||e.ctrlKey) && e.code==='KeyY') { e.preventDefault(); doRedo(); return; }
  if (e.metaKey||e.ctrlKey) return;

  const onGame = document.getElementById('screen-game').classList.contains('active');
  const onVs   = document.getElementById('screen-vs').classList.contains('active');

  if (onGame) {
    if (!running && checkBind(e,'hardDrop')) { startGame(); return; }
    if (checkBind(e,'pause')) { if(running) togglePause(); return; }
    if (!running||paused) return;
    if (checkBind(e,'hardDrop'))   { hardDrop();       return; }
    if (checkBind(e,'hold'))       { doHold();         return; }
    if (checkBind(e,'rotateCW'))   { tryRotate(false); return; }
    if (checkBind(e,'rotateCCW'))  { tryRotate(true);  return; }
    if (checkBind(e,'rotate180'))  { tryRotate180();   return; }
    if (checkBind(e,'softDrop'))   { startSoftDrop();  return; }
    if (checkBind(e,'moveLeft'))   { startDAS(-1);     return; }
    if (checkBind(e,'moveRight'))  { startDAS(1);      return; }
  }
  if (onVs && vsRunLoop && vsPiece) {
    if (checkBind(e,'hardDrop'))   { vsHardDrop();      return; }
    if (checkBind(e,'hold'))       { vsDoHold();        return; }
    if (checkBind(e,'rotateCW'))   { vsTryRotate(false);return; }
    if (checkBind(e,'rotateCCW'))  { vsTryRotate(true); return; }
    if (checkBind(e,'rotate180'))  { vsTryRotate180();  return; }
    if (checkBind(e,'softDrop'))   { vsStartSD();       return; }
    if (checkBind(e,'moveLeft'))   { vsStartDAS(-1);    return; }
    if (checkBind(e,'moveRight'))  { vsStartDAS(1);     return; }
  }
}, { capture: true });

document.addEventListener('keyup', e => {
  const onGame = document.getElementById('screen-game').classList.contains('active');
  const onVs   = document.getElementById('screen-vs').classList.contains('active');
  if (onGame) {
    if (checkBind(e,'moveLeft')||checkBind(e,'moveRight')) stopDAS();
    if (checkBind(e,'softDrop')) stopSD();
  }
  if (onVs) {
    if (checkBind(e,'moveLeft')||checkBind(e,'moveRight')) vsStopDAS();
    if (checkBind(e,'softDrop')) vsStopSD();
  }
});

// Button wiring
document.getElementById('pause-btn').onclick   = () => { if(running) togglePause(); };
document.getElementById('restart-btn').onclick = startGame;

// Initialization
loadGlobal();
syncSettingsUI();
buildKeybindTable();
buildPieceColorPickers();
updateHandlingSummary();
selectMode('marathon');
setFbStatus(db ? 'ok' : 'err');

// Initial blank canvas draws
const boardEl   = document.getElementById('board');
const vsBoardEl = document.getElementById('vs-my-board');
const vsOppEl   = document.getElementById('vs-opp-board');
[boardEl, vsBoardEl, vsOppEl].forEach(c=>{c.getContext('2d').fillStyle='#0a0a0c';c.getContext('2d').fillRect(0,0,c.width,c.height);});
const hcanvas = document.getElementById('hold-canvas');
drawMini(hcanvas.getContext('2d'), null, hcanvas.width, hcanvas.height);
