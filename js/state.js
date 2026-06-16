import { DEFAULT_BINDS } from './constants.js';

export const cfg = {
  mode:'marathon', subMode:null, ranked:false, practice:false,
  boardWidth:10, boardHeight:20,
  gravMode:'leveled', gravStatic:1.0,
  das:167, arr:33, sdf:10,
  kicks:'srs', previewCount:5, holdMode:'normal',
  ghostOpacity:0.30, gridOn:true, gridWidth:0.5, gridColor:'#222233', pieceOutline:true,
  sfxVolume:100, musicVolume:80,
  attackSplash:true, motionBlurTrail:5, motionBlurIntensity:5, boardBounce:5, boardElasticity:8, dropTrailIntensity:5, disintegrate:true, chromaticAberration:false, chromaticIntensity:5, overhang:false,
  invisibleLocked:false,
  colorShiftBpm:120, limboBpm:120, drunkBpm:120, circlesBpm:120,
  colorShift:false, limbo:false, drunk:false, circles:false,
  acid:false, acidMeter:5
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
    sfxVolume:cfg.sfxVolume, musicVolume:cfg.musicVolume,
    ghostOpacity:cfg.ghostOpacity, gridOn:cfg.gridOn, gridWidth:cfg.gridWidth, gridColor:cfg.gridColor, pieceOutline:cfg.pieceOutline, attackSplash:cfg.attackSplash, motionBlurTrail:cfg.motionBlurTrail, motionBlurIntensity:cfg.motionBlurIntensity, boardBounce:cfg.boardBounce, boardElasticity:cfg.boardElasticity, dropTrailIntensity:cfg.dropTrailIntensity, disintegrate:cfg.disintegrate, chromaticAberration:cfg.chromaticAberration, chromaticIntensity:cfg.chromaticIntensity,
    colorShiftBpm:cfg.colorShiftBpm, limboBpm:cfg.limboBpm, drunkBpm:cfg.drunkBpm, circlesBpm:cfg.circlesBpm,
    colorShift:cfg.colorShift, limbo:cfg.limbo, drunk:cfg.drunk, circles:cfg.circles,
    acid:cfg.acid, acidMeter:cfg.acidMeter
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
    if (s.ghostOpacity  !== undefined) cfg.ghostOpacity  = s.ghostOpacity;
    if (s.gridOn        !== undefined) cfg.gridOn        = s.gridOn;
    if (s.gridWidth     !== undefined) cfg.gridWidth     = s.gridWidth;
    if (s.gridColor     !== undefined) cfg.gridColor     = s.gridColor;
    if (s.pieceOutline   !== undefined) cfg.pieceOutline   = s.pieceOutline;
    if (s.attackSplash        !== undefined) cfg.attackSplash        = s.attackSplash;
    if (s.motionBlurTrail     !== undefined) cfg.motionBlurTrail     = s.motionBlurTrail;
    if (s.motionBlurIntensity !== undefined) cfg.motionBlurIntensity = s.motionBlurIntensity;
    if (s.boardBounce         !== undefined) cfg.boardBounce         = s.boardBounce;
    if (s.boardElasticity     !== undefined) cfg.boardElasticity     = s.boardElasticity;
    if (s.sfxVolume           !== undefined) cfg.sfxVolume           = s.sfxVolume;
    if (s.musicVolume         !== undefined) cfg.musicVolume         = s.musicVolume;
    if (s.dropTrailIntensity  !== undefined) cfg.dropTrailIntensity  = s.dropTrailIntensity;
    if (s.disintegrate          !== undefined) cfg.disintegrate          = s.disintegrate;
    if (s.chromaticAberration   !== undefined) cfg.chromaticAberration   = s.chromaticAberration;
    if (s.chromaticIntensity    !== undefined) cfg.chromaticIntensity    = s.chromaticIntensity;
    // migrate legacy single stupidBpm → per-effect BPMs
    const fallbackBpm = s.stupidBpm ?? 120;
    if (s.colorShiftBpm !== undefined) cfg.colorShiftBpm = s.colorShiftBpm; else if (s.stupidBpm !== undefined) cfg.colorShiftBpm = fallbackBpm;
    if (s.limboBpm      !== undefined) cfg.limboBpm      = s.limboBpm;      else if (s.stupidBpm !== undefined) cfg.limboBpm      = fallbackBpm;
    if (s.drunkBpm      !== undefined) cfg.drunkBpm      = s.drunkBpm;      else if (s.stupidBpm !== undefined) cfg.drunkBpm      = fallbackBpm;
    if (s.circlesBpm    !== undefined) cfg.circlesBpm    = s.circlesBpm;    else if (s.stupidBpm !== undefined) cfg.circlesBpm    = fallbackBpm;
    if (s.colorShift  !== undefined) cfg.colorShift  = s.colorShift;
    if (s.limbo       !== undefined) cfg.limbo       = s.limbo;
    if (s.drunk       !== undefined) cfg.drunk       = s.drunk;
    if (s.circles     !== undefined) cfg.circles     = s.circles;
    if (s.acid        !== undefined) cfg.acid        = s.acid;
    if (s.acidMeter   !== undefined) cfg.acidMeter   = s.acidMeter;
  } catch(e) {}
}

export function resetKeybinds() {
  Object.keys(DEFAULT_BINDS).forEach(k => { keybinds[k] = [...DEFAULT_BINDS[k]]; });
}
