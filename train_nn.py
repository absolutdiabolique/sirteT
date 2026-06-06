"""
Neural network trainer for Tetris board evaluation (distillation).

Generates training data by running the heuristic AI and recording
(board_features, heuristic_score) pairs, then trains a deep MLP.
Each board position is also horizontally mirrored (free augmentation).

Output: nn_weights.json — loadable by ai2.js.

Architecture: 228 → 512 → 256 → 128 → 64 → 1
              (ReLU hidden layers, Dropout 0.20 on first three)

Targets ~90 minutes on a modern CPU; faster on GPU.

Usage:
  python train_nn.py                    # default: 1M samples, 150 epochs
  python train_nn.py --samples 2000000 --epochs 200
  python train_nn.py --no-torch         # pure-numpy fallback (no dropout)
"""

import json, math, random, time, argparse, os

# ── Tetris constants ─────────────────────────────────────────────────────────

COLS  = 10
ROWS  = 20
PKEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

ROTATIONS = {
    'I': [[[1,1,1,1]], [[1],[1],[1],[1]], [[1,1,1,1]], [[1],[1],[1],[1]]],
    'J': [[[1,0,0],[1,1,1],[0,0,0]], [[0,1,1],[0,1,0],[0,1,0]],
          [[0,0,0],[1,1,1],[0,0,1]], [[0,1,0],[0,1,0],[1,1,0]]],
    'L': [[[0,0,1],[1,1,1],[0,0,0]], [[0,1,0],[0,1,0],[0,1,1]],
          [[0,0,0],[1,1,1],[1,0,0]], [[1,1,0],[0,1,0],[0,1,0]]],
    'O': [[[1,1],[1,1]], [[1,1],[1,1]], [[1,1],[1,1]], [[1,1],[1,1]]],
    'S': [[[0,1,1],[1,1,0],[0,0,0]], [[0,1,0],[0,1,1],[0,0,1]],
          [[0,0,0],[0,1,1],[1,1,0]], [[1,0,0],[1,1,0],[0,1,0]]],
    'T': [[[0,1,0],[1,1,1],[0,0,0]], [[0,1,0],[0,1,1],[0,1,0]],
          [[0,0,0],[1,1,1],[0,1,0]], [[0,1,0],[1,1,0],[0,1,0]]],
    'Z': [[[1,1,0],[0,1,1],[0,0,0]], [[0,0,1],[0,1,1],[0,1,0]],
          [[0,0,0],[1,1,0],[0,1,1]], [[0,1,0],[1,1,0],[1,0,0]]],
}

ATTACK_TABLE = {
    (1,False):0, (2,False):1, (3,False):2, (4,False):4,
    (1,True):2,  (2,True):4,  (3,True):6,
}

# ── Board helpers ────────────────────────────────────────────────────────────

def collide(shape, x, y, grid):
    for r, row in enumerate(shape):
        for c, cell in enumerate(row):
            if not cell: continue
            nx, ny = x+c, y+r
            if nx < 0 or nx >= COLS or ny >= ROWS: return True
            if ny >= 0 and grid[ny][nx]: return True
    return False

def drop_y(shape, x, grid):
    y = 0
    while not collide(shape, x, y+1, grid): y += 1
    return y

def place_piece(grid, shape, x, y):
    g = [row[:] for row in grid]
    for r, row in enumerate(shape):
        for c, cell in enumerate(row):
            if cell and 0 <= y+r < ROWS and 0 <= x+c < COLS:
                g[y+r][x+c] = 1
    return g

def clear_lines(grid):
    kept = [row for row in grid if not all(row)]
    cleared = ROWS - len(kept)
    while len(kept) < ROWS: kept.insert(0, [0]*COLS)
    return kept, cleared

def col_heights(grid):
    h = [0]*COLS
    for c in range(COLS):
        for r in range(ROWS):
            if grid[r][c]: h[c] = ROWS-r; break
    return h

def count_holes(grid):
    holes = covered = 0
    for c in range(COLS):
        above = 0
        for r in range(ROWS):
            if grid[r][c]: above += 1
            elif above > 0: holes += 1; covered += max(0, above-1)
    return holes, covered

def detect_well(heights):
    best = 0
    for c in range(COLS):
        left  = heights[c-1] if c > 0 else 20
        right = heights[c+1] if c < COLS-1 else 20
        depth = min(left, right) - heights[c]
        if depth > best: best = depth
    return min(best, 8)

def detect_tspin_slots(heights):
    slots = 0
    for c in range(1, COLS-1):
        if heights[c]+2 <= heights[c-1] and heights[c]+2 <= heights[c+1]:
            slots += 1
    return slots

def survival_penalty(heights):
    mh = max(heights)
    return (mh - (ROWS-5))**2 if mh >= ROWS-5 else 0

def gen_placements(grid, key):
    seen, out = set(), []
    for rot in range(4):
        shape = ROTATIONS[key][rot]
        w = len(shape[0])
        for x in range(-1, COLS-w+2):
            if collide(shape, x, 0, grid): continue
            y = drop_y(shape, x, grid)
            sig = (rot, x, y)
            if sig in seen: continue
            seen.add(sig)
            out.append((rot, x, y, shape))
    return out

# ── Heuristic evaluator (teacher signal) ────────────────────────────────────

DEFAULT_W = {
    'HEIGHT_WEIGHT':       -0.51,
    'HOLE_WEIGHT':         -0.75,
    'COVERED_HOLE_WEIGHT': -0.50,
    'BUMPINESS_WEIGHT':    -0.18,
    'CLEAR_WEIGHT':         1.00,
    'ATTACK_WEIGHT':        0.80,
    'B2B_WEIGHT':           0.30,
    'COMBO_WEIGHT':         0.20,
    'TSPIN_WEIGHT':         0.40,
    'SURVIVAL_WEIGHT':     -1.50,
    'WELL_WEIGHT':          0.25,
    'QUAD_BONUS':           1.00,
}

def heuristic_score(grid, cleared, spin, combo, b2b):
    h    = col_heights(grid)
    agg  = sum(h)
    holes, covered = count_holes(grid)
    bump = sum(abs(h[c]-h[c+1]) for c in range(COLS-1))
    ts   = detect_tspin_slots(h)
    well = detect_well(h)
    surv = survival_penalty(h)

    base_atk = ATTACK_TABLE.get((min(cleared,4), spin), 0)
    is_b2b   = cleared >= 4 or (spin and cleared > 0)
    if is_b2b and b2b > 0: base_atk += min(b2b,6)*0.5
    attack = math.floor(base_atk * (1 + 0.2*combo))

    cr = [0,0.5,1.0,2.0,4.0][min(cleared,4)]
    if cleared == 4: cr += DEFAULT_W['QUAD_BONUS']

    W = DEFAULT_W
    return (W['HEIGHT_WEIGHT']*agg + W['HOLE_WEIGHT']*holes
            + W['COVERED_HOLE_WEIGHT']*covered + W['BUMPINESS_WEIGHT']*bump
            + W['CLEAR_WEIGHT']*cr + W['ATTACK_WEIGHT']*attack
            + W['B2B_WEIGHT']*(1 if is_b2b else 0) + W['COMBO_WEIGHT']*combo
            + W['TSPIN_WEIGHT']*ts + W['SURVIVAL_WEIGHT']*surv
            + W['WELL_WEIGHT']*well)

# ── Feature extraction ───────────────────────────────────────────────────────
# 200 raw cells + 10 norm col heights + 10 norm per-col holes + 8 scalars = 228

def extract_features(grid):
    cells = [float(grid[r][c]) for r in range(ROWS) for c in range(COLS)]  # 200

    h = col_heights(grid)
    norm_h = [hi / ROWS for hi in h]                                        # 10

    hole_col = [0.0]*COLS
    for c in range(COLS):
        above = 0
        for r in range(ROWS):
            if grid[r][c]: above += 1
            elif above > 0: hole_col[c] += 1
    norm_hole_col = [v/ROWS for v in hole_col]                               # 10

    agg   = sum(h) / (ROWS * COLS)
    bump  = sum(abs(h[c]-h[c+1]) for c in range(COLS-1)) / (ROWS * COLS)
    max_h = max(h) / ROWS
    holes, covered = count_holes(grid)
    holes_n   = holes / (ROWS * COLS)
    covered_n = covered / (ROWS * COLS)
    well  = detect_well(h) / 8.0
    ts    = detect_tspin_slots(h) / COLS
    surv  = survival_penalty(h) / (ROWS**2)                                  # 8

    return cells + norm_h + norm_hole_col + [agg, bump, max_h, holes_n, covered_n, well, ts, surv]

INPUT_DIM = 228

def mirror_features(feats):
    """Horizontal flip. Score is identical — Tetris is left-right symmetric."""
    f = list(feats)
    for r in range(ROWS):
        s = r * COLS
        f[s:s+COLS] = f[s:s+COLS][::-1]
    f[200:210] = f[200:210][::-1]
    f[210:220] = f[210:220][::-1]
    return f

# ── Data generation ──────────────────────────────────────────────────────────

def fill_bag():
    bag = PKEYS[:]
    random.shuffle(bag)
    return bag

def make_queue(n=28):
    q = []
    while len(q) < n: q.extend(fill_bag())
    return q

def best_heuristic_move(grid, key, combo, b2b):
    best_sc, best_res = -math.inf, None
    for rot, x, y, shape in gen_placements(grid, key):
        g2 = place_piece(grid, shape, x, y)
        g3, cleared = clear_lines(g2)
        sc = heuristic_score(g3, cleared, False, combo, b2b)
        if sc > best_sc:
            best_sc = sc
            best_res = (rot, x, y, g3, cleared)
    return best_res

def generate_samples(n_samples=1_000_000, max_pieces_per_game=600):
    """Collect (features, score) for every placement; mirror each for free augmentation."""
    samples = []
    games   = 0

    while len(samples) < n_samples:
        grid  = [[0]*COLS for _ in range(ROWS)]
        queue = make_queue()
        combo = 0
        b2b   = 0

        for _ in range(max_pieces_per_game):
            if len(queue) < 7: queue.extend(fill_bag())
            key = queue.pop(0)

            placements = gen_placements(grid, key)
            if not placements: break

            for _, x, y, shape in placements:
                g2 = place_piece(grid, shape, x, y)
                g3, cleared = clear_lines(g2)
                sc    = heuristic_score(g3, cleared, False, combo, b2b)
                feats = extract_features(g3)
                samples.append((feats, sc))
                samples.append((mirror_features(feats), sc))

            result = best_heuristic_move(grid, key, combo, b2b)
            if result is None: break
            _, _, _, grid, cleared = result

            if cleared > 0:
                combo += 1
                b2b = b2b+1 if cleared >= 4 else 0
            else:
                combo = 0
                if random.random() < 0.12:
                    lines = random.randint(1, 7)
                    hole  = random.randint(0, COLS-1)
                    grid  = grid[lines:]
                    for _ in range(lines):
                        row = [1]*COLS; row[hole] = 0
                        grid.append(row)

            if len(samples) >= n_samples * 2:
                break

        games += 1
        if games % 20 == 0:
            pct = min(100, 100 * len(samples) / n_samples)
            print(f"  {len(samples):>9,} / {n_samples:,} samples  {pct:.1f}%  ({games} games)",
                  end='\r', flush=True)

    print(f"  {len(samples):>9,} samples from {games} games.               ")
    random.shuffle(samples)
    return samples[:n_samples]

# ── Helpers ───────────────────────────────────────────────────────────────────

def relu(x):
    return x * (x > 0)

def relu_grad(x):
    return (x > 0).astype(x.dtype)

# ── PyTorch training ──────────────────────────────────────────────────────────

def train_torch(samples, epochs=150, batch=2048, lr=5e-4,
                h1=512, h2=256, h3=128, h4=64, dropout=0.20):
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import TensorDataset, DataLoader

    arch_str = f"{INPUT_DIM}→{h1}→{h2}→{h3}→{h4}→1"
    print(f"Training with PyTorch  ({len(samples):,} samples, {epochs} epochs, "
          f"batch={batch}, arch={arch_str})")

    X_raw = [s[0] for s in samples]
    Y_raw = [s[1] for s in samples]

    Y_arr  = torch.tensor(Y_raw, dtype=torch.float32)
    y_mean = Y_arr.mean().item()
    y_std  = Y_arr.std().item() + 1e-6
    Y_norm = (Y_arr - y_mean) / y_std

    X       = torch.tensor(X_raw, dtype=torch.float32)
    dataset = TensorDataset(X, Y_norm)
    loader  = DataLoader(dataset, batch_size=batch, shuffle=True,
                         num_workers=0, pin_memory=False)

    model = nn.Sequential(
        nn.Linear(INPUT_DIM, h1), nn.ReLU(), nn.Dropout(dropout),
        nn.Linear(h1, h2),        nn.ReLU(), nn.Dropout(dropout),
        nn.Linear(h2, h3),        nn.ReLU(), nn.Dropout(dropout),
        nn.Linear(h3, h4),        nn.ReLU(),
        nn.Linear(h4, 1),
    )

    # He initialisation (PyTorch default is Kaiming uniform — keep it)
    opt = optim.Adam(model.parameters(), lr=lr, weight_decay=3e-5)

    # OneCycleLR: linear warmup then cosine decay — best for long runs
    sched   = optim.lr_scheduler.OneCycleLR(
        opt, max_lr=lr,
        epochs=epochs, steps_per_epoch=len(loader),
        pct_start=0.05,            # 5% of steps for warmup
        anneal_strategy='cos',
        div_factor=25.0,           # initial lr = max_lr / 25
        final_div_factor=1e4,
    )
    loss_fn = nn.MSELoss()

    t_start = time.time()
    for epoch in range(epochs):
        model.train()
        total_loss = 0.0
        for xb, yb in loader:
            pred = model(xb).squeeze(1)
            loss = loss_fn(pred, yb)
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            total_loss += loss.item() * len(xb)
        avg     = total_loss / len(samples)
        elapsed = time.time() - t_start
        eta     = elapsed / (epoch+1) * (epochs - epoch - 1)
        print(f"  Epoch {epoch+1:3d}/{epochs}  loss={avg:.6f}  "
              f"lr={sched.get_last_lr()[0]:.2e}  "
              f"elapsed={elapsed/60:.1f}m  eta={eta/60:.1f}m")

    lin_layers = [l for l in model.children() if isinstance(l, nn.Linear)]
    params = []
    for lin in lin_layers:
        W = lin.weight.detach().numpy().T.tolist()
        b = lin.bias.detach().numpy().tolist()
        params.append({'W': W, 'b': b})

    return params, {'mean': y_mean, 'std': y_std}

# ── NumPy training (fallback — no dropout) ────────────────────────────────────

def train_numpy(samples, epochs=150, batch=2048, lr=5e-4,
                h1=512, h2=256, h3=128, h4=64, dropout=0.20):
    import numpy as np
    arch_str = f"{INPUT_DIM}→{h1}→{h2}→{h3}→{h4}→1"
    print(f"Training with NumPy  ({len(samples):,} samples, {epochs} epochs, "
          f"batch={batch}, arch={arch_str})")
    if dropout > 0:
        print("  (Dropout not supported in NumPy path — proceeding without it)")

    X = np.array([s[0] for s in samples], dtype=np.float32)
    Y = np.array([s[1] for s in samples], dtype=np.float32)
    y_mean = float(Y.mean()); y_std = float(Y.std()) + 1e-6
    Y = (Y - y_mean) / y_std

    rng   = np.random.default_rng(42)
    scale = lambda fan_in: math.sqrt(2.0 / fan_in)
    dims  = [INPUT_DIM, h1, h2, h3, h4, 1]
    W = [rng.normal(0, scale(dims[i]), (dims[i], dims[i+1])).astype(np.float32)
         for i in range(len(dims)-1)]
    b = [np.zeros(dims[i+1], dtype=np.float32) for i in range(len(dims)-1)]

    # Adam
    m_W = [np.zeros_like(w) for w in W]
    v_W = [np.zeros_like(w) for w in W]
    m_b = [np.zeros_like(bi) for bi in b]
    v_b = [np.zeros_like(bi) for bi in b]
    t   = 0
    eps = 1e-8
    wd  = 3e-5

    # Cosine LR schedule
    def lr_at(epoch):
        return lr * 0.5 * (1 + math.cos(math.pi * epoch / epochs))

    n       = len(X)
    t_start = time.time()
    for epoch in range(epochs):
        cur_lr = lr_at(epoch)
        idx    = rng.permutation(n)
        total_loss = 0.0
        for start in range(0, n, batch):
            xb = X[idx[start:start+batch]]
            yb = Y[idx[start:start+batch]]
            bs = len(xb)

            acts, zs = [xb], []
            for i in range(len(W)):
                z = acts[-1] @ W[i] + b[i]
                zs.append(z)
                acts.append(relu(z) if i < len(W)-1 else z)

            pred = acts[-1].squeeze(1)
            diff = pred - yb
            total_loss += float((diff**2).mean()) * bs

            delta = (2.0 / bs) * diff.reshape(-1, 1)
            t += 1
            for i in range(len(W)-1, -1, -1):
                dW = acts[i].T @ delta + wd * W[i]
                db = delta.sum(axis=0)

                for lst, grd, mv, vv in [(W, dW, m_W, v_W), (b, db, m_b, v_b)]:
                    mv[i] = 0.9*mv[i] + 0.1*grd
                    vv[i] = 0.999*vv[i] + 0.001*(grd**2)
                    m_hat = mv[i] / (1 - 0.9**t)
                    v_hat = vv[i] / (1 - 0.999**t)
                    lst[i] -= cur_lr * m_hat / (np.sqrt(v_hat) + eps)

                if i > 0:
                    delta = (delta @ W[i].T) * relu_grad(zs[i-1])

        elapsed = time.time() - t_start
        eta     = elapsed / (epoch+1) * (epochs - epoch - 1)
        print(f"  Epoch {epoch+1:3d}/{epochs}  loss={total_loss/n:.6f}  "
              f"elapsed={elapsed/60:.1f}m  eta={eta/60:.1f}m")

    params = [{'W': W[i].tolist(), 'b': b[i].tolist()} for i in range(len(W))]
    return params, {'mean': y_mean, 'std': y_std}

# ── Save ──────────────────────────────────────────────────────────────────────

OUTPUT = os.path.join(os.path.dirname(__file__), 'nn_weights.json')

def save_model(params, norm, h1=512, h2=256, h3=128, h4=64):
    out = {
        'arch':       [INPUT_DIM, h1, h2, h3, h4, 1],
        'input_dim':  INPUT_DIM,
        'norm':       norm,
        'params':     params,
        'trained_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    with open(OUTPUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    kb = os.path.getsize(OUTPUT) / 1024
    print(f"\nSaved {OUTPUT}  ({kb:.1f} KB,  {sum(len(p['b']) for p in params):,} output neurons)")

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--samples',  type=int,   default=1_000_000)
    ap.add_argument('--epochs',   type=int,   default=150)
    ap.add_argument('--batch',    type=int,   default=2048)
    ap.add_argument('--lr',       type=float, default=5e-4)
    ap.add_argument('--h1',       type=int,   default=512)
    ap.add_argument('--h2',       type=int,   default=256)
    ap.add_argument('--h3',       type=int,   default=128)
    ap.add_argument('--h4',       type=int,   default=64)
    ap.add_argument('--dropout',  type=float, default=0.20)
    ap.add_argument('--no-torch', action='store_true', dest='no_torch')
    args = ap.parse_args()

    random.seed(0)

    arch = f"{INPUT_DIM}→{args.h1}→{args.h2}→{args.h3}→{args.h4}→1"
    n_params = (INPUT_DIM*args.h1 + args.h1 +
                args.h1*args.h2  + args.h2 +
                args.h2*args.h3  + args.h3 +
                args.h3*args.h4  + args.h4 +
                args.h4*1        + 1)
    print(f"=== Tetris NN trainer — distillation from heuristic AI ===")
    print(f"Arch: {arch}  ({n_params:,} parameters)")
    print(f"Samples: {args.samples:,}  Epochs: {args.epochs}  "
          f"Batch: {args.batch}  LR: {args.lr}\n")

    print("Generating training data (with horizontal-mirror augmentation)...")
    t0 = time.time()
    samples = generate_samples(args.samples)
    print(f"Data generation: {time.time()-t0:.1f}s\n")

    use_torch = not args.no_torch
    if use_torch:
        try:
            import torch
        except ImportError:
            print("PyTorch not found — falling back to NumPy.")
            use_torch = False

    t0 = time.time()
    if use_torch:
        params, norm = train_torch(samples, args.epochs, args.batch, args.lr,
                                   args.h1, args.h2, args.h3, args.h4, args.dropout)
    else:
        params, norm = train_numpy(samples, args.epochs, args.batch, args.lr,
                                   args.h1, args.h2, args.h3, args.h4, args.dropout)
    print(f"\nTraining time: {(time.time()-t0)/60:.1f} min")

    save_model(params, norm, args.h1, args.h2, args.h3, args.h4)
    print("Done. Load nn_weights.json in ai2.js.")

if __name__ == '__main__':
    main()
