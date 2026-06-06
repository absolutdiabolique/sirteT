# sirteT — Game Specification

---

## 1. Overview

sirteT is a falling-block puzzle game. Pieces (tetrominoes) fall from the top of a 10×20 grid. Players rotate and position pieces to complete horizontal lines, which are cleared and scored. The game includes solo modes, a vs-bot mode, a 1v1 multiplayer mode, an account system for cross-device stats, and a settings system.

---

## 2. Board & Pieces

### Board
- 10 columns × 20 visible rows
- Hidden buffer rows above row 0 (pieces spawn there)
- Cells are either empty or hold a color value

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

### vs Bot
Player competes against a local AI opponent. See section 14.

### 1v1 Multiplayer
Real-time match against another player over Firebase. See section 15.

### Quick Play
Always-open ranked free-for-all over Firebase. See section 16.

---

## 9. Ranked Play

Sprint and Blitz results are saved to records only when played with **standard settings**:
- Gravity: Leveled
- Kicks: SRS
- Hold: Normal (once per piece)
- Practice Mode: Off

Settings that affect ranking show a red **\*** marker in the Setup screen. If non-standard settings are active, a warning is shown and results are not saved.

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
- Clears within **1000ms** of the previous clear stack: the number increments in place
- Fades out after 1800ms

---

## 14. vs Bot

### Overview
The player competes against a local AI bot on two side-by-side boards. The match ends when either player tops out.

### Bot AI — Diver Down
The single available AI is **Diver Down**. It plays optimally using a multi-phase evaluation engine.

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

## 15. Multiplayer (1v1)

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
Quick Play is an always-open, ranked free-for-all mode played over Firebase. There is no room code or waiting lobby — joining puts the player immediately into the live game. Any number of players can be in the same session simultaneously, and new players can join at any time while others are already playing. **Requires a signed-in account.**

### Session Structure
- A single shared session exists globally at all times (`quickplay/players/` in Firebase).
- Each player writes their own state to `quickplay/players/{uid}`. Entries older than 30 seconds are considered stale and are ignored by other clients.
- Player entries are removed from Firebase on leave (`onDisconnect().remove()` ensures cleanup on browser crash or disconnect).

### Scoring
Score is a floating-point value that increases through four mechanisms:

| Source | Points |
|---|---|
| Passive (time) | +0.1 per second |
| Regular line cleared | +1.0 |
| Garbage line cleared | +0.5 |
| KO (opponent tops out due to your garbage) | +15 |

There is no cap on score. Gravity uses the standard leveled formula (same as Marathon).

### Attack Targeting
When a player generates an attack (garbage lines), those lines are sent to a single target determined by score ranking:

- **Normal case**: attack goes to the player with the score **immediately above** yours.
- **Highest score**: if you have the top score, attack goes to the player **immediately below** you.
- **No valid target** (you are the only active player, or all others are dead/stale): attack goes nowhere.

Attack entries are written to `quickplay/attacks/{targetUid}/` (any authenticated user may write; only the target may read). Targets consume and remove each entry as they receive it.

### Garbage Application
Incoming garbage is queued and applied on each piece lock (one segment per lock), identical to the 1v1 multiplayer mechanic. No cancellation — incoming garbage cannot be offset by outgoing attack.

### KO Detection
When a player tops out, they write `killedBy: {uid}` to their own Firebase entry. All active clients monitor all player entries; upon seeing a `killedBy` equal to their own uid for a newly dead player, they award themselves +15 points. Each KO is tracked locally to prevent double-counting.

### Board Layout
The Quick Play screen has three columns:

```
[Sidebar] [Next preview | Hold | Board + splashes | Garbage bar] [Players panel]
```

- The **sidebar** (left) shows the mode label, current score, and the current target's username.
- The **board area** (center) is the same layout as vs Bot / 1v1: preview, hold, board with splashes, and a garbage bar.
- The **players panel** (right, 160px) lists all active players sorted by score descending. Dead players are faded. The current target has a red left border.

### Death
When a player tops out, an overlay appears on their board showing "YOU DIED" and their final score. The Firebase entry is updated with `alive: false` and `killedBy`. The player can leave using the Leave button; the loop continues rendering the frozen board in the background so they can watch the panel.

---

## 17. Settings

All settings persist via `localStorage`.

| Setting         | Location | Description                                       |
|-----------------|----------|---------------------------------------------------|
| DAS             | Settings | Delayed auto-shift (0–500ms)                      |
| ARR             | Settings | Auto repeat rate (0–200ms)                        |
| SDF             | Settings | Soft drop factor (1–41×)                          |
| Keybinds        | Settings | Up to 2 keys per action                           |
| Piece Colors    | Settings | Individual color picker per piece                 |
| Gravity Type    | Setup    | Leveled or Static                                 |
| Static Speed    | Setup    | Speed multiplier for Static gravity (0.1–20×)     |
| Kick System     | Setup    | SRS or None                                       |
| Preview Count   | Setup    | 0–7 pieces shown (solo)                           |
| Hold Mode       | Setup    | Normal / Infinite / None                          |
| Ghost Opacity   | Setup    | 0–80%                                             |
| Grid Lines      | Setup    | On/Off with width (0.5–3px) and color picker      |
| Invisible Lock  | Setup    | Locked pieces become invisible                    |
| Practice Mode   | Setup    | Enables in-game settings drawer and undo/redo     |

### Practice Mode
When enabled:
- ⚙ button opens a live settings drawer (pauses the game)
- **Cmd/Ctrl+Z**: undo last piece placement (up to 60 states)
- **Cmd/Ctrl+Y**: redo

---

## 18. Stats

Only personal bests are saved (one record per sub-mode).

| Mode   | Sub-modes        | Metric     |
|--------|------------------|------------|
| Sprint | 20L, 40L, 100L   | Time (ms)  |
| Blitz  | 30s, 1m, 2m      | Lines sent |

Stats are displayed in a table showing all sub-modes side by side. Clearing stats removes all locally saved records.

### Cloud Sync
When signed in to an account (see section 19), personal bests are synced to Firebase:
- A new PB is uploaded immediately when it is set.
- On sign-in, cloud PBs are merged with local records — the better value for each sub-mode wins.
- Local PBs that are better than the cloud copy are uploaded during the merge.
- This enables PBs to persist and sync across devices.

---

## 19. Account System

### Overview
Players can create an account with an email and password. Accounts enable cross-device personal best sync and a persistent identity.

### Registration
- Requires a valid email address and password.
- On account creation, a **random username** is automatically assigned in the format `AdjectiveNoun####` (e.g. `SwiftFalcon3847`).
- Usernames can be changed at any time from the Account screen.

### Sign In / Sign Out
- Email and password authentication via Firebase Auth.
- Sessions persist across page loads — the player remains signed in until they explicitly sign out.

### Account Screen
Accessible from the main menu or the Stats screen. The screen has two states:

**Guest (not signed in):**
- Email and password fields
- "Sign In" and "Create Account" buttons
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

## 20. Technical Notes

- **Framework**: Vanilla HTML/JS, no build step
- **Rendering**: HTML5 Canvas (2D context)
- **Multiplayer backend**: Firebase Realtime Database
- **Authentication**: Firebase Authentication (email/password)
- **Piece rotation**: explicit state tables (no matrix math)
- **Font**: DM Mono (body), Space Mono (headers/numbers)
- **Lock delay**: 1000ms with 15-move reset cap
- **Tick rate**: `requestAnimationFrame` (~60fps)
- **Grid**: 10×20, cell size 20px (solo), 28px (VS)
