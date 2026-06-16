import { SHAPES } from './constants.js';
import { pieceColors, cfg } from './state.js';
import { playSfx, CD_SFX_LEAD, CD_DELAY_3, CD_DELAY_2, CD_DELAY_1, CD_GO_CALLBACK, CD_GO_FADE_DUR, CD_GO_BLOOM_DUR } from './sound.js';

export function darken(hex) {
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgb(${Math.round(r*.45)},${Math.round(g*.45)},${Math.round(b*.45)})`;
}

export function lighten(hex) {
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgb(${Math.round(r+(255-r)*.55)},${Math.round(g+(255-g)*.55)},${Math.round(b+(255-b)*.55)})`;
}

export function drawMini(cx, key, cw, ch) {
  cx.fillStyle='#0a0a0c'; cx.fillRect(0,0,cw,ch);
  if(!key) return;
  const sh=SHAPES[key];
  const cs=Math.min(Math.floor((cw-8)/sh[0].length),Math.floor((ch-8)/sh.length));
  const ox=Math.floor((cw-sh[0].length*cs)/2), oy=Math.floor((ch-sh.length*cs)/2);
  const color=pieceColors[key];
  cx.fillStyle=color;
  if (cfg.pieceOutline) {
    for(let r=0;r<sh.length;r++) for(let c=0;c<sh[r].length;c++)
      if(sh[r][c]) cx.fillRect(ox+c*cs, oy+r*cs, cs, cs);
    cx.save();
    cx.beginPath();
    for(let r=0;r<sh.length;r++) for(let c=0;c<sh[r].length;c++)
      if(sh[r][c]) cx.rect(ox+c*cs, oy+r*cs, cs, cs);
    cx.clip();
    cx.strokeStyle=lighten(color); cx.lineWidth=4;
    cx.beginPath();
    for(let r=0;r<sh.length;r++) for(let c=0;c<sh[r].length;c++) {
      if(!sh[r][c]) continue;
      const px=ox+c*cs, py=oy+r*cs;
      if(!sh[r-1]?.[c]) { cx.moveTo(px,py);    cx.lineTo(px+cs,py);    }
      if(!sh[r+1]?.[c]) { cx.moveTo(px,py+cs); cx.lineTo(px+cs,py+cs); }
      if(!sh[r]?.[c-1]) { cx.moveTo(px,py);    cx.lineTo(px,py+cs);    }
      if(!sh[r]?.[c+1]) { cx.moveTo(px+cs,py); cx.lineTo(px+cs,py+cs); }
    }
    cx.stroke();
    cx.fillStyle = lighten(color);
    const W = sh[0]?.length ?? 0;
    for (let r = 0; r <= sh.length; r++) {
      for (let c = 0; c <= W; c++) {
        const TL = sh[r-1]?.[c-1], TR = sh[r-1]?.[c];
        const BL = sh[r]?.[c-1],   BR = sh[r]?.[c];
        const px = ox + c * cs, py = oy + r * cs;
        if      ( TL &&  TR &&  BL && !BR) cx.fillRect(px - 2, py - 2, 2, 2);
        else if ( TL &&  TR && !BL &&  BR) cx.fillRect(px,     py - 2, 2, 2);
        else if ( TL && !TR &&  BL &&  BR) cx.fillRect(px - 2, py,     2, 2);
        else if (!TL &&  TR &&  BL &&  BR) cx.fillRect(px,     py,     2, 2);
      }
    }
    cx.restore();
  } else {
    for(let r=0;r<sh.length;r++) for(let c=0;c<sh[r].length;c++)
      if(sh[r][c]) cx.fillRect(ox+c*cs+1,oy+r*cs+1,cs-2,cs-2);
  }
}

export function fmtTime(ms) {
  if (ms == null) return '--';
  const m = Math.floor(ms/60000), sec = Math.floor((ms%60000)/1000), msec = ms%1000;
  return `${m}:${String(sec).padStart(2,'0')}.${String(msec).padStart(3,'0')}`;
}

// Per-wrapId splash state map
const _splashState = {};

function _makeSplashDigits(text) {
  return Array.from(text).map((ch, i) =>
    `<span class="attack-digit" style="--digit-delay:${i * 50}ms">${ch}</span>`
  ).join('');
}

function _startSplash(wrap, wrapId, total, onComplete) {
  const el = document.createElement('div');
  el.className = 'attack-splash';
  el.innerHTML = _makeSplashDigits('' + total);
  wrap.appendChild(el);

  const state = { element: el, total, onComplete, spawnTime: performance.now() };
  state.fadeTimeout = setTimeout(() => {
    el.classList.add('fading');
    state.removeTimeout = setTimeout(() => {
      el.remove();
      delete _splashState[wrapId];
      if (onComplete) onComplete(total);
    }, 100);
  }, 900);
  _splashState[wrapId] = state;
}

export function showAttackSplash(wrapId, amount, onComplete, stackAllowed = true) {
  if (!amount || amount <= 0) return;
  if (!cfg.attackSplash) { if (onComplete) onComplete(amount); return; }
  const wrap = document.getElementById(wrapId);
  if (!wrap) { if (onComplete) onComplete(amount); return; }

  const s = _splashState[wrapId];
  const withinWindow = s && (performance.now() - s.spawnTime < 1000);
  if (s && stackAllowed && withinWindow) {
    clearTimeout(s.fadeTimeout);
    clearTimeout(s.removeTimeout);
    if (s.element) s.element.remove();
    _startSplash(wrap, wrapId, s.total + amount, s.onComplete);
  } else {
    if (s) {
      clearTimeout(s.fadeTimeout);
      clearTimeout(s.removeTimeout);
      if (s.element) s.element.remove();
    }
    _startSplash(wrap, wrapId, amount, onComplete);
  }
}

// ── Cancel splash ─────────────────────────────────────────────
const _cancelState = {};

function _startCancelSplash(wrap, wrapId, total) {
  const el = document.createElement('div');
  el.className = 'cancel-splash';
  el.innerHTML = Array.from('' + total).map((ch, i) =>
    `<span class="cancel-digit" style="--digit-delay:${i * 50}ms">${ch}</span>`
  ).join('');
  wrap.appendChild(el);
  const state = { element: el, total };
  state.fadeTimeout = setTimeout(() => {
    el.classList.add('fading');
    state.removeTimeout = setTimeout(() => {
      el.remove();
      delete _cancelState[wrapId];
    }, 100);
  }, 900);
  _cancelState[wrapId] = state;
}

export function showCancelSplash(wrapId, amount) {
  if (!amount || amount <= 0) return;
  if (!cfg.attackSplash) return;
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const s = _cancelState[wrapId];
  if (s) {
    clearTimeout(s.fadeTimeout);
    clearTimeout(s.removeTimeout);
    if (s.element) s.element.remove();
    _startCancelSplash(wrap, wrapId, s.total + amount);
  } else {
    _startCancelSplash(wrap, wrapId, amount);
  }
}

export function clearCancelSplash(wrapId) {
  const s = _cancelState[wrapId];
  if (!s) return;
  clearTimeout(s.fadeTimeout);
  clearTimeout(s.removeTimeout);
  if (s.element) s.element.remove();
  delete _cancelState[wrapId];
}

// ── Garbage bar ───────────────────────────────────────────────
const PX_PER_ROW = 28; // VS_SZ = 28; 1 garbage row = 1 board cell height

export function updateGarbageBar(barId, queue) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  bar.innerHTML = '';
  for (let i = 0; i < queue.length; i++) {
    if (i > 0) {
      const sep = document.createElement('div');
      sep.className = 'garbage-seg-sep';
      bar.appendChild(sep);
    }
    const seg = document.createElement('div');
    seg.className = 'garbage-seg';
    seg.style.height = (queue[i] * PX_PER_ROW) + 'px';
    bar.appendChild(seg);
  }
}

export function clearAttackSplash(wrapId) {
  const s = _splashState[wrapId];
  if (!s) return;
  clearTimeout(s.fadeTimeout);
  clearTimeout(s.removeTimeout);
  if (s.element) s.element.remove();
  delete _splashState[wrapId];
}

export function updateCounters(wrapId, comboCount, b2bCount) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const comboEl = wrap.querySelector('.combo-display');
  const b2bEl   = wrap.querySelector('.b2b-display');
  if (comboEl) {
    comboEl.textContent = comboCount > 0 ? `${comboCount} COMBO` : '';
    comboEl.classList.toggle('active', comboCount > 0);
  }
  if (b2bEl) {
    b2bEl.textContent = b2bCount > 0 ? `B2B ${b2bCount}` : '';
    b2bEl.classList.toggle('active', b2bCount > 0);
  }
}

export function showRainbowSplash(wrapId, text, side = 'left') {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.querySelectorAll('.clear-splash').forEach(el => el.remove());
  const el = document.createElement('div');
  el.className = `clear-splash side-${side}`;
  const colors = Object.values(pieceColors);
  let ci = 0;
  el.innerHTML = Array.from(text).map(ch => {
    if (ch === ' ') return ' ';
    const color = colors[ci++ % colors.length];
    return `<span style="color:${color}">${ch}</span>`;
  }).join('');
  wrap.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

export function showSplash(wrapId, label, pieceKey, spin, side='left') {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.querySelectorAll('.clear-splash,.spin-splash').forEach(el => el.remove());
  if (label) {
    const el = document.createElement('div');
    el.className = `clear-splash side-${side}`;
    el.textContent = label;
    wrap.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
  if (spin && pieceKey) {
    const spinEl = document.createElement('div');
    spinEl.className = `spin-splash side-${side}`;
    spinEl.textContent = `${pieceKey}-SPIN`;
    spinEl.style.color = pieceColors[pieceKey];
    wrap.appendChild(spinEl);
    spinEl.addEventListener('animationend', () => spinEl.remove());
  }
}


// Bloom: sharp source + an expanding ghost copy that fades and darkens over 1 s.
// The ghost starts at the same size/position and scales outward (cdBloom keyframe),
// simulating the outward bloom of a bright flash.
function bloomHtml(content, baseStyle, bloomDuration = null) {
  const bloomStyle = bloomDuration ? ` style="animation-duration:${bloomDuration}"` : '';
  return `<div style="position:relative;display:flex;align-items:center;justify-content:center;">
    <div class="cd-bloom"${bloomStyle}><div style="${baseStyle}">${content}</div></div>
    <div style="${baseStyle}">${content}</div>
  </div>`;
}

// 3-2-1-GO! countdown on one or more board wraps (pass string or array of IDs).
// Calls cb() after "GO!" — only if the first wrap's parent screen is still active.
export function showCountdown(wrapIds, cb) {
  const ids   = Array.isArray(wrapIds) ? wrapIds : [wrapIds];
  const wraps = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (!wraps.length) { cb(); return; }
  playSfx('countdown.wav');

  const st  = "font-family:'Space Mono',monospace;font-weight:700;line-height:1;text-align:center;";

  const els = wraps.map(wrap => {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;z-index:60;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(10,10,12,0.72);pointer-events:none;';
    wrap.appendChild(el);
    return el;
  });

  const steps  = [3, 2, 1, 'GO!'];
  const delays = [CD_DELAY_3, CD_DELAY_2, CD_DELAY_1];
  let i = 0;

  function tick() {
    const n  = steps[i++];
    const go = n === 'GO!';
    const html = go
      ? bloomHtml('GO!', `${st}font-size:52px;letter-spacing:0.12em;color:var(--accent2);`, CD_GO_BLOOM_DUR)
      : bloomHtml(String(n), `${st}font-size:88px;color:var(--accent);`);
    els.forEach(el => el.innerHTML = html);
    if (!go) {
      setTimeout(tick, delays[i - 1]);
    } else {
      setTimeout(() => {
        const screen = wraps[0].closest('.screen');
        if (!screen || screen.classList.contains('active')) cb();
      }, CD_GO_CALLBACK);
      els.forEach(el => {
        el.style.transition = `opacity ${CD_GO_FADE_DUR}ms ease-out`;
        el.style.opacity = '0';
      });
      setTimeout(() => els.forEach(el => el.remove()), CD_GO_FADE_DUR);
    }
  }
  setTimeout(tick, CD_SFX_LEAD);
}

// Only the DOM part — no side effects
export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

let toastTimer = null;
export function showToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),1600);
}
