"""
PvP Tetris bot weight trainer — self-play (head-to-head simulation).
Two bots with different weights play against each other.
Fitness = win rate in round-robin tournament against population + hall of fame.

Loads from weights2.json if it exists, otherwise falls back to weights.json,
then to built-in defaults.
Outputs: weights2.json
"""

import json
import math
import random
import copy
import time
import sys
import os

try:
    import cma
    HAS_CMA = True
except ImportError:
    HAS_CMA = False

# ---------------------------------------------------------------------------
# Constants (must match constants.js)
# ---------------------------------------------------------------------------

COLS = 10
ROWS = 20
PKEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

ROTATIONS = {
    'I': [
        [[1,1,1,1]],
        [[1],[1],[1],[1]],
        [[1,1,1,1]],
        [[1],[1],[1],[1]],
    ],
    'J': [
        [[1,0,0],[1,1,1],[0,0,0]],
        [[0,1,1],[0,1,0],[0,1,0]],
        [[0,0,0],[1,1,1],[0,0,1]],
        [[0,1,0],[0,1,0],[1,1,0]],
    ],
    'L': [
        [[0,0,1],[1,1,1],[0,0,0]],
        [[0,1,0],[0,1,0],[0,1,1]],
        [[0,0,0],[1,1,1],[1,0,0]],
        [[1,1,0],[0,1,0],[0,1,0]],
    ],
    'O': [
        [[1,1],[1,1]],
        [[1,1],[1,1]],
        [[1,1],[1,1]],
        [[1,1],[1,1]],
    ],
    'S': [
        [[0,1,1],[1,1,0],[0,0,0]],
        [[0,1,0],[0,1,1],[0,0,1]],
        [[0,0,0],[0,1,1],[1,1,0]],
        [[1,0,0],[1,1,0],[0,1,0]],
    ],
    'T': [
        [[0,1,0],[1,1,1],[0,0,0]],
        [[0,1,0],[0,1,1],[0,1,0]],
        [[0,0,0],[1,1,1],[0,1,0]],
        [[0,1,0],[1,1,0],[0,1,0]],
    ],
    'Z': [
        [[1,1,0],[0,1,1],[0,0,0]],
        [[0,0,1],[0,1,1],[0,1,0]],
        [[0,0,0],[1,1,0],[0,1,1]],
        [[0,1,0],[1,1,0],[1,0,0]],
    ],
}

# Attack table (non-spin)
ATTACK_TABLE = {
    (1, False): 0,
    (2, False): 1,
    (3, False): 2,
    (4, False): 4,
    (1, True):  2,
    (2, True):  4,
    (3, True):  6,
}

# Cancel power: lines cleared → rows cancelled from opponent's garbage queue
# Index = lines cleared, [0]=no clear, [1]=single, [2]=double, [3]=triple, [4]=quad
_CANCEL_NORMAL = [0, 1, 2, 4, 6]
_CANCEL_SPIN   = [0, 2, 4, 8, 12]

# ---------------------------------------------------------------------------
# Weight definition
# ---------------------------------------------------------------------------

WEIGHT_KEYS = [
    'HEIGHT_WEIGHT',
    'HOLE_WEIGHT',
    'COVERED_HOLE_WEIGHT',
    'BUMPINESS_WEIGHT',
    'CLEAR_WEIGHT',
    'ATTACK_WEIGHT',
    'B2B_WEIGHT',
    'COMBO_WEIGHT',
    'TSPIN_WEIGHT',
    'SURVIVAL_WEIGHT',
    'WELL_WEIGHT',
    'QUAD_BONUS',
]

DEFAULT_WEIGHTS = {
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

# ---------------------------------------------------------------------------
# Board helpers
# ---------------------------------------------------------------------------

def collide(shape, x, y, grid):
    for r, row in enumerate(shape):
        for c, cell in enumerate(row):
            if not cell:
                continue
            nx, ny = x + c, y + r
            if nx < 0 or nx >= COLS or ny >= ROWS:
                return True
            if ny >= 0 and grid[ny][nx]:
                return True
    return False


def drop_y(shape, x, grid):
    y = 0
    while not collide(shape, x, y + 1, grid):
        y += 1
    return y


def place_piece(grid, shape, x, y):
    g = [row[:] for row in grid]
    for r, row in enumerate(shape):
        for c, cell in enumerate(row):
            if cell and 0 <= y + r < ROWS and 0 <= x + c < COLS:
                g[y + r][x + c] = 1
    return g


def clear_lines(grid):
    new_grid = [row for row in grid if not all(row)]
    cleared = ROWS - len(new_grid)
    while len(new_grid) < ROWS:
        new_grid.insert(0, [0] * COLS)
    return new_grid, cleared


def col_heights(grid):
    h = [0] * COLS
    for c in range(COLS):
        for r in range(ROWS):
            if grid[r][c]:
                h[c] = ROWS - r
                break
    return h


def count_holes(grid, heights):
    holes = 0
    covered = 0
    for c in range(COLS):
        blocks_above = 0
        for r in range(ROWS):
            if grid[r][c]:
                blocks_above += 1
            elif blocks_above > 0:
                holes += 1
                covered += max(0, blocks_above - 1)
    return holes, covered


def detect_tspin_slots(grid, heights):
    slots = 0
    for c in range(1, COLS - 1):
        if heights[c] + 2 <= heights[c - 1] and heights[c] + 2 <= heights[c + 1]:
            slots += 1
    return slots


def detect_well(heights):
    best = 0
    for c in range(COLS):
        left  = heights[c - 1] if c > 0 else 20
        right = heights[c + 1] if c < COLS - 1 else 20
        depth = min(left, right) - heights[c]
        if depth > best:
            best = depth
    return min(best, 8)


def survival_penalty(heights):
    max_h = max(heights)
    if max_h >= ROWS - 5:
        return (max_h - (ROWS - 5)) ** 2
    return 0


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def eval_board(grid, cleared, spin, combo, b2b, w):
    heights = col_heights(grid)
    agg = sum(heights)
    holes, covered = count_holes(grid, heights)
    bump = sum(abs(heights[c] - heights[c + 1]) for c in range(COLS - 1))
    tspin_val = detect_tspin_slots(grid, heights)
    well_val  = detect_well(heights)
    surv_pen  = survival_penalty(heights)

    attack_key = (min(cleared, 4), spin)
    base_atk = ATTACK_TABLE.get(attack_key, 0)
    if b2b > 0 and cleared >= 4 or (spin and cleared > 0):
        base_atk += min(b2b, 6) * 0.5
    attack = base_atk * (1 + 0.2 * combo)

    clear_rewards = [0, 0.5, 1.0, 2.0, 4.0]
    clear_reward = clear_rewards[min(cleared, 4)]
    if cleared == 4:
        clear_reward += w['QUAD_BONUS']

    return (
        w['HEIGHT_WEIGHT']         * agg
        + w['HOLE_WEIGHT']         * holes
        + w['COVERED_HOLE_WEIGHT'] * covered
        + w['BUMPINESS_WEIGHT']    * bump
        + w['CLEAR_WEIGHT']        * clear_reward
        + w['ATTACK_WEIGHT']       * attack
        + w['B2B_WEIGHT']          * (1 if (cleared >= 4 or spin) and cleared > 0 else 0)
        + w['COMBO_WEIGHT']        * combo
        + w['TSPIN_WEIGHT']        * tspin_val
        + w['SURVIVAL_WEIGHT']     * surv_pen
        + w['WELL_WEIGHT']         * well_val
    )


# ---------------------------------------------------------------------------
# Move generator
# ---------------------------------------------------------------------------

def gen_placements(grid, key):
    seen = set()
    placements = []
    for rot in range(4):
        shape = ROTATIONS[key][rot]
        w = len(shape[0])
        for x in range(-1, COLS - w + 2):
            if collide(shape, x, 0, grid):
                continue
            y = drop_y(shape, x, grid)
            sig = (rot, x, y)
            if sig in seen:
                continue
            seen.add(sig)
            placements.append((rot, x, y, shape))
    return placements


def best_placement(grid, key, combo, b2b, weights):
    best_score = -math.inf
    best = None
    for rot, x, y, shape in gen_placements(grid, key):
        g2 = place_piece(grid, shape, x, y)
        g3, cleared = clear_lines(g2)
        sc = eval_board(g3, cleared, False, combo, b2b, weights)
        if sc > best_score:
            best_score = sc
            best = (rot, x, y, g3, cleared)
    return best


# ---------------------------------------------------------------------------
# Bag / queue helpers
# ---------------------------------------------------------------------------

def fill_bag():
    bag = PKEYS[:]
    random.shuffle(bag)
    return bag


def make_queue():
    bag = []
    while len(bag) < 14:
        bag.extend(fill_bag())
    return bag


# ---------------------------------------------------------------------------
# PvP-specific helpers
# ---------------------------------------------------------------------------

def get_cancel_power(cleared, spin=False):
    table = _CANCEL_SPIN if spin else _CANCEL_NORMAL
    return table[min(cleared, 4)]


def apply_cancel(queue, power):
    """Drain `power` rows from front of garbage queue. Returns amount cancelled."""
    remaining = power
    cancelled = 0
    while remaining > 0 and queue:
        if remaining >= queue[0]:
            cancelled += queue[0]
            remaining -= queue[0]
            queue.pop(0)
        else:
            queue[0] -= remaining
            cancelled += remaining
            remaining = 0
    return cancelled


def add_garbage(grid, lines):
    """Shift `lines` rows off the top and append solid garbage rows with a single shared hole."""
    if lines <= 0:
        return [row[:] for row in grid]
    g = [row[:] for row in grid[lines:]]
    hole = random.randint(0, COLS - 1)
    for _ in range(lines):
        row = [1] * COLS
        row[hole] = 0
        g.append(row)
    return g


def compute_attack(cleared, spin, combo, b2b):
    base = ATTACK_TABLE.get((min(cleared, 4), spin), 0)
    if b2b > 0 and cleared > 0 and (cleared >= 4 or spin):
        base += min(b2b, 6) * 0.5
    return math.floor(base * (1 + 0.2 * combo))


def next_b2b(b2b, cleared, spin):
    if cleared <= 0:
        return b2b
    if cleared >= 4 or spin:
        return b2b + 1
    return 0


# ---------------------------------------------------------------------------
# Head-to-head simulation
# ---------------------------------------------------------------------------

def simulate_vs(weights_a, weights_b, max_pieces=400):
    """
    Simulate one head-to-head game between two bots.
    Both players take turns simultaneously (interleaved one piece at a time).
    Returns ('a' | 'b' | 'draw', total_attack_a, total_attack_b).
    """
    grid_a, queue_a, combo_a, b2b_a, gq_a = [[0]*COLS for _ in range(ROWS)], make_queue(), 0, 0, []
    grid_b, queue_b, combo_b, b2b_b, gq_b = [[0]*COLS for _ in range(ROWS)], make_queue(), 0, 0, []
    atk_a = 0
    atk_b = 0

    for _ in range(max_pieces):
        # ── Player A's turn ──────────────────────────────────────
        if len(queue_a) < 7:
            queue_a.extend(fill_bag())
        key_a = queue_a.pop(0)
        result_a = best_placement(grid_a, key_a, combo_a, b2b_a, weights_a)
        if result_a is None:
            return 'b', atk_a, atk_b

        _, _, _, ng_a, cleared_a = result_a

        if cleared_a > 0:
            cancelled = apply_cancel(gq_a, get_cancel_power(cleared_a))
            if cancelled == 0:
                atk = compute_attack(cleared_a, False, combo_a, b2b_a)
                if atk > 0:
                    gq_b.append(atk)
                    atk_a += atk
            b2b_a = next_b2b(b2b_a, cleared_a, False)
            combo_a += 1
        else:
            combo_a = 0
            if gq_a:
                ng_a = add_garbage(ng_a, gq_a.pop(0))

        grid_a = ng_a

        # ── Player B's turn ──────────────────────────────────────
        if len(queue_b) < 7:
            queue_b.extend(fill_bag())
        key_b = queue_b.pop(0)
        result_b = best_placement(grid_b, key_b, combo_b, b2b_b, weights_b)
        if result_b is None:
            return 'a', atk_a, atk_b

        _, _, _, ng_b, cleared_b = result_b

        if cleared_b > 0:
            cancelled = apply_cancel(gq_b, get_cancel_power(cleared_b))
            if cancelled == 0:
                atk = compute_attack(cleared_b, False, combo_b, b2b_b)
                if atk > 0:
                    gq_a.append(atk)
                    atk_b += atk
            b2b_b = next_b2b(b2b_b, cleared_b, False)
            combo_b += 1
        else:
            combo_b = 0
            if gq_b:
                ng_b = add_garbage(ng_b, gq_b.pop(0))

        grid_b = ng_b

    # Both survived to piece limit — tiebreak by total attack sent
    if atk_a > atk_b:
        return 'a', atk_a, atk_b
    if atk_b > atk_a:
        return 'b', atk_a, atk_b
    return 'draw', atk_a, atk_b


def match_score(result, player):
    """Win=1.0, draw=0.5, loss=0.0."""
    if result == player:
        return 1.0
    if result == 'draw':
        return 0.5
    return 0.0


def vs_fitness(weights, opponents, games_per_match=2):
    """
    Win rate of `weights` across symmetric matches against each opponent.
    Each match = `games_per_match` games as A + same as B = 2×games_per_match games total.
    """
    wins = 0.0
    total = 0
    for opp in opponents:
        for _ in range(games_per_match):
            r, _, _ = simulate_vs(weights, opp)
            wins += match_score(r, 'a')
            r, _, _ = simulate_vs(opp, weights)
            wins += match_score(r, 'b')
            total += 2
    return wins / total if total > 0 else 0.0


# ---------------------------------------------------------------------------
# Weight operators
# ---------------------------------------------------------------------------

def rand_weights(base=None):
    if base is None:
        base = DEFAULT_WEIGHTS
    w = {}
    for k in WEIGHT_KEYS:
        d = base[k]
        w[k] = d + random.gauss(0, abs(d) * 0.5 + 0.1)
    return w


def crossover(a, b):
    return {k: (a[k] if random.random() < 0.5 else b[k]) for k in WEIGHT_KEYS}


def mutate(w, sigma=0.15):
    m = copy.deepcopy(w)
    for k in WEIGHT_KEYS:
        if random.random() < 0.3:
            m[k] += random.gauss(0, abs(m[k]) * sigma + 0.05)
    return m


# ---------------------------------------------------------------------------
# Self-play GA
# ---------------------------------------------------------------------------

def run_selfplay_ga(pop_size=40, generations=30, elite=4,
                    opponents_per_eval=4, games_per_match=2, seed_weights=None):
    base = seed_weights if seed_weights is not None else DEFAULT_WEIGHTS
    src  = 'weights2.json' if seed_weights else 'defaults'
    print(f"Self-play GA  pop={pop_size}  gens={generations}  (seed: {src})")
    print(f"Each individual: {opponents_per_eval} opponents × {games_per_match*2} games")

    population = [rand_weights(base) for _ in range(pop_size - 1)]
    population.append(copy.deepcopy(base))

    best_overall = copy.deepcopy(base)
    best_score   = -math.inf
    hall_of_fame = [copy.deepcopy(base)]  # past bests, used as stable opponents

    for gen in range(generations):
        t0 = time.time()
        scored = []

        for i, w in enumerate(population):
            # Draw opponents from rest of population + hall of fame
            pool = [x for j, x in enumerate(population) if j != i] + hall_of_fame
            k    = min(opponents_per_eval, len(pool))
            opponents = random.sample(pool, k)
            sc = vs_fitness(w, opponents, games_per_match)
            scored.append((sc, w))
            if i % 5 == 0:
                print(f"  gen {gen+1}/{generations}  {i}/{pop_size}  "
                      f"running_best={best_score:.3f}", end='\r', flush=True)

        scored.sort(key=lambda x: -x[0])
        gen_best_score, gen_best_w = scored[0]

        if gen_best_score > best_score:
            best_score   = gen_best_score
            best_overall = copy.deepcopy(gen_best_w)
            hall_of_fame.append(copy.deepcopy(gen_best_w))
            if len(hall_of_fame) > 10:
                hall_of_fame.pop(0)

        elapsed = time.time() - t0
        print(f"  Gen {gen+1:2d}/{generations}  "
              f"gen_best={gen_best_score:.3f}  overall_best={best_score:.3f}  "
              f"({elapsed:.1f}s)          ")

        elites  = [w for _, w in scored[:elite]]
        new_pop = copy.deepcopy(elites)
        while len(new_pop) < pop_size:
            a = random.choice(elites)
            b = random.choice(elites)
            new_pop.append(mutate(crossover(a, b)))
        population = new_pop

    return best_overall, best_score


# ---------------------------------------------------------------------------
# Self-play CMA-ES  (optional)
# ---------------------------------------------------------------------------

def run_selfplay_cmaes(sigma0=0.3, maxiter=60, games_per_eval=6, seed_weights=None):
    """
    CMA-ES with a rolling opponent: optimise against a fixed opponent,
    then promote the winner and repeat. Three rounds total.
    """
    base = seed_weights if seed_weights is not None else DEFAULT_WEIGHTS
    src  = 'weights2.json' if seed_weights else 'defaults'
    print(f"Self-play CMA-ES  (seed: {src})")

    opponent  = copy.deepcopy(base)
    best_w    = copy.deepcopy(base)
    best_sc   = 0.0
    rounds    = 3
    iters_per = maxiter // rounds

    for rnd in range(rounds):
        print(f"\nRound {rnd+1}/{rounds} — opponent updated")
        fixed_opp = copy.deepcopy(opponent)
        x0 = [base[k] for k in WEIGHT_KEYS]

        def neg_fitness(x):
            w = {k: v for k, v in zip(WEIGHT_KEYS, x)}
            wins = 0.0
            for _ in range(games_per_eval):
                r1, _, _ = simulate_vs(w, fixed_opp)
                wins += match_score(r1, 'a')
                r2, _, _ = simulate_vs(fixed_opp, w)
                wins += match_score(r2, 'b')
            return -(wins / (games_per_eval * 2))

        es = cma.CMAEvolutionStrategy(x0, sigma0, {
            'maxiter': iters_per,
            'tolx': 1e-4,
            'verbose': 1,
        })
        while not es.stop():
            solutions = es.ask()
            es.tell(solutions, [neg_fitness(x) for x in solutions])
            es.disp()

        new_x  = es.result.xbest
        new_w  = {k: v for k, v in zip(WEIGHT_KEYS, new_x)}
        new_sc = -es.result.fbest

        if new_sc > best_sc:
            best_sc = new_sc
            best_w  = copy.deepcopy(new_w)

        opponent = copy.deepcopy(new_w)
        base     = copy.deepcopy(new_w)  # seed next round from this result

    return best_w, best_sc


# ---------------------------------------------------------------------------
# Load / save
# ---------------------------------------------------------------------------

OUTPUT_FILE  = os.path.join(os.path.dirname(__file__), 'weights2.json')
FALLBACK_FILE = os.path.join(os.path.dirname(__file__), 'weights.json')


def load_weights():
    """
    Try weights2.json first, then weights.json as fallback.
    Returns (weights_dict, fitness_or_None) or (None, None).
    """
    for path in (OUTPUT_FILE, FALLBACK_FILE):
        if not os.path.exists(path):
            continue
        try:
            with open(path) as f:
                data = json.load(f)
            w = data.get('weights', {})
            if all(k in w for k in WEIGHT_KEYS):
                label = os.path.basename(path)
                print(f"Loaded seed weights from {label}  (fitness={data.get('fitness')})")
                return {k: float(w[k]) for k in WEIGHT_KEYS}, data.get('fitness')
        except Exception:
            pass
    return None, None


def save_weights(weights, score):
    out = {
        'weights':    weights,
        'fitness':    score,
        'trained_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'keys':       WEIGHT_KEYS,
    }
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(out, f, indent=2)
    print(f"\nSaved to {OUTPUT_FILE}  (fitness={score:.4f})")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    method = 'cmaes' if HAS_CMA else 'ga'
    if len(sys.argv) > 1 and sys.argv[1] in ('ga', 'cmaes'):
        method = sys.argv[1]
    if method == 'cmaes' and not HAS_CMA:
        print("cma not installed — falling back to GA.  pip install cma to use CMA-ES.")
        method = 'ga'

    saved_w, _ = load_weights()
    if saved_w is None:
        print("No existing weights found — starting from defaults.")

    random.seed(42)
    if method == 'cmaes':
        best_w, best_sc = run_selfplay_cmaes(seed_weights=saved_w)
    else:
        best_w, best_sc = run_selfplay_ga(seed_weights=saved_w)

    save_weights(best_w, best_sc)
    print("\nBest weights:")
    for k, v in best_w.items():
        print(f"  {k:25s} = {v:+.4f}")
