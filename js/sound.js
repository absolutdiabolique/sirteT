import { cfg } from './state.js';

export function playSfx(name) {
  const a = new Audio(`sfx/${name}`);
  a.volume = Math.max(0, Math.min(1, cfg.sfxVolume / 100));
  a.play().catch(() => {});
}

// Web Audio API for pitch-shifted playback (used for combo tones)
let _audioCtx = null;
const _bufferCache = new Map();
function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
async function _loadBuffer(url) {
  if (_bufferCache.has(url)) return _bufferCache.get(url);
  const ctx = _getAudioCtx();
  const resp = await fetch(url);
  const data = await resp.arrayBuffer();
  const buf = await ctx.decodeAudioData(data);
  _bufferCache.set(url, buf);
  return buf;
}
export async function playSfxPitched(name, tones) {
  try {
    const ctx = _getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = await _loadBuffer(`sfx/${name}`);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, tones / 6); // 1 full tone = 2 semitones = 2^(2/12) per tone
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, cfg.sfxVolume / 100));
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch(e) {}
}

let _bgm = null;
export function startMusic(src) {
  stopMusic();
  _bgm = new Audio(src);
  _bgm.loop = true;
  _bgm.volume = Math.max(0, Math.min(1, cfg.musicVolume / 100));
  _bgm.play().catch(() => {});
}
export function stopMusic() {
  if (!_bgm) return;
  _bgm.pause();
  _bgm.currentTime = 0;
  _bgm = null;
}
export function setMusicVolume(pct) {
  if (_bgm) _bgm.volume = Math.max(0, Math.min(1, pct / 100));
}

export const CD_SFX_LEAD     = 0;
export const CD_DELAY_3      = 1000;
export const CD_DELAY_2      = 1000;
export const CD_DELAY_1      = 1000;
export const CD_GO_CALLBACK  = 450;
export const CD_GO_FADE_DUR  = 2000;
export const CD_GO_BLOOM_DUR = '3s';
