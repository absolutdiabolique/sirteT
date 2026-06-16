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

  // Fill piece cells seamlessly (no 1px gap between adjacent cells).
  function drawPieceSolid(shape, ox, oy, color, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        if (shape[r][c]) ctx.fillRect((ox + c) * sz, (oy + r) * sz, sz, sz);
    ctx.globalAlpha = 1;
  }

  function drawOutline(shape, ox, oy, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        if (shape[r][c]) ctx.rect((ox + c) * sz, (oy + r) * sz, sz, sz);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const px = (ox + c) * sz, py = (oy + r) * sz;
        if (!shape[r - 1]?.[c]) { ctx.moveTo(px, py);      ctx.lineTo(px + sz, py);      }
        if (!shape[r + 1]?.[c]) { ctx.moveTo(px, py + sz); ctx.lineTo(px + sz, py + sz); }
        if (!shape[r]?.[c - 1]) { ctx.moveTo(px, py);      ctx.lineTo(px, py + sz);      }
        if (!shape[r]?.[c + 1]) { ctx.moveTo(px + sz, py); ctx.lineTo(px + sz, py + sz); }
      }
    }
    ctx.stroke();
    // Fill 2×2 gaps at 270° concave corners (where butt-capped stroke ends don't meet)
    ctx.fillStyle = color;
    const W = shape[0]?.length ?? 0;
    for (let r = 0; r <= shape.length; r++) {
      for (let c = 0; c <= W; c++) {
        const TL = shape[r-1]?.[c-1], TR = shape[r-1]?.[c];
        const BL = shape[r]?.[c-1],   BR = shape[r]?.[c];
        const px = (ox + c) * sz, py = (oy + r) * sz;
        if      ( TL &&  TR &&  BL && !BR) ctx.fillRect(px - 2, py - 2, 2, 2);
        else if ( TL &&  TR && !BL &&  BR) ctx.fillRect(px,     py - 2, 2, 2);
        else if ( TL && !TR &&  BL &&  BR) ctx.fillRect(px - 2, py,     2, 2);
        else if (!TL &&  TR &&  BL &&  BR) ctx.fillRect(px,     py,     2, 2);
      }
    }
    ctx.restore();
  }

  // Inner outlines for locked grid cells. Per-color clipping prevents strokes from
  // one piece bleeding into adjacent cells of a different piece.
  function drawGridOutlines(grid) {
    const numRows = grid.length;
    const numCols = grid[0]?.length ?? 0;
    const byColor = new Map();
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const col = grid[r][c];
        if (!col || col === '__inv__') continue;
        if (!byColor.has(col)) byColor.set(col, { lc: lighten(col), cells: [], segs: [] });
        const e = byColor.get(col);
        const px = c * sz, py = r * sz;
        e.cells.push(px, py);
        if (grid[r-1]?.[c] !== col) e.segs.push(px,      py,      px + sz, py);
        if (grid[r+1]?.[c] !== col) e.segs.push(px,      py + sz, px + sz, py + sz);
        if (grid[r]?.[c-1] !== col) e.segs.push(px,      py,      px,      py + sz);
        if (grid[r]?.[c+1] !== col) e.segs.push(px + sz, py,      px + sz, py + sz);
      }
    }
    ctx.lineWidth = 4;
    for (const [col, { lc, cells, segs }] of byColor) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < cells.length; i += 2) ctx.rect(cells[i], cells[i+1], sz, sz);
      ctx.clip();
      ctx.strokeStyle = lc;
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) { ctx.moveTo(segs[i], segs[i+1]); ctx.lineTo(segs[i+2], segs[i+3]); }
      ctx.stroke();
      ctx.fillStyle = lc;
      for (let r = 0; r <= numRows; r++) {
        for (let c = 0; c <= numCols; c++) {
          const TL = grid[r-1]?.[c-1], TR = grid[r-1]?.[c];
          const BL = grid[r]?.[c-1],   BR = grid[r]?.[c];
          if (TL !== col && TR !== col && BL !== col && BR !== col) continue;
          const px = c * sz, py = r * sz;
          if      (TL===col && TR===col && BL===col && BR!==col) ctx.fillRect(px-2, py-2, 2, 2);
          else if (TL===col && TR===col && BL!==col && BR===col) ctx.fillRect(px,   py-2, 2, 2);
          else if (TL===col && TR!==col && BL===col && BR===col) ctx.fillRect(px-2, py,   2, 2);
          else if (TL!==col && TR===col && BL===col && BR===col) ctx.fillRect(px,   py,   2, 2);
        }
      }
      ctx.restore();
    }
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
      circleGrid   = null,
      circlePiece  = null,
      motionTrail   = null,
      dropLines     = null,
      disintegrate  = null,
    } = {}) {
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

      if (gridOn) {
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = gridWidth;
        const gW = canvasEl.width, gH = canvasEl.height;
        const nCols = Math.round(gW / sz), nRows = Math.round(gH / sz);
        for (let r = 0; r <= nRows; r++) {
          ctx.beginPath(); ctx.moveTo(0, r * sz); ctx.lineTo(gW, r * sz); ctx.stroke();
        }
        for (let c = 0; c <= nCols; c++) {
          ctx.beginPath(); ctx.moveTo(c * sz, 0); ctx.lineTo(c * sz, gH); ctx.stroke();
        }
      }

      if (grid) {
        const fn = () => {
          for (let r = 0; r < grid.length; r++)
            for (let c = 0; c < grid[r].length; c++) {
              const col = grid[r][c];
              if (!col || col === '__inv__') continue;
              if (cfg.pieceOutline) {
                ctx.fillStyle = col;
                ctx.fillRect(c * sz, r * sz, sz, sz);
              } else {
                drawCell(col, c, r);
              }
            }
          if (cfg.pieceOutline) drawGridOutlines(grid);
        };
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
          if (motionTrail && motionTrail.length > 0) {
            for (const e of [...motionTrail].reverse()) {
              ctx.save();
              ctx.filter = `blur(${e.blur.toFixed(1)}px)`;
              drawPieceSolid(e.shape, e.x, e.y, pieceColors[e.key], e.alpha);
              ctx.restore();
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

      if (dropLines && dropLines.length > 0) {
        ctx.save();
        ctx.lineCap = 'round';
        for (const dl of dropLines) {
          if (dl.alpha <= 0) continue;
          const lc = lighten(dl.color);
          // Three lines per side, spreading outward, each dimmer
          const offsets = [0, 3, 6];
          const alphas  = [1, 0.5, 0.22];
          const widths  = [2, 1.5, 1];
          for (let i = 0; i < 3; i++) {
            const ox = dl.side * offsets[i];
            ctx.globalAlpha = dl.alpha * alphas[i];
            ctx.strokeStyle = i === 0 ? lc : dl.color;
            ctx.lineWidth   = widths[i];
            ctx.beginPath();
            ctx.moveTo(dl.x + ox, dl.y1);
            ctx.lineTo(dl.x + ox, dl.y2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      if (disintegrate && disintegrate.length > 0) {
        ctx.save();
        for (const p of disintegrate) {
          if (p.alpha <= 0) continue;
          // Blend from original color toward white as brightFactor rises 0→1
          ctx.globalAlpha = p.alpha * (1 - p.brightFactor);
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x + 1, p.y + 1, sz - 2, sz - 2);
          ctx.globalAlpha = p.alpha * p.brightFactor;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(p.x + 1, p.y + 1, sz - 2, sz - 2);
        }
        ctx.restore();
      }
    }
  };
}
