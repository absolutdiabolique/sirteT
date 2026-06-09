import { cfg } from './state.js';

// Color shift: applied via a CSS custom property on <body> so dynamically
// created preview canvases inherit the filter automatically.
// CSS rule required in index.html:
//   body.stupid-shift canvas { filter: hue-rotate(var(--hue-shift, 0deg)); }

// ── Hue shift ─────────────────────────────────────────────────────────────────
let hue      = 0;
let lastTs   = 0;
let lastTickColorShift = 0;
let lastTickLimbo      = 0;
let rafId    = null;

// ── Limbo: per-N order maps ───────────────────────────────────────────────────
// Keyed by preview count (n) so different game modes with different queue sizes
// each get an independent shuffle order.
const _limboOrders = new Map();  // n -> current shuffled order array
const _prevOrders  = new Map();  // n -> order before last shuffle (for FLIP)
const _pendingFlip = new Set();  // n values that need a FLIP on next limboQueue call

// ── Limbo: container registry for smooth position animation ───────────────────
// Each game mode calls setupLimbo(containerEl, n) from buildPreviews so we know
// which canvas elements to animate and where their natural slot positions are.
const _containers = new Map();   // containerEl -> { canvases, slotTops, n }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function invertPerm(perm) {
  const inv = new Array(perm.length);
  perm.forEach((v, i) => { inv[v] = i; });
  return inv;
}

// FLIP animation: canvases already have new content drawn by drawPreviews.
// We instantly move them to WHERE THAT CONTENT CAME FROM, then CSS-transition
// back to their natural position — creating the illusion of sliding.
function doFlip(n) {
  const newOrder  = _limboOrders.get(n);
  const prevOrder = _prevOrders.get(n);
  if (!newOrder || !prevOrder) return;

  const prevInv = invertPerm(prevOrder);

  for (const [containerEl, info] of _containers) {
    if (info.n !== n) continue;
    const { canvases, slotTops } = info;

    // Step 1: teleport each canvas to where its content came from (no transition)
    canvases.forEach((cv, j) => {
      const fromSlot = prevInv[newOrder[j]];
      cv.style.transition = 'none';
      cv.style.transform = `translateY(${slotTops[fromSlot] - slotTops[j]}px)`;
    });

    // Step 2: force reflow so the browser commits the no-transition jump
    containerEl.offsetHeight; // eslint-disable-line no-unused-expressions

    // Step 3: transition back to the natural (zero-offset) position
    canvases.forEach(cv => {
      cv.style.transition = 'transform 0.2s ease';
      cv.style.transform = 'translateY(0)';
    });
  }
}

// ── RAF loop ──────────────────────────────────────────────────────────────────
function loop(ts) {
  if (!cfg.colorShift && !cfg.limbo && !cfg.drunk) {
    rafId = null;
    document.body.classList.remove('stupid-shift');
    document.body.classList.remove('stupid-effect');
    return;
  }

  rafId = requestAnimationFrame(loop);

  const dt     = Math.min(ts - lastTs, 100);
  lastTs = ts;

  const colorShiftTickMs = 60000 / Math.max(30, Math.min(500, cfg.colorShiftBpm || 120));
  const limboTickMs      = 60000 / Math.max(30, Math.min(500, cfg.limboBpm      || 120));
  const drunkTickMs      = 60000 / Math.max(30, Math.min(500, cfg.drunkBpm      || 120));

  if (ts - lastTickColorShift >= colorShiftTickMs) {
    lastTickColorShift = ts;
    if (cfg.colorShift) hue = (hue + 30) % 360;   // beat jump: +30°
  }

  if (ts - lastTickLimbo >= limboTickMs) {
    lastTickLimbo = ts;
    if (cfg.limbo) {
      for (const [n, order] of _limboOrders) {
        _prevOrders.set(n, [...order]);
        _limboOrders.set(n, shuffle([...order]));
        _pendingFlip.add(n);
      }
    }
  }

  if (cfg.colorShift) {
    hue = (hue + dt * 0.015) % 360;               // smooth drift: ~15°/s
    document.body.style.setProperty('--hue-shift', `${hue.toFixed(1)}deg`);
    document.body.classList.add('stupid-shift');
  } else {
    document.body.classList.remove('stupid-shift');
  }

  if (cfg.drunk) {
    const phase = ts / drunkTickMs * Math.PI * 2;
    document.body.style.setProperty('--stupid-tx', `${(20 * Math.sin(phase)).toFixed(2)}px`);
    document.body.classList.add('stupid-effect');
  } else {
    document.body.classList.remove('stupid-effect');
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

// Start the shared RAF loop if not already running.
export function ensureRunning() {
  if (rafId) return;
  lastTs = lastTickColorShift = lastTickLimbo = performance.now();
  rafId  = requestAnimationFrame(loop);
}

// Register a preview-stack container for limbo position animation.
// Call this from each game mode's buildPreviews(), after canvases are in the DOM.
export function setupLimbo(containerEl, n) {
  if (!containerEl || n <= 1) return;
  const canvases = [...containerEl.querySelectorAll('canvas')].slice(0, n);
  if (canvases.length < n) return;
  const slotTops = canvases.map(cv => cv.offsetTop);
  _containers.set(containerEl, { canvases, slotTops, n });
  canvases.forEach(cv => { cv.style.transition = 'transform 0.2s ease'; });
}

// Each BPM tick, piece drifts one block down-left and grid one block down-right.
// The hop is animated over 200ms then holds. Callers wrap at board edges (drawWrapped in board.js/bot.js).
const CIRCLE_SZ   = 30;  // one block — matches SZ (solo/qp/mr); VS boards use 22 but close enough
const CIRCLE_ANIM = 100; // ms per hop animation
export function getCircleOffsets(ts) {
  if (!cfg.circles) return { circleGrid: null, circlePiece: null };
  const tickMs     = 60000 / Math.max(30, Math.min(500, cfg.circlesBpm || 120));
  const totalTicks = Math.floor(ts / tickMs);
  const animT      = Math.min(1, (ts % tickMs) / CIRCLE_ANIM);  // 0→1 over first 200ms, then 1
  const t          = totalTicks + animT;  // 0 at game start, increases by 1 each tick

  return {
    circlePiece: { x: -t * CIRCLE_SZ, y: t * CIRCLE_SZ },  // drifts down-left
    circleGrid:  { x:  t * CIRCLE_SZ, y: t * CIRCLE_SZ },  // drifts down-right
  };
}

// Returns a (possibly limbo-shuffled) view of the queue for preview drawing.
// On the first call after a BPM tick, triggers the FLIP position animation.
export function limboQueue(queue, n) {
  if (!cfg.limbo || n <= 1) return queue;

  if (!_limboOrders.has(n)) {
    const id = Array.from({ length: n }, (_, i) => i);
    _limboOrders.set(n, id);
    _prevOrders.set(n, [...id]);
  }

  if (_pendingFlip.has(n)) {
    _pendingFlip.delete(n);
    doFlip(n);
  }

  return _limboOrders.get(n).map(i => queue[i] ?? null);
}
