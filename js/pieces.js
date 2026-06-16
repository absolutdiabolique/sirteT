import { PKEYS, ROTATIONS, COLS, ROWS } from './constants.js';

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

// cols/rows default to the standard constants; solo passes cfg values explicitly.
export function mkGrid(cols = COLS, rows = ROWS) {
  return Array.from({length:rows}, () => Array(cols).fill(null));
}

export function mkPiece(k, cols = COLS) {
  const sh = ROTATIONS[k][0].map(r => [...r]); // always spawn at state 0
  return { shape:sh, key:k, rot:0, x:Math.floor(cols/2)-Math.floor(sh[0].length/2), y:0 };
}

// Derive bounds from the actual grid so callers don't need to pass dimensions.
export function collide(sh, x, y, g) {
  const gRows = g.length, gCols = g[0]?.length ?? COLS;
  for (let r=0; r<sh.length; r++) for (let c=0; c<sh[r].length; c++) {
    if (!sh[r][c]) continue;
    const nx=x+c, ny=y+r;
    if (nx<0||nx>=gCols||ny>=gRows) return true;
    if (ny>=0 && g[ny][nx]) return true;
  }
  return false;
}
