import { db } from './firebase.js';
import { loadGlobal, cfg, keybinds, checkBind, saveGlobal } from './state.js';
import { showScreen as _showScreen, drawMini } from './ui.js';
import { renderStats, setUploader } from './stats.js';
import { initAuth, signUp, logIn, logOut, uploadPB,
  currentUser, currentUsername, changeUsername, deleteData, deleteAccount } from './account.js';
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
import { botRunning, botRunLoop, botPiece, startBotGame, stopBotGame, botRematchGame,
  botStartDAS, botStopDAS, botStartSD, botStopSD,
  botTryRotate, botTryRotate180, botHardDrop, botDoHold } from './bot.js';
import { qpRunning, qpPiece, startQpGame, stopQpGame,
  qpStartDAS, qpStopDAS, qpStartSD, qpStopSD,
  qpTryRotate, qpTryRotate180, qpHardDrop, qpDoHold } from './qp.js';
import { mrRunning, mrPiece, stopMrGame, leaveMrRoom,
  createMrRoom, joinMrRoom, startMrGameFromHost, onMrSettingChange,
  mrStartDAS, mrStopDAS, mrStartSD, mrStopSD,
  mrTryRotate, mrTryRotate180, mrHardDrop, mrDoHold } from './mr.js';

// Full showScreen with side effects
function showScreen(id) {
  _showScreen(id);
  if (id === 'screen-stats')   renderStats();
  if (id === 'screen-setup')   { updateHandlingSummary(); selectMode(selectedMode || 'sprint'); }
  if (id === 'screen-account') refreshAccountScreen();
  if (id === 'screen-menu' || id === 'screen-menu-solo' || id === 'screen-menu-pvp' || id === 'screen-menu-config') {
    if (running) stopGame();
    if (vsRunning) stopVsGame();
    if (botRunning) stopBotGame();
    if (qpRunning) stopQpGame();
    if (mrRunning) stopMrGame();
  }
}

function setFbStatus(s) {
  document.getElementById('fb-dot').className = 'fb-dot ' + s;
  document.getElementById('fb-label').textContent = s === 'ok' ? 'Online' : s === 'err' ? 'Offline' : '–';
}

// Window exposures
window.showScreen    = showScreen;
window.beginGame     = () => { readSetupCfg(); showScreen('screen-game'); startGame(); };
window.beginBotGame  = () => {
  showScreen('screen-bot');
  const pps   = parseFloat(document.getElementById('bot-pps-input').value) || 1.5;
  const aiVer = parseInt(document.getElementById('bot-ai-select').value) || 1;
  startBotGame(pps, aiVer);
};
window.applyPreset   = applyPreset;
window.createRoom    = createRoom;
window.joinRoom      = joinRoom;
window.startVsGame   = startVsGame;
window.leaveRoom     = leaveRoom;
window.vsRematch     = rematchGame;
window.botRematch    = botRematchGame;
window.beginQpGame   = () => {
  if (!currentUser()) { showToast('Sign in to play Quick Play'); showScreen('screen-account'); return; }
  showScreen('screen-qp');
  startQpGame();
};
window.leaveQpGame   = () => { stopQpGame(); showScreen('screen-menu'); };
window.createMrRoom          = createMrRoom;
window.joinMrRoom            = joinMrRoom;
window.startMrGameFromHost   = startMrGameFromHost;
window.onMrSettingChange     = onMrSettingChange;
window.leaveMrRoom           = leaveMrRoom;
window.leaveMrGame           = leaveMrRoom;
window.clearStats    = () => { if(confirm('Clear all stats?')) { localStorage.removeItem('sirtet_stats'); renderStats(); } };

// ── Account screen ────────────────────────────────────────────
function fmtAuthErr(e) {
  return e.message.replace('Firebase: ', '').replace(/ \(auth\/[^)]+\)\.?/, '');
}

function refreshAccountScreen() {
  const user     = currentUser();
  const username = currentUsername();
  const guestEl  = document.getElementById('account-guest');
  const userEl   = document.getElementById('account-user');
  if (!guestEl || !userEl) return;
  if (user) {
    guestEl.style.display = 'none';
    userEl.style.display  = 'block';
    const unEl = document.getElementById('account-username-display');
    const emEl = document.getElementById('account-email-display');
    const inEl = document.getElementById('account-new-username');
    if (unEl) unEl.textContent = username || '—';
    if (emEl) emEl.textContent = user.email;
    if (inEl) inEl.value       = username || '';
    document.getElementById('account-username-err').textContent = '';
  } else {
    guestEl.style.display = 'block';
    userEl.style.display  = 'none';
    document.getElementById('auth-email').value    = '';
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-error').textContent = '';
  }
}

function updateAuthBar(user, username) {
  const statusEl = document.getElementById('auth-status');
  if (!statusEl) return;
  if (user) {
    statusEl.textContent = username || user.email;
    statusEl.style.color = 'var(--accent2)';
  } else {
    statusEl.textContent = 'Sign in to sync PBs across devices';
    statusEl.style.color = 'var(--muted)';
  }
}

window.doSignUp = async function() {
  const email = document.getElementById('auth-email').value.trim();
  const pw    = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  try { await signUp(email, pw); }
  catch(e) { errEl.textContent = fmtAuthErr(e); }
};

window.doLogIn = async function() {
  const email = document.getElementById('auth-email').value.trim();
  const pw    = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  try { await logIn(email, pw); }
  catch(e) { errEl.textContent = fmtAuthErr(e); }
};

window.doLogOut = async function() { await logOut(); };

window.doChangeUsername = async function() {
  const val    = document.getElementById('account-new-username').value.trim();
  const errEl  = document.getElementById('account-username-err');
  errEl.textContent = '';
  try {
    await changeUsername(val);
    document.getElementById('account-username-display').textContent = val;
    updateAuthBar(currentUser(), val);
    errEl.style.color   = 'var(--accent2)';
    errEl.textContent   = 'Username updated.';
    setTimeout(() => { errEl.textContent = ''; errEl.style.color = ''; }, 2000);
  } catch(e) {
    errEl.style.color = '';
    errEl.textContent = e.message;
  }
};

window.doDeleteData = async function() {
  if (!confirm('Delete all your personal bests? This cannot be undone.')) return;
  try {
    await deleteData();
    renderStats();
    alert('Data deleted.');
  } catch(e) { alert(e.message); }
};

window.doDeleteAccount = async function() {
  if (!confirm('Permanently delete your account and all data? This cannot be undone.')) return;
  try {
    await deleteAccount();
  } catch(e) {
    if (e.code === 'auth/requires-recent-login') {
      alert('Please sign out and sign back in, then try again.');
    } else {
      alert(e.message);
    }
  }
};
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
  const onBot  = document.getElementById('screen-bot').classList.contains('active');
  const onQp   = document.getElementById('screen-qp').classList.contains('active');
  const onMr   = document.getElementById('screen-mr').classList.contains('active');

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
  if (onBot && botRunLoop && botPiece) {
    if (checkBind(e,'hardDrop'))   { botHardDrop();       return; }
    if (checkBind(e,'hold'))       { botDoHold();         return; }
    if (checkBind(e,'rotateCW'))   { botTryRotate(false); return; }
    if (checkBind(e,'rotateCCW'))  { botTryRotate(true);  return; }
    if (checkBind(e,'rotate180'))  { botTryRotate180();   return; }
    if (checkBind(e,'softDrop'))   { botStartSD();        return; }
    if (checkBind(e,'moveLeft'))   { botStartDAS(-1);     return; }
    if (checkBind(e,'moveRight'))  { botStartDAS(1);      return; }
  }
  if (onQp && qpRunning && qpPiece) {
    if (checkBind(e,'hardDrop'))   { qpHardDrop();       return; }
    if (checkBind(e,'hold'))       { qpDoHold();         return; }
    if (checkBind(e,'rotateCW'))   { qpTryRotate(false); return; }
    if (checkBind(e,'rotateCCW'))  { qpTryRotate(true);  return; }
    if (checkBind(e,'rotate180'))  { qpTryRotate180();   return; }
    if (checkBind(e,'softDrop'))   { qpStartSD();        return; }
    if (checkBind(e,'moveLeft'))   { qpStartDAS(-1);     return; }
    if (checkBind(e,'moveRight'))  { qpStartDAS(1);      return; }
  }
  if (onMr && mrRunning && mrPiece) {
    if (checkBind(e,'hardDrop'))   { mrHardDrop();       return; }
    if (checkBind(e,'hold'))       { mrDoHold();         return; }
    if (checkBind(e,'rotateCW'))   { mrTryRotate(false); return; }
    if (checkBind(e,'rotateCCW'))  { mrTryRotate(true);  return; }
    if (checkBind(e,'rotate180'))  { mrTryRotate180();   return; }
    if (checkBind(e,'softDrop'))   { mrStartSD();        return; }
    if (checkBind(e,'moveLeft'))   { mrStartDAS(-1);     return; }
    if (checkBind(e,'moveRight'))  { mrStartDAS(1);      return; }
  }
}, { capture: true });

document.addEventListener('keyup', e => {
  const onGame = document.getElementById('screen-game').classList.contains('active');
  const onVs   = document.getElementById('screen-vs').classList.contains('active');
  const onBot  = document.getElementById('screen-bot').classList.contains('active');
  const onQp   = document.getElementById('screen-qp').classList.contains('active');
  const onMr   = document.getElementById('screen-mr').classList.contains('active');
  if (onGame) {
    if (checkBind(e,'moveLeft')||checkBind(e,'moveRight')) stopDAS();
    if (checkBind(e,'softDrop')) stopSD();
  }
  if (onVs) {
    if (checkBind(e,'moveLeft')||checkBind(e,'moveRight')) vsStopDAS();
    if (checkBind(e,'softDrop')) vsStopSD();
  }
  if (onBot) {
    if (checkBind(e,'moveLeft')||checkBind(e,'moveRight')) botStopDAS();
    if (checkBind(e,'softDrop')) botStopSD();
  }
  if (onQp) {
    if (checkBind(e,'moveLeft')||checkBind(e,'moveRight')) qpStopDAS();
    if (checkBind(e,'softDrop')) qpStopSD();
  }
  if (onMr) {
    if (checkBind(e,'moveLeft')||checkBind(e,'moveRight')) mrStopDAS();
    if (checkBind(e,'softDrop')) mrStopSD();
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
selectMode('sprint');
setFbStatus(db ? 'ok' : 'err');
setUploader(uploadPB);
initAuth((user, username) => {
  updateAuthBar(user, username);
  refreshAccountScreen();
  if (document.getElementById('screen-stats').classList.contains('active')) renderStats();
});

// Initial blank canvas draws
const boardEl   = document.getElementById('board');
const vsBoardEl = document.getElementById('vs-my-board');
const vsOppEl   = document.getElementById('vs-opp-board');
[boardEl, vsBoardEl, vsOppEl].forEach(c=>{c.getContext('2d').fillStyle='#0a0a0c';c.getContext('2d').fillRect(0,0,c.width,c.height);});
const hcanvas = document.getElementById('hold-canvas');
drawMini(hcanvas.getContext('2d'), null, hcanvas.width, hcanvas.height);
