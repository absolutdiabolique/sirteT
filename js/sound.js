import { cfg } from './state.js';

let _audioCtx = null;
const _bufferCache = new Map(); // url -> AudioBuffer (decoded, ready to play)
const _rawCache    = new Map(); // url -> ArrayBuffer (fetched, pending decode)

// Prefetch all SFX at module load — pure network fetch, no AudioContext needed
const _SFX_FILES = ['rotate.wav','harddrop.wav','move.wav','pc.wav','clear.wav','countdown.wav'];
for (const name of _SFX_FILES) {
  const url = `sfx/${name}`;
  fetch(url).then(r => r.arrayBuffer()).then(ab => {
    _rawCache.set(url, ab);
    if (_audioCtx) _decodeRaw(url, ab);
  }).catch(() => {});
}

async function _decodeRaw(url, ab) {
  if (_bufferCache.has(url) || !_audioCtx) return;
  try {
    _bufferCache.set(url, await _audioCtx.decodeAudioData(ab));
  } catch(e) {}
}

function _getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Decode anything already fetched before the context existed
    for (const [url, ab] of _rawCache) _decodeRaw(url, ab);
  }
  return _audioCtx;
}

async function _loadBuffer(url) {
  if (_bufferCache.has(url)) return _bufferCache.get(url);
  const ctx = _getAudioCtx();
  const ab = _rawCache.get(url) || await fetch(url).then(r => r.arrayBuffer());
  const buf = await ctx.decodeAudioData(ab);
  _bufferCache.set(url, buf);
  return buf;
}

export function playSfx(name) {
  try {
    const ctx = _getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const vol = Math.max(0, Math.min(1, cfg.sfxVolume / 100));
    const url = `sfx/${name}`;
    const buf = _bufferCache.get(url);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = vol;
      src.connect(gain); gain.connect(ctx.destination);
      src.start();
    } else {
      // Buffer not decoded yet — Audio element fallback, trigger decode for next time
      const a = new Audio(url);
      a.volume = vol;
      a.play().catch(() => {});
      _loadBuffer(url).catch(() => {});
    }
  } catch(e) {}
}

function _playOscTone(ctx, freq, startTime, duration, vol) {
  const partials = [[1, 1.0, 1.0], [2, 0.4, 0.6], [3, 0.15, 0.35], [4, 0.06, 0.2]];
  for (const [mult, relVol, decayFrac] of partials) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    gain.gain.setValueAtTime(vol * relVol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration * decayFrac);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }
}

// Pitch-swept bass "kick" gives physical impact feel; heavy mode adds sub-bass rumble
function _playImpact(ctx, startTime, vol, heavy) {
  if (vol <= 0.001) return;
  const startFreq = heavy ? 220 : 150;
  const endFreq   = heavy ? 35  : 45;
  const decay     = heavy ? 0.22 : 0.15;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, startTime);
  osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + decay * 0.6);
  gain.gain.setValueAtTime(vol, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + decay);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(startTime); osc.stop(startTime + decay + 0.05);
  if (heavy) {
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = 55;
    subGain.gain.setValueAtTime(vol * 0.55, startTime);
    subGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);
    sub.connect(subGain); subGain.connect(ctx.destination);
    sub.start(startTime); sub.stop(startTime + 0.22);
  }
}

// combo 0-11: ascending whole-tone scale; combo 12+: binary bits as H/L notes
// lines: lines cleared (1-4); isSpin: T-spin/spin clear
export function playLineClearTone(combo, lines = 1, isSpin = false) {
  try {
    const ctx = _getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const vol = Math.max(0, Math.min(1, cfg.sfxVolume / 100));
    const now = ctx.currentTime;
    const toneVol = vol * 0.6;
    if (combo < 12) {
      const freq = 220 * Math.pow(2, combo / 6);
      _playOscTone(ctx, freq, now, 0.5, toneVol);
    } else {
      const bits = combo.toString(2);
      const step = 0.07, dur = 0.18;
      bits.split('').forEach((bit, i) => {
        _playOscTone(ctx, bit === '1' ? 1760 : 880, now + i * step, dur, toneVol * 0.7);
      });
    }
    // Impact scales with lines; quads and spins get the heavy (sub-bass) treatment
    const heavy = lines >= 4 || isSpin;
    const impactScale = [0, 0.3, 0.5, 0.72, 1.2][Math.min(lines, 4)] + (isSpin ? 0.45 : 0);
    _playImpact(ctx, now, vol * impactScale * 0.9, heavy);
  } catch(e) {}
}

export async function playSfxPitched(name, tones) {
  try {
    const ctx = _getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = await _loadBuffer(`sfx/${name}`);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, tones / 6);
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
