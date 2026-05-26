import { COLS, ROWS, PKEYS, ROTATIONS } from './constants.js';

export function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed>>>15, 1|seed);
    t = t + Math.imul(t ^ t>>>7, 61|t) ^ t;
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  };
}

export function buildSharedSeq(seed) {
  const rng = mulberry32(seed), seq = [];
  for (let b=0; b<200; b++) {
    const arr = [...PKEYS];
    for (let i=arr.length-1; i>0; i--) { const j=Math.floor(rng()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
    seq.push(...arr);
  }
  return seq;
}

export function fillBag(b) {
  const arr = [...PKEYS];
  for (let i=arr.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  b.push(...arr);
}

export function mkGrid()  { return Array.from({length:ROWS}, () => Array(COLS).fill(null)); }

export function mkPiece(k) {
  const sh = ROTATIONS[k][0].map(r => [...r]); // always spawn at state 0
  return { shape:sh, key:k, rot:0, x:Math.floor(COLS/2)-Math.floor(sh[0].length/2), y:0 };
}

export function collide(sh, x, y, g) {
  for (let r=0; r<sh.length; r++) for (let c=0; c<sh[r].length; c++) {
    if (!sh[r][c]) continue;
    const nx=x+c, ny=y+r;
    if (nx<0||nx>=COLS||ny>=ROWS) return true;
    if (ny>=0 && g[ny][nx]) return true;
  }
  return false;
}
