# sirteT — Game Specification

---

## 1. Overview

sirteT is a falling-block puzzle game. Pieces (tetrominoes) fall from the top of a configurable grid (standard 10×20). Players rotate and position pieces to complete horizontal lines, which are cleared and scored. The game includes solo modes, a vs-bot mode, a 1v1 multiplayer mode, an account system for cross-device stats, and a settings system.

---

## 2. Board & Pieces

### Board
- Configurable width (4–20 columns) and height (4–100 rows). The standard size is **10 columns × 20 rows**, marked with a red asterisk in the Setup screen because it affects ranked records.
- Hidden buffer rows above row 0 (pieces spawn there)
- Cells are either empty or hold a color value
- Pieces always spawn horizontally centered at the top of the board, regardless of board width.

### Overhang
When the board width is set to 4, an **Overhang** toggle appears in Setup. When enabled, two pre-filled cells (Z-piece color) are placed in the bottom rows at game start:

```
col:  0  1  2  3
H-2:  .  .  #  #
H-1:  .  .  .  #
```

This creates the classic 4-wide combo setup: the right column is already partially filled, so stacking pieces across the left three columns continuously completes lines and sustains a combo chain.

### Piece Set (7-bag)
Pieces are generated using the **7-bag system**: all 7 tetrominoes are shuffled into a random order, then the next bag begins. This guarantees no tetromino droughts longer than 12 pieces.

| Key | Name   | Color    |
|-----|--------|----------|
| I   | I-piece | Cyan    |
| O   | O-piece | Yellow  |
| T   | T-piece | Purple  |
| S   | S-piece | Green   |
| Z   | Z-piece | Red     |
| J   | J-piece | Blue    |
| L   | L-piece | Orange  |

### Rotation States
Each piece has 4 explicit rotation states (0, R, 2, L) defined by the Tetris guideline. Rotation is a direct table lookup — no matrix math — ensuring pixel-perfect shapes at every state.

---

## 3. Rotation System

### SRS (Super Rotation System)
When a rotation is requested:
1. **Test plain rotation** (no offset). If it fits, apply immediately.
2. If plain fails, **try SRS kick offsets** (tests 2–5 from the guideline tables).
3. If all 5 tests fail, the rotation is rejected.

The kick offset `(dx, dy)` is applied as `(piece.x + dx, piece.y − dy)` — the Y subtraction converts from guideline coordinates (+y = up) to canvas coordinates (+y = down).

**JLSTZ kick table (0→R, R→2, 2→L, L→0, and reverses):**
```
0→R: (0,0)(−1,0)(−1,+1)(0,−2)(−1,−2)
R→0: (0,0)(+1,0)(+1,−1)(0,+2)(+1,+2)
R→2: (0,0)(+1,0)(+1,−1)(0,+2)(+1,+2)
2→R: (0,0)(−1,0)(−1,+1)(0,−2)(−1,−2)
2→L: (0,0)(+1,0)(+1,+1)(0,−2)(+1,−2)
L→2: (0,0)(−1,0)(−1,−1)(0,+2)(−1,+2)
L→0: (0,0)(−1,0)(−1,−1)(0,+2)(−1,+2)
0→L: (0,0)(+1,0)(+1,+1)(0,−2)(+1,−2)
```

**I-piece has its own kick table** per the Tetris guideline.

### Kick Toggle
The kick system can be disabled entirely in Settings. With kicks off, a rotation is either applied in-place or rejected.

### 180° Rotation
The A key rotates 180°. It attempts plain rotation first, then tries a set of basic offsets (no standard SRS table for 180).

---

## 4. Spin Detection

A **spin** is detected at lock time if the condition is met:

1. **Piece is immobile** — after locking, the piece cannot move left, right, or up without collision.

Downward movement is not tested for immobility since pieces is already going to be locked.

---

## 5. Locking

### Lock Delay
When a piece first touches the ground, a **1000ms lock timer** starts. The piece does not lock immediately.

### Lock Reset
Any successful rotation or translation while grounded **resets the 1000ms timer**. This allows players to maneuver pieces after contact.

### 15-Move Cap
The lock timer can be reset at most **15 times** per piece. After 15 resets, the timer runs to completion regardless of further input.

### Lock Flash
While the lock timer is counting down, the active piece flashes between its normal color and a darkened version with a 1000ms period (500ms each half-cycle), giving visual feedback that locking is imminent.

---

## 6. Gravity

### Leveled (default)
Drop interval follows the Tetris guideline formula:
```
interval = max(33ms, ((0.8 − (level−1) × 0.007)^(level−1)) × 1000ms)
```
Level increases by 1 for every 10 lines cleared. Minimum interval: 33ms (~30G).

### Static
A fixed multiplier (0.1×–20×) set in Settings. Interval = `max(33ms, 800ms / multiplier)`.

---

## 7. Attack & Scoring

### Base Attack (lines sent per clear)
| Clear Type         | Lines Sent |
|--------------------|------------|
| Single             | 0          |
| Double             | 1          |
| Triple             | 2          |
| Quad               | 4          |
| Spin Single        | 2          |
| Spin Double        | 4          |
| Spin Triple        | 7          |
| Perfect Clear      | 10         |
| Colored Clear      | 5          |

### Perfect Clear
- **Perfect Clear (10 lines):** The board is completely empty after the line clear, and none of the cleared rows contained garbage.
- **Colored Clear (5 lines):** The board is completely empty after the clear, but some cleared rows contained garbage lines.

### Back-to-Back (B2B)
Consecutive **B2B-eligible** clears (quads or spins) without a non-eligible clear in between increment the B2B counter. The counter provides a bonus on top of base attack:

| B2B Count | Extra Lines |
|-----------|-------------|
| 1–2       | +0          |
| 3–5       | +1          |
| 6–10      | +2          |
| 11–20     | +3          |
| 21–50     | +4          |
| 51–100    | +5          |
| 101+      | +6          |

### Combo
When clearing lines on consecutive pieces (no zero-clear in between), a combo multiplier applies:
```
attack = floor(base × (1 + 0.2×combo))
```
where `base` is attack after B2B bonus and `combo` is the consecutive clear count. This formula ensures singles contribute to combo attack without inflating doubles/triples/quads excessively.

### Solo Scoring (Marathon, Sprint, Zen)
Standard point system: `[0, 100, 300, 500, 800][lines_cleared] × level`.

### Blitz Scoring
Score equals total **garbage lines sent** (attack), not points. The stat label changes to "Sent".

---

## 8. Game Modes

### Marathon
Endless play. Gravity increases with level. Game ends when the board tops out.

### Sprint
Clear a target number of lines as fast as possible. Sub-modes: **20L**, **40L**, **100L**.

### Blitz
Maximize garbage lines sent within a time limit. Sub-modes: **30s**, **1m**, **2m**.

### Zen
No gravity increase, no game over, infinite hold. Practice environment.

### Combo Race
A fixed-configuration timed mode. Selecting it in the Setup screen automatically locks the settings to:
- Board size: 4 wide × 20 tall
- Overhang: On (see below)
- Gravity: Leveled, Kicks: SRS, Hold: Normal, Practice: Off

The timer counts down from **30 seconds**. The objective is to achieve the **highest combo** within the time limit. Max combo is displayed live in the stats panel and shown prominently in the result overlay when time expires. The personal best max combo is saved to the Stats screen. Combo Race results are not ranked (no leaderboard sync).

### vs Bot
Player competes against a local AI opponent. See section 14.

### 1v1 Multiplayer
Real-time match against another player over Firebase. See section 15. *(Currently under construction — not available.)*

### Quick Play
Always-open ranked free-for-all over Firebase. See section 16.

### Custom Multi-Player Room
2–8 players in a host-controlled private room over Firebase. See section 19. *(Currently under construction — not available.)*

---

## 9. Ranked Play

Sprint and Blitz results are saved to records only when played with **standard settings**:
- Gravity: Leveled
- Kicks: SRS
- Hold: Normal (once per piece)
- Board Size: 10×20
- Practice Mode: Off

Settings that affect ranking show a red **\*** marker in the Setup screen. If non-standard settings are active, a warning banner ("⚠ Non-standard settings — score won't count in records") is shown and results are not saved.

---

## 10. Hold

| Mode     | Behavior                                      |
|----------|-----------------------------------------------|
| Normal   | Hold once per piece. Resets on new piece spawn. |
| Infinite | Swap hold piece at any time, unlimited.        |
| None     | Hold is disabled entirely.                     |

On hold: current piece goes to the hold slot; held piece (or next queue piece if empty) spawns. `lastMoveWasRotation` resets on hold.

---

## 11. Piece Preview

Solo: 0–7 pieces shown (configurable in Settings).  
VS: always 5 pieces shown.

---

## 12. Controls (default keybinds)

| Action         | Key 1     | Key 2     |
|----------------|-----------|-----------|
| Move Left      | ←         | —         |
| Move Right     | →         | —         |
| Soft Drop      | ↓         | —         |
| Hard Drop      | Space     | —         |
| Rotate CW      | ↑         | X         |
| Rotate CCW     | Z         | —         |
| Rotate 180°    | A         | —         |
| Hold           | C         | L-Shift   |
| Pause          | P         | —         |

All binds are configurable in the Settings screen (up to 2 per action).

### Handling
- **DAS** (Delayed Auto Shift): delay before auto-repeat begins (default 167ms)
- **ARR** (Auto Repeat Rate): repeat interval once DAS fires (default 33ms, 0 = instant wall teleport)
- **SDF** (Soft Drop Factor): soft drop speed as a multiple of gravity (default 10×, 41 = instant)

---

## 13. Splash Text

On any line clear that sends attack, a splash number appears over the board:

- Displays **+N** where N is lines sent
- Color scales: white (<3), purple (3–5), blue (6–9), gold (10+)
- **Stacking**: a new attack splash accumulates onto the existing one (total increments in place) only when **both** conditions are true: the player is in an active combo (at least 2 consecutive clears) **and** the new attack arrives within 1000ms of when the current splash appeared. Otherwise the old splash is replaced with a fresh one showing only the new value.
- Fades out after ~900ms

---

## 14. vs Bot

### Overview
The player competes against a local AI bot on two side-by-side boards. The match ends when either player tops out.

### Bot AI
Two AI evaluator versions are available, selectable in the vs Bot setup screen:

- **Version 1 (Diver Down)** — the default evaluator. Uses a multi-phase placement scoring engine.
- **Version 2** — an alternative evaluator with a different heuristic weighting, generally stronger on certain board states.

### Bot Speed
Speed is set before the match in the vs Bot setup screen:
- Range: **0.5–20 PPS** (pieces per second), selectable in 0.25 PPS increments
- Dragging the slider past 20 enables **MAX** mode — the bot places pieces as fast as the engine can run (uncapped)

### Board Layout
Both the player board and the bot board use the **same structure**:

```
[Next preview] [Hold] [Board + splashes] [Garbage bar]
```

- The **Next preview** panel sits to the left of the board
- The **Hold** panel sits between the preview and the board
- **Splash text** (attack numbers, line-clear labels, combo/B2B counters) appears to the left of the board canvas for both sides
- The **garbage bar** sits to the right of the board canvas
- The bot's hold piece is rendered and updates live

### Screen Layout
A narrow **sidebar column** on the far left of the screen replaces the traditional top header. It shows from top to bottom: the mode label ("vs Bot"), the match timer, and the Menu button.

### Attack & Garbage
Attack and garbage mechanics are identical to 1v1 multiplayer (see section 15). The bot's incoming garbage queue is displayed on its garbage bar.

---

## 15. Multiplayer (1v1) *(Under Construction)*

> 1v1 Rooms are currently disabled. The Create and Join entry points are blocked on both the client and server. The specification below describes the intended behavior when the feature is enabled.

### Room System
- Player 1 creates a room, receives a 6-character room code.
- Player 2 enters the code to join.
- Any additional joiners become **spectators**.
- If a game is already in progress when someone joins, they are forced to spectator regardless of available slots.

### Shared Piece Sequence
Both players draw from the same seeded piece sequence, generated from a random seed stored in Firebase when the room is created. This means both players receive identical bags in identical order.

### Packets
A board state packet is sent to Firebase (throttled to once per animation frame) on any of the following events:
- Piece spawned
- Piece moved left or right
- Piece moved down (soft drop or gravity)
- Hard drop
- Piece rotated
- Piece locked
- Garbage entered the board
- Hold used

Packets carry: serialized board (with piece colors), score, lines, alive status, next 5 piece queue, active piece position and rotation.

### Board Colors
The opponent's board is rendered with full piece colors (not just a binary filled/empty representation). Garbage rows are rendered in dark grey (`#444455`).

### Board Layout
Both the player board and the opponent board use the **same structure**:

```
[Next preview] [Hold] [Board + splashes] [Garbage bar]
```

- The **Next preview** panel sits to the left of each board
- The player's **Hold** panel is shown; opponent hold is not transmitted
- **Splash text** appears to the left of the board canvas for both sides
- The **garbage bar** sits to the right of the player's board (incoming garbage)

### Screen Layout
A narrow **sidebar column** on the far left of the screen replaces the traditional top header. It shows from top to bottom: the mode label ("1v1"), the match timer, and the Leave button.

### Attack Flow (Outgoing)
1. A line clear generates an attack value.
2. The attack is added to **outgoing segments**. If the previous segment was within 1000ms, it merges into it; otherwise a new segment is created.
3. After 1000ms of no new attack additions, all pending segments are **flushed to Firebase** as a batch.
4. The opponent's attack bar (left side of their board) shows your pending incoming attack as red segments separated by thin black dividers.

### Attack Flow (Incoming)
1. Opponent's attack arrives as Firebase segments.
2. **Cancellation**: your own pending outgoing attack cancels incoming attack first. If you have 5 outgoing and the opponent sends 3 incoming, the incoming is fully cancelled and you still have 2 outgoing left.
3. Remaining incoming segments sit in a queue.
4. On each **piece lock**, one segment from the incoming queue enters the board as garbage lines.
5. Garbage lines are full rows of `#444455` with one random empty cell (the "hole") in a consistent column per batch.

### Attack Bar Display
Each attack bar is a vertical strip next to the board:
- **My bar** (right of my board): shows what the opponent has sent me (incoming)
- **Opp bar** (right of opponent's board): shows what the opponent has incoming
- Each segment is a red rectangle proportional to its line count
- Segments are separated by thin black dividers

### Win Condition
A player tops out (piece cannot spawn) and loses. The opponent is shown a "YOU WIN" overlay.

### Spectator Mode
Spectators see both boards updated in real time from Firebase. They cannot interact with the game.

---

## 16. Quick Play

### Overview
Quick Play is an always-open free-for-all mode played over Firebase. There is no room code or waiting lobby — joining puts the player immediately into the live game. Any number of players can be in the same session simultaneously, and new players can join at any time while others are already playing. **No account required** — anonymous players are assigned a random `Player ########` identity for the session.

### Session Structure
- A single shared session exists globally at all times (`quickplay/players/` in Firebase).
- Each player writes their own state to `quickplay/players/{uid}`. Entries older than 30 seconds are considered stale and are ignored by other clients.
- **Authenticated players** use their Firebase uid. **Anonymous players** are assigned a randomly generated session uid in the format `anon_########` (8-digit number), valid only for the current session.
- Player entries are removed from Firebase on leave (`onDisconnect().remove()` ensures cleanup on browser crash or disconnect).

### Scoring

Score accumulates continuously at a rate equal to the current **climb speed** (points per second). There is no cap on score. Gravity uses the standard leveled formula (same as Marathon).

#### Climb Speed Bar
A thin 2px horizontal line is displayed centered at the bottom edge of the board. Its width grows proportionally with climb speed (90% board width = 3.0 climb speed, capped there visually).

#### Climb Speed Mechanics
| Event | Change |
|---|---|
| Line cleared | +0.1 per line (e.g. Quad = +0.4) |
| Attack line sent | +0.1 per attack line generated |
| Decay | ×0.90 per second (applied each frame as `×0.90^(dt/1000)`) |

Climb speed has a **minimum floor of 0.1** — it never decays below this value. Speed starts at 0.1 when a game begins.

Each frame: `score += climbSpeed × (dt / 1000)`.

#### KO Bonus
When an opponent tops out due to your garbage, **+15** is added directly to your score (not to climb speed). Each KO is counted once.

### Attack Targeting
When a player generates an attack (garbage lines), those lines are sent to a single target determined by score ranking:

- **Normal case**: attack goes to the player with the score **immediately above** yours.
- **Highest score**: if you have the top score, attack goes to the player **immediately below** you.
- **No valid target** (you are the only active player, or all others are dead/stale): attack goes nowhere.

Attacks are sent via the socket event `qp:sendAttack` (not HTTP), so both authenticated and anonymous players can send them. The server validates that the sender has an active QP session and is still alive before writing the attack to `quickplay/attacks/{targetUid}/`. Targets consume and remove each entry as they receive it.

### Garbage Application
Incoming garbage is queued and applied on each piece lock (one segment per lock), identical to the 1v1 multiplayer mechanic. No cancellation — incoming garbage cannot be offset by outgoing attack.

### KO Detection
When a player tops out, they write `killedBy: {uid}` to their own Firebase entry. All active clients monitor all player entries; upon seeing a `killedBy` equal to their own uid for a newly dead player, they award themselves +15 points directly (bypasses climb speed). Each KO is tracked locally to prevent double-counting.

### Board Layout
The Quick Play screen has three columns:

```
[Sidebar] [Next preview | Hold | Board + splashes | Garbage bar] [Leaderboard]
```

- The **sidebar** (left) shows the mode label, current score, and the current target's username.
- The **board area** (center) is the same layout as vs Bot / 1v1: preview, hold, board with splashes, and a garbage bar.
- The **leaderboard** (right, 180px) shows all active players sorted by score descending. The current player's row is highlighted with an accent background. Dead players are faded.
  - If the player is in the **top 20**: all up to 20 entries are shown.
  - If the player is **outside the top 20**: the top 10 entries are shown, a divider separates them, and then the 10 players nearest in rank to the current player are shown (centered on the player's rank, clamped so it never overlaps the top 10).

### Death
When a player tops out, an overlay appears on their board showing "YOU DIED" and their final score. The Firebase entry is updated with `alive: false` and `killedBy`. The player can leave using the Leave button; the loop continues rendering the frozen board in the background so they can watch the panel.

### QP Bots
The server (`server/qpBots.js`) runs 8 persistent bot players that populate the Quick Play session. Bots write their state directly to Firebase using the Admin SDK — they appear in the leaderboard and targeting pool identically to human players.

Each bot has an **APM** (actions per minute) value evenly distributed between 5 and 120 across the 8 bots. APM governs three properties:

| Property | Formula |
|---|---|
| Climb speed (pts/s) | `0.1 + (apm / 120) × 2.2` + small random jitter |
| Max attack size (lines) | `max(1, round((apm / 120) × 20))` — APM 5 → 1 line, APM 120 → 20 lines |
| Kill threshold (lines in 5 s) | `10 + 40 × ((apm − 5) / 115)²` — concave-up; APM 5 → 10 lines, APM 120 → 50 lines |

**Attack timing**: bots fire attacks at random intervals averaging `60000 / (apm / 18)` ms, with ±40% randomisation. Each attack picks a random line count from 1 to the bot's max attack size.

**Targeting**: bots use the same 10-nearest weighted-by-speed logic as human players.

**Death and respawn**: incoming attacks to a bot are summed in a rolling 5-second window. When the total exceeds the bot's kill threshold, the bot writes `alive: false` and `killedBy: <attacker uid>` to Firebase — human players receive the standard +15 KO bonus. The bot respawns with `score: 0` after a random 3–8 second delay.

Bots are started when the HTTP server begins listening and run for the lifetime of the process. On `SIGTERM`/`SIGINT`, bot Firebase entries are removed before the process exits. If the server crashes without cleanup, stale bot entries are naturally filtered out by the 30-second `lastSeen` staleness check on all clients.

---

## 17. Visual Effects

### Stupid Mode Effects
Four optional visual effects ("stupid mode") can be enabled independently in Settings. Each effect runs on an independent BPM clock (30–500 BPM, default 120). A convenience **"Apply BPM to all"** input in Settings sets all four BPMs at once.

| Effect       | What it does |
|--------------|--------------|
| Color Shift  | On each tick, cycles the displayed colors of all pieces through the piece color palette. |
| Limbo        | On each tick, randomly reorders which pieces are shown in the preview panel (the actual queue order is unchanged — only the display is shuffled). |
| Drunk        | On each tick, shifts the board and piece canvas horizontally by a random offset, producing a wobble effect. |
| Circles      | Applies a continuous slow circular orbit to the board canvas and to the active piece independently, so both drift in loops. |

Each effect has an independent **On/Off** toggle and its own **BPM** input displayed on the same row in the Settings screen.

### Motion Blur
A trail of blurred ghost images follows the active piece as it moves. Each ghost fades in opacity and increases in blur radius as it ages, rendered oldest-to-newest so the freshest entry sits on top.

- **Trail length** (0–10, default 5): how long the trail persists. Duration = `setting × 40ms`; max entries = `setting + 2`. **Setting to 0 disables motion blur entirely** (no separate On/Off toggle).
- **Trail intensity** (0–10, default 5): scales trail opacity. 5 = default; 10 ≈ double brightness. Setting to 0 also disables the effect.
- On **hard drop**, trail entries are injected for each intermediate row the piece passed through, producing a vertical streak along the drop path.
- Applies in all game modes: Solo, vs Bot, vs (1v1), Marathon Rooms, and Quick Play.

### Board Bounce
When the active piece moves left, right, or is hard-dropped, the `#board-wrap` element shifts slightly in that direction then glides back to center using exponential decay (no spring oscillation — no overshoot).

- **Bounciness** (0–10, default 5): displacement magnitude per input. 0 = no movement.
- **Elasticity** (1–10, default 8): controls the decay rate. Low = snaps back quickly; high = drifts back slowly. Implemented as `position × decay` per frame where `decay = 0.70 + (elasticity / 10) × 0.22`.
- Hard drops use a 1.8× stronger impulse than lateral moves.
- Applies in all game modes: Solo, vs Bot, vs (1v1), Marathon Rooms, and Quick Play.

### Drop Trails
When a piece is hard-dropped and travels at least one row, vertical speed lines appear along the left and right outer edges of the piece, spanning the drop distance. Three parallel lines per side spread outward with decreasing opacity. The lines fade out over ~420ms.

- **Intensity** (0–10, default 5): scales line opacity. **Setting to 0 disables drop trails entirely** (no separate On/Off toggle).
- Applies in all game modes: Solo, vs Bot, vs (1v1), Marathon Rooms, and Quick Play.

### Disintegrate
When enabled, each cell in a cleared line breaks apart and animates off the board individually. On clear, each cell is captured at its pixel position before the row is removed from the grid. Particles are then rendered each frame with:

- **Directional drift**: each cell gets an independent random horizontal velocity (±0.04 px/ms) and downward velocity (0.01–0.08 px/ms), plus mild random gravitational acceleration, so cells fan out in slightly different directions.
- **Brightness bloom**: cells bleach toward white over their lifetime (white overlay opacity scales linearly with progress, reaching up to 70%).
- **Fade out**: alpha follows a power-decay curve (`pow(1 - progress, 1.4)`), so cells linger bright then vanish quickly at the end.

Total particle lifetime is 700ms. Particles render on top of the grid after all other board content. The setting is a simple On/Off toggle in the **Visuals** section of Settings (**on by default**).

### Acid
A post-process effect applied to the board canvas each frame. When enabled, two distortions are layered:

1. **Wave distortion** — The board canvas is read into an offscreen canvas and re-drawn in 2px-tall horizontal scanline strips. Each strip is offset horizontally by a dual-frequency sine function and vertically by a single-frequency sine, producing a fluid, morphing warp. Both horizontal terms use an animated phase that advances each frame; the vertical term uses a perpendicular phase offset.

2. **Phosphor persistence** — An accumulation canvas (same size as the board) retains the previous frame's image, dimmed each frame by filling with `rgba(10, 10, 12, fadeAmt)` at `source-over`. The current distorted frame is then composited onto the accumulation canvas using `screen` blending (so the near-black board background becomes transparent and only bright piece colors accumulate). The final accumulated image is overlaid back onto the board canvas with `screen` blending at a set opacity, producing a glowing afterimage trail behind every piece.

The **Acid Meter** (1–10, default 5) controls:
- **Distortion amplitude**: scales with the meter value (stronger warp at higher settings).
- **Persistence fade rate**: high meter = slower fade = longer afterimage trails (brighter, more saturated accumulation).
- **Overlay opacity**: higher meter = brighter phosphor overlay.

Acid is off by default and is found in the **Stupid** section of Settings. Both effects reset (accumulation canvas cleared) when a game stops.

### Chromatic Aberration
A post-process pixel-shift effect applied to the board canvas each frame. It splits the red and blue color channels horizontally, simulating lens fringing.

- **Edge-weighted**: the channel offset scales with horizontal distance from the board center — near-zero at the center column, strongest at the left and right edges. Offset at column `x` = `(intensity/3) × |2x/w − 1|` pixels.
- The red channel is shifted left; the blue channel is shifted right by the same amount. The green channel is unchanged.
- Implemented with a pre-allocated pixel buffer (`Uint8ClampedArray`) to avoid per-frame heap allocation.
- An **On/Off** toggle and an **Intensity** slider (1–10, default 5) are in the **Visuals** section of Settings. Off by default.

---

## 18. Sound System

Audio is handled by `front/js/sound.js`, which is imported by all game modules.

### Preloading

All SFX files are fetched as `ArrayBuffer`s immediately when the module loads — no `AudioContext` is needed for this step. When the `AudioContext` is first created (on the initial user interaction), all pre-fetched buffers are decoded in one batch into `AudioBuffer`s and stored in a cache. Subsequent calls to `playSfx` play directly from the decoded buffer with no file I/O or decode latency.

### Sound Effects

One-shot sounds played via `playSfx(name)`. Uses `AudioBufferSourceNode` from the Web Audio API (low-latency, from the preloaded buffer cache). Falls back to `new Audio()` only if the buffer is not yet decoded.

| File                   | Trigger                                          |
|------------------------|--------------------------------------------------|
| `sfx/countdown.wav`    | Played immediately when a countdown begins       |
| `sfx/harddrop.wav`     | Played on every hard drop                        |
| `sfx/move.wav`         | Played when a piece moves left or right          |
| `sfx/rotate.wav`       | Played on every rotation (including 180°)        |

### Line-Clear Tone

Every line clear triggers a synthesized piano-like tone via the Web Audio API (no audio file). The function `playLineClearTone(combo, lines, isSpin)` synthesizes two layers simultaneously:

**Melody layer** — a piano-like tone using 4 stacked harmonic oscillators (sine waves at 1×, 2×, 3×, 4× the fundamental frequency) with a fast attack and exponential decay. Higher partials decay faster, approximating a real piano string.

- Combo 0–11: ascending **whole-tone scale** starting at A3 (220 Hz). Each combo step raises the pitch by one whole tone: `freq = 220 × 2^(combo/6)`.
- Combo 12+: the combo number is converted to **binary**, and each bit plays either A6 (1760 Hz, bit=1) or A5 (880 Hz, bit=0), spaced 70ms apart.

**Impact layer** — a pitch-swept bass oscillator that drops rapidly from a start frequency to a deep rumble, giving each clear a physical "thump" feel:

| Clear type       | Start freq | End freq | Decay  | Extra layer       |
|------------------|-----------|----------|--------|-------------------|
| 1–3 lines        | 150 Hz    | 45 Hz    | 150 ms | —                 |
| Quad / Spin      | 220 Hz    | 35 Hz    | 220 ms | Sub-bass at 55 Hz |

Impact amplitude scales with line count: 1-line (×0.3), 2-line (×0.5), 3-line (×0.72), 4-line/quad (×1.2). Spins add an additional ×0.45 on top of their line-count scale. Quads and spins also receive a secondary 55 Hz sub-oscillator for added rumble.

The line-clear tone plays in all game modes: Solo, vs Bot, vs (1v1), Marathon Rooms, and Quick Play.

### Background Music

`startMusic(src)` starts a looping track; `stopMusic()` stops and resets it. Only one track plays at a time. Background music is currently disabled in all game modes.

### Countdown Timing

The `showCountdown` function in `ui.js` uses exported constants from `sound.js` to control visual and audio timing:

| Constant          | Default | Meaning                                               |
|-------------------|---------|-------------------------------------------------------|
| `CD_SFX_LEAD`     | 0 ms    | How early the SFX fires before the "3" appears        |
| `CD_DELAY_3`      | 1000 ms | Duration of the "3" display                           |
| `CD_DELAY_2`      | 1000 ms | Duration of the "2" display                           |
| `CD_DELAY_1`      | 1000 ms | Duration of the "1" display                           |
| `CD_GO_CALLBACK`  | 450 ms  | Delay after "GO!" before the game callback fires      |
| `CD_GO_FADE_DUR`  | 2000 ms | Duration of the "GO!" overlay fade-out                |
| `CD_GO_BLOOM_DUR` | `'3s'`  | CSS duration of the bloom animation on "GO!"          |

The game timer starts only after the countdown callback fires — not during the countdown itself.

---

## 19. Custom Multi-Player Room *(Under Construction)*

> Custom Rooms are currently disabled. The Create and Join entry points are blocked on both the client and server. The specification below describes the intended behavior when the feature is enabled.

### Overview
A host creates a private room for 2–8 players. All players see a waiting-room lobby until the host starts the match.

### Room Flow
1. Host clicks **Create Room** and receives a short room code.
2. Other players enter the code to join and appear in the waiting-room player list.
3. The host clicks **Start** when ready; all clients transition simultaneously to the game screen.

### Piece Sequence
All players draw from the same seeded piece sequence (same seed stored in Firebase at room creation), so every player receives identical bags in identical order.

### Attack & Garbage
Attack and garbage mechanics are identical to 1v1 multiplayer (section 15). Each player's garbage bar shows their incoming queue. Garbage is applied one segment per piece lock.

### Board Layout
Each player sees their own board in the same layout as 1v1 and vs Bot:

```
[Next preview] [Hold] [Board + splashes] [Garbage bar]
```

Miniature opponent boards are displayed alongside the main board, updated from Firebase in real time.

### Win Condition
Last player standing wins. A player is eliminated when they top out.

---

## 20. Settings

All settings persist via `localStorage`.

| Setting              | Location | Description                                                                 |
|----------------------|----------|-----------------------------------------------------------------------------|
| DAS                  | Settings | Delayed auto-shift (0–500ms)                                                |
| ARR                  | Settings | Auto repeat rate (0–200ms)                                                  |
| SDF                  | Settings | Soft drop factor (1–41×)                                                    |
| Keybinds             | Settings | Up to 2 keys per action                                                     |
| Piece Colors         | Settings | Individual color picker per piece                                           |
| Ghost Opacity        | Settings | 0–80%. Default: 30%.                                                        |
| Piece Outline        | Settings | Draws a lighter-colored inner outline around each piece's silhouette (On/Off). Applies to falling, locked, ghost, and preview pieces. Default: On. |
| Attack Splash Text   | Settings | On/Off. When off, attack-sent and garbage-cancel splash text is suppressed. Default: On. |
| Trail Length         | Settings | 0–10. Duration and max entries of the motion blur trail. **0 disables motion blur.** Default: 5. |
| Trail Intensity      | Settings | 0–10. Opacity multiplier for motion blur trail. Default: 5.                 |
| Board Bounciness     | Settings | 0–10. How far the board shifts on piece movement. 0 = disabled. Default: 5. |
| Board Elasticity     | Settings | 1–10. How slowly the board returns to center after a bounce. Default: 8.    |
| Drop Trail Intensity | Settings | 0–10. Opacity of drop trail speed lines on hard drop. **0 disables drop trails.** Default: 5. |
| Disintegrate         | Settings | On/Off. Cleared line cells fan out as fading, brightening particles. **Default: On.** |
| Chromatic Aberration | Settings | On/Off. Splits red/blue channels horizontally with edge-weighted intensity. Default: Off. |
| Chromatic Intensity  | Settings | 1–10. Controls the maximum channel offset at board edges. Default: 5.       |
| Grid Lines           | Settings | On/Off with width (0.5–3px) and color picker                                |
| Color Shift          | Settings | On/Off + BPM (30–500). Cycles piece colors on each tick.                    |
| Limbo                | Settings | On/Off + BPM (30–500). Shuffles preview display order on each tick.         |
| Drunk                | Settings | On/Off + BPM (30–500). Shifts board canvas horizontally on each tick.       |
| Circles              | Settings | On/Off + BPM (30–500). Applies circular orbit motion to board and piece.    |
| Apply BPM to all     | Settings | Sets Color Shift, Limbo, Drunk, and Circles BPM to a single value at once.  |
| Acid                 | Settings | On/Off toggle. Applies wave distortion + phosphor persistence to the board. |
| Acid Meter           | Settings | 1–10. Controls distortion strength, persistence fade rate, and overlay opacity. |
| Gravity Type         | Setup    | Leveled or Static                                                           |
| Static Speed         | Setup    | Speed multiplier for Static gravity (0.1–20×)                               |
| Kick System          | Setup ★  | SRS or None. Non-standard setting; affects ranked records.                  |
| Preview Count        | Setup    | 0–7 pieces shown (solo)                                                     |
| Hold Mode            | Setup ★  | Normal / Infinite / None. Non-standard if not Normal.                       |
| Board Width          | Setup ★  | 4–20 columns (range slider). Standard: 10. Affects ranked records.          |
| Board Height         | Setup ★  | 4–100 rows (range slider). Standard: 20. Affects ranked records.            |
| Overhang             | Setup    | Visible only when board width = 4. On/Off. Pre-fills bottom-right cells for 4-wide combo setup. Locked On in Combo Race. |
| Invisible Lock       | Setup    | Locked pieces become invisible                                              |
| Practice Mode        | Setup ★  | Enables in-game settings drawer and undo/redo. Disables ranked records.     |

### Practice Mode
When enabled:
- ⚙ button opens a live settings drawer (pauses the game)
- **Cmd/Ctrl+Z**: undo last piece placement (up to 60 states)
- **Cmd/Ctrl+Y**: redo

---

## 21. Stats

Only personal bests are saved (one record per sub-mode).

| Mode        | Sub-modes      | Metric       |
|-------------|----------------|--------------|
| Sprint      | 20L, 40L, 100L | Time (ms)    |
| Blitz       | 30s, 1m, 2m    | Lines sent   |
| Combo Race  | 30s (fixed)    | Max combo    |

Stats are displayed in a table showing all sub-modes side by side. Clearing stats removes all locally saved records.

### Cloud Sync
When signed in to an account (see section 19), personal bests are synced to Firebase:
- A new PB is uploaded immediately when it is set.
- On sign-in, cloud PBs are merged with local records — the better value for each sub-mode wins.
- Local PBs that are better than the cloud copy are uploaded during the merge.
- This enables PBs to persist and sync across devices.

---

## 22. Account System

### Overview
Players can create an account with an email and password. Accounts enable cross-device personal best sync and a persistent identity.

### Registration *(Currently Unavailable)*
Account creation is temporarily disabled. The "Create Account" button is shown but disabled in the UI, and the sign-up endpoints remain blocked. Sign-in for existing accounts continues to work normally.

When registration reopens:
- Requires a valid email address and a 6-digit verification code sent to that address.
- On account creation, a **random username** is automatically assigned in the format `AdjectiveNoun####` (e.g. `SwiftFalcon3847`).
- Usernames can be changed at any time from the Account screen.

### Sign In / Sign Out
- Email and password authentication via Firebase Auth.
- Sessions persist across page loads — the player remains signed in until they explicitly sign out.

### Account Screen
Accessible from the main menu or the Stats screen. The screen has two states:

**Guest (not signed in):**
- Email and password fields
- "Sign In" button; "Create Account" is disabled with a "temporarily unavailable" notice
- Error messages shown inline on failure

**Signed in:**
- Displays the player's username and email
- **Change Username**: text field pre-filled with the current username; saved on click
- **Delete Data**: removes all cloud PBs and clears local stats (with confirmation prompt)
- **Delete Account**: permanently deletes the account and all associated data (with confirmation prompt; requires recent login)
- **Sign Out** button

### Stats Screen Integration
The Stats screen shows a status bar indicating whether the player is signed in (displaying the username) or not. A button links directly to the Account screen.

---

## 23. Replay System

### Overview
Solo games (all modes) are recorded as they are played. On game over or sprint completion, a **Save Replay** button appears in the result overlay. Clicking it downloads a timestamped `.json` file.

### Recording
- **Action-level**: each player input (move left/right, rotate CW/CCW/180, hard drop, soft drop, hold) is stored with a timestamp in milliseconds relative to `gameStartMs`.
- **Piece sequence**: every piece dequeued is appended to a `pieces` array, ensuring deterministic playback.
- **Settings snapshot**: all settings that affect gameplay are embedded — `gravMode`, `gravStatic`, `das`, `arr`, `sdf`, `kicks`, `holdMode`, `previewCount`, `boardWidth`, `boardHeight`, `overhang` — so the replay is fully self-contained and plays back correctly regardless of the player's current setup.

### File Format (version 1)
```json
{
  "version": 1,
  "mode": "sprint",
  "subMode": "40",
  "settings": { "gravMode": "leveled", "kicks": "srs", ... },
  "pieces": ["T", "I", "O", ...],
  "events": [
    { "t": 320, "a": "moveL" },
    { "t": 480, "a": "rotCW" }
  ],
  "result": { "time": 58321, "lines": 40 }
}
```

### Loading a Replay
Drag and drop a replay `.json` file onto the game window. An overlay reads **"DROP TO REPLAY"** while dragging. On drop, the board shows a **"REPLAY LOADED"** overlay. Press Hard Drop to begin playback.

### Playback
- The replay's embedded settings are applied for the duration of playback (original settings are restored after).
- The saved piece sequence is fed deterministically, bypassing the live 7-bag generator.
- Events fire via `setTimeout` at their original recorded timestamps.
- All player input is ignored during replay.
- A **REPLAY** badge appears in the top-right of the board during playback.
- If the replay has been verified (see below), a green **✓ VERIFIED** badge appears alongside the REPLAY badge.
- On completion, a **"REPLAY DONE"** overlay is shown.

### Replay Verification
After a game ends, the result overlay offers two download options:

- **Save Replay** — downloads the replay as a `.json` file immediately (no server call). Available to all players.
- **Verify & Save** — **requires a signed-in account.** Submits the replay's deterministic content (`version`, `mode`, `subMode`, `settings`, `pieces`, `events`, `result`) to the server, which computes a SHA-256 hash using stable (sorted-key) JSON serialization and stores `{ hash, date }` under a randomly generated 12-character hex replay ID in Firebase (`replays/{id}`). The server returns `{ id, hash }`. Only the `id` is embedded into the replay file as `verified: { id }` — the hash is kept server-side only (including the hash in the file would be meaningless since anyone editing the file could recompute it). The downloaded file is suffixed with `_verified.json`.

If the player is logged in and their username is available, it is embedded in the replay file as a `creator` field (excluded from the hash).

#### Playback Verification
When a verified replay is loaded (contains `verified.id`), the badge sequence is:

1. **VERIFYING…** (grey) — shown immediately while the server is queried.
2. The client computes the SHA-256 hash of the replay's deterministic fields locally (identical `stableStringify` implementation) and fetches the stored hash from `GET /api/replay/:id`.
3. If the hashes match: badge updates to **✓ VERIFIED** (green).
4. If the hashes differ: badge updates to **✗ TAMPERED** (red).
5. If the server is unreachable or the ID is not found: badge is hidden.

### Speed Utility
`random/speed_replay.py` accepts a replay `.json` file and a speed factor, dividing all event timestamps and `result.time` by the factor to produce a sped-up or slowed-down replay file. Output is written to `{basename}_x{factor}.json`.

---

## 24. Sound Settings

Volume controls are in a dedicated **Sound** section of the Settings screen.

| Setting      | Range  | Default | Description                                                              |
|--------------|--------|---------|--------------------------------------------------------------------------|
| SFX Volume   | 0–100% | 100%    | Volume applied to all one-shot SFX and to synthesized line-clear tones at playback time. |
| Music Volume | 0–100% | 80%     | Volume applied to background music. Updates the live track immediately when changed. Background music is currently disabled. |

Both values persist via `localStorage`. The music volume slider calls `setMusicVolume()` in `sound.js` to update the currently playing `_bgm` track in real time without restarting it.

---

## 25. Technical Notes

- **Framework**: Vanilla HTML/JS, no build step
- **Rendering**: HTML5 Canvas (2D context)
- **Multiplayer backend**: Firebase Realtime Database
- **Authentication**: Firebase Authentication (email/password)
- **Piece rotation**: explicit state tables (no matrix math)
- **Font**: DM Mono (body), Space Mono (headers/numbers)
- **Lock delay**: 1000ms with 15-move reset cap
- **Tick rate**: `requestAnimationFrame` (~60fps)
- **Grid**: configurable (standard 10×20), cell size 20px (solo), 28px (VS)
- **Browser support**: Chrome-based browsers recommended (Chrome, Edge, Brave, Arc, Opera, Vivaldi). A dismissable warning banner is shown on first load in non-Chrome browsers. Dismissal is persisted to `localStorage`.
