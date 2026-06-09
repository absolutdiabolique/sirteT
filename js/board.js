import { COLS, ROWS } from './constants.js';
import { pieceColors, cfg } from './state.js';
import { darken, lighten } from './ui.js';

// Draw fn four times at (nx,ny), (nx-w,ny), (nx,ny-h), (nx-w,ny-h) so content wraps toroidally.
// Canvas clips naturally, so only visible portions appear.
function drawWrapped(ctx, ox, oy, w, h, fn) {
  const nx = ((ox % w) + w) % w;
  const ny = ((oy % h) + h) % h;
  ctx.save(); ctx.translate(nx,     ny    ); fn(); ctx.restore();
  ctx.save(); ctx.translate(nx - w, ny    ); fn(); ctx.restore();
  ctx.save(); ctx.translate(nx,     ny - h); fn(); ctx.restore();
  ctx.save(); ctx.translate(nx - w, ny - h); fn(); ctx.restore();
}

export function createBoard(canvasEl, sz) {
  const ctx = canvasEl.getContext('2d');

  function drawCell(color, x, y, alpha = 1) {
    if (!color || color === '__inv__') return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x * sz + 1, y * sz + 1, sz - 2, sz - 2);
    ctx.globalAlpha = 1;
  }

  // Fill piece cells with no inter-cell gap (full sz×sz per cell).
  function drawPieceSolid(shape, ox, oy, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        if (shape[r][c]) ctx.fillRect((ox + c) * sz, (oy + r) * sz, sz, sz);
    ctx.globalAlpha = 1;
  }

  // Trace exterior edges of a piece shape, inset 2px from the boundary so the
  // outline sits inside the filled area rather than on top of the gap between cells.
  const INSET = 2;
  function drawOutline(shape, ox, oy, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const px = (ox + c) * sz, py = (oy + r) * sz;
        const x0 = px + INSET, x1 = px + sz - INSET;
        const y0 = py + INSET, y1 = py + sz - INSET;
        if (!shape[r - 1]?.[c]) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); } // top
        if (!shape[r + 1]?.[c]) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); } // bottom
        if (!shape[r]?.[c - 1]) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); } // left
        if (!shape[r]?.[c + 1]) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); } // right
      }
    }
    ctx.stroke();
    ctx.restore();
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
      circleGrid   = null,   // {x,y} px offset for locked cells — wrapped at canvas edges
      circlePiece  = null,   // {x,y} px offset for active piece + ghost — wrapped at canvas edges
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

      if (grid) {
        const fn = () => { for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) drawCell(grid[r][c], c, r); };
        if (circleGrid) drawWrapped(ctx, circleGrid.x, circleGrid.y, canvasEl.width, canvasEl.height, fn);
        else fn();
      }

      if (targetPiece) {
        const { shape, x, y, key, alpha = 0.55 } = targetPiece;
        const outColor = cfg.pieceOutline ? lighten(pieceColors[key]) : null;
        const fn = () => {
          if (outColor) {
            drawPieceSolid(shape, x, y, pieceColors[key], alpha);
            drawOutline(shape, x, y, outColor, alpha);
          } else {
            for (let r = 0; r < shape.length; r++)
              for (let c = 0; c < shape[r].length; c++)
                if (shape[r][c]) drawCell(pieceColors[key], x + c, y + r, alpha);
          }
        };
        if (circleGrid) drawWrapped(ctx, circleGrid.x, circleGrid.y, canvasEl.width, canvasEl.height, fn);
        else fn();
      }

      if (piece) {
        const outColor = cfg.pieceOutline ? lighten(pieceColors[piece.key]) : null;
        const fn = () => {
          if (ghostOpacity > 0 && ghostY !== null) {
            if (outColor) {
              drawPieceSolid(piece.shape, piece.x, ghostY, pieceColors[piece.key], ghostOpacity);
              drawOutline(piece.shape, piece.x, ghostY, outColor, ghostOpacity);
            } else {
              for (let r = 0; r < piece.shape.length; r++)
                for (let c = 0; c < piece.shape[r].length; c++)
                  if (piece.shape[r][c]) drawCell(pieceColors[piece.key], piece.x + c, ghostY + r, ghostOpacity);
            }
          }
          const col = lockFlashing && !lockBright ? darken(pieceColors[piece.key]) : pieceColors[piece.key];
          if (outColor) {
            drawPieceSolid(piece.shape, piece.x, piece.y, col);
            drawOutline(piece.shape, piece.x, piece.y, outColor);
          } else {
            for (let r = 0; r < piece.shape.length; r++)
              for (let c = 0; c < piece.shape[r].length; c++)
                if (piece.shape[r][c]) drawCell(col, piece.x + c, piece.y + r);
          }
        };
        if (circlePiece) drawWrapped(ctx, circlePiece.x, circlePiece.y, canvasEl.width, canvasEl.height, fn);
        else fn();
      }
    }
  };
}
