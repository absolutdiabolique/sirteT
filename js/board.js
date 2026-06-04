import { COLS, ROWS } from './constants.js';
import { pieceColors } from './state.js';
import { darken } from './ui.js';

// createBoard(canvasEl, sz) → { draw(state) }
// Pure display: renders whatever state it's given. No game logic.
//
// draw() state fields:
//   grid         — 2D array of color strings (null = empty)
//   piece        — active piece object, or null
//   ghostY       — pre-computed ghost row (caller's responsibility), or null
//   lockFlashing — bool: piece is in lock-flash animation
//   lockBright   — bool: current flash phase (true = bright, false = dark)
//   ghostOpacity — 0–1
//   gridOn       — whether to draw grid lines
//   gridColor    — css color string for grid lines
//   gridWidth    — line width in px for grid lines
//   targetPiece  — optional { shape, x, y, key, alpha } for a "planned placement" ghost
//                  (used by the bot opponent board to show where the bot intends to place)
export function createBoard(canvasEl, sz) {
  const ctx = canvasEl.getContext('2d');

  function drawCell(color, x, y, alpha = 1) {
    if (!color || color === '__inv__') return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x * sz + 1, y * sz + 1, sz - 2, sz - 2);
    ctx.globalAlpha = 1;
  }

  return {
    draw({
      grid        = null,
      piece       = null,
      ghostY      = null,
      lockFlashing = false,
      lockBright   = true,
      ghostOpacity = 0,
      gridOn       = false,
      gridColor    = 'rgba(255,255,255,0.04)',
      gridWidth    = 0.5,
      targetPiece  = null,
    } = {}) {
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

      if (gridOn) {
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = gridWidth;
        for (let r = 0; r <= ROWS; r++) {
          ctx.beginPath(); ctx.moveTo(0, r * sz); ctx.lineTo(COLS * sz, r * sz); ctx.stroke();
        }
        for (let c = 0; c <= COLS; c++) {
          ctx.beginPath(); ctx.moveTo(c * sz, 0); ctx.lineTo(c * sz, ROWS * sz); ctx.stroke();
        }
      }

      if (grid)
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            drawCell(grid[r][c], c, r);

      if (targetPiece) {
        const { shape, x, y, key, alpha = 0.55 } = targetPiece;
        for (let r = 0; r < shape.length; r++)
          for (let c = 0; c < shape[r].length; c++)
            if (shape[r][c]) drawCell(pieceColors[key], x + c, y + r, alpha);
      }

      if (piece) {
        if (ghostOpacity > 0 && ghostY !== null)
          for (let r = 0; r < piece.shape.length; r++)
            for (let c = 0; c < piece.shape[r].length; c++)
              if (piece.shape[r][c]) drawCell(pieceColors[piece.key], piece.x + c, ghostY + r, ghostOpacity);

        const col = lockFlashing && !lockBright ? darken(pieceColors[piece.key]) : pieceColors[piece.key];
        for (let r = 0; r < piece.shape.length; r++)
          for (let c = 0; c < piece.shape[r].length; c++)
            if (piece.shape[r][c]) drawCell(col, piece.x + c, piece.y + r);
      }
    }
  };
}
