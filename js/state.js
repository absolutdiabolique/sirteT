import { DEFAULT_BINDS } from './constants.js';

export const cfg = {
  mode:'marathon', subMode:null, ranked:false, practice:false,
  gravMode:'leveled', gravStatic:1.0,
  das:167, arr:33, sdf:10,
  kicks:'srs', previewCount:5, holdMode:'normal',
  ghostOpacity:0.30, gridOn:true, gridWidth:0.5, gridColor:'#222233',
  invisibleLocked:false
};

export const keybinds = JSON.parse(JSON.stringify(DEFAULT_BINDS));

export const pieceColors = {I:'#22d3ee',O:'#fde047',T:'#a855f7',S:'#4ade80',Z:'#f87171',J:'#60a5fa',L:'#fb923c'};

export function keyLabel(code) {
  if (!code) return '–';
  const m = {Space:'Space',ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓',
    ShiftLeft:'Shift',ShiftRight:'Shift',ControlLeft:'Ctrl',ControlRight:'Ctrl',MetaLeft:'Cmd',MetaRight:'Cmd'};
  if (m[code]) return m[code];
  if (code.startsWith('Key'))   return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

export function checkBind(e, action) {
  return keybinds[action][0] === e.code || keybinds[action][1] === e.code;
}

export function saveGlobal() {
  localStorage.setItem('sirtet_global', JSON.stringify({
    das:cfg.das, arr:cfg.arr, sdf:cfg.sdf, keybinds, pieceColors,
    ghostOpacity:cfg.ghostOpacity, gridOn:cfg.gridOn, gridWidth:cfg.gridWidth, gridColor:cfg.gridColor
  }));
}

export function loadGlobal() {
  try {
    const s = JSON.parse(localStorage.getItem('sirtet_global') || 'null');
    if (!s) return;
    if (s.das !== undefined) cfg.das = s.das;
    if (s.arr !== undefined) cfg.arr = s.arr;
    if (s.sdf !== undefined) cfg.sdf = s.sdf;
    if (s.keybinds)    Object.assign(keybinds, s.keybinds);
    if (s.pieceColors) Object.assign(pieceColors, s.pieceColors);
    if (s.ghostOpacity !== undefined) cfg.ghostOpacity = s.ghostOpacity;
    if (s.gridOn      !== undefined) cfg.gridOn      = s.gridOn;
    if (s.gridWidth   !== undefined) cfg.gridWidth   = s.gridWidth;
    if (s.gridColor   !== undefined) cfg.gridColor   = s.gridColor;
  } catch(e) {}
}

export function resetKeybinds() {
  Object.keys(DEFAULT_BINDS).forEach(k => { keybinds[k] = [...DEFAULT_BINDS[k]]; });
}
