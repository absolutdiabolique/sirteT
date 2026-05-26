import { SHAPES } from './constants.js';
import { pieceColors } from './state.js';

export function darken(hex) {
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgb(${Math.round(r*.45)},${Math.round(g*.45)},${Math.round(b*.45)})`;
}

export function drawMini(cx, key, cw, ch) {
  cx.fillStyle='#0a0a0c'; cx.fillRect(0,0,cw,ch);
  if(!key) return;
  const sh=SHAPES[key];
  const cs=Math.min(Math.floor((cw-8)/sh[0].length),Math.floor((ch-8)/sh.length));
  const ox=Math.floor((cw-sh[0].length*cs)/2), oy=Math.floor((ch-sh.length*cs)/2);
  cx.fillStyle=pieceColors[key];
  for(let r=0;r<sh.length;r++) for(let c=0;c<sh[r].length;c++)
    if(sh[r][c]) cx.fillRect(ox+c*cs+1,oy+r*cs+1,cs-2,cs-2);
}

export function fmtTime(ms) {
  if (ms == null) return '--';
  const m = Math.floor(ms/60000), sec = Math.floor((ms%60000)/1000), msec = ms%1000;
  return `${m}:${String(sec).padStart(2,'0')}.${String(msec).padStart(3,'0')}`;
}

export function splashHTML(text) {
  let digitIdx = 0;
  return Array.from(text).map(ch => {
    let delay = 0;
    if (/\d/.test(ch)) { delay = digitIdx * 100; digitIdx++; }
    return `<span class="splash-char" style="animation-delay:${delay}ms">${ch}</span>`;
  }).join('');
}

export function showSoloSplash(cleared, attack, isPerfectClear, isColoredClear, spin) {
  if (attack === 0 && !isPerfectClear && !isColoredClear) return;
  const boardWrap = document.getElementById('board-wrap');
  if (!boardWrap) return;

  const existing = boardWrap.querySelector('.vs-splash');
  const now = Date.now();
  if (existing && existing._splashTime && (now - existing._splashTime) < 1000) {
    existing._splashTotal = (existing._splashTotal || 0) + attack;
    existing._splashTime = now;
    clearTimeout(existing._splashTimeout);
    existing.innerHTML = splashHTML('+' + existing._splashTotal);
    existing._splashTimeout = setTimeout(() => existing.remove(), 1800);
    return;
  }
  if (existing) existing.remove();

  if (attack === 0) return;

  const el = document.createElement('div');
  el.className = 'vs-splash';
  el.innerHTML = splashHTML('+' + attack);
  el._splashTotal = attack;
  el._splashTime = now;
  boardWrap.style.position = 'relative';
  boardWrap.appendChild(el);
  el._splashTimeout = setTimeout(() => el.remove(), 1800);
}

export function showVsSplash(text, n) {
  const old=document.getElementById('vs-my-board-wrap').querySelector('.vs-splash');
  if(old)old.remove();
  const el=document.createElement('div'); el.className='vs-splash'; el.innerHTML=splashHTML(text);
  document.getElementById('vs-my-board-wrap').appendChild(el);
  setTimeout(()=>el.remove(),1800);
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
