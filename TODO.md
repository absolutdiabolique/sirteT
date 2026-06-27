# sirtetT — Feature Backlog

Items are ordered by impact-to-effort ratio. Things near the top make the game meaningfully better for the most players.

---

## Recently Completed

- [x] **Sound effects** — move, rotate, hard drop, countdown, line-clear (with per-combo pitch shift: +1 full tone per combo, capped at 16 tones, via Web Audio API).
- [x] **Music** — background loop (`aperture.wav`) starts at GO! and stops on game over. Volume slider in Settings.
- [x] **Replays** — full action-level recording (inputs + piece sequence + settings snapshot). Drag-and-drop `.json` to load; hard drop to begin playback. Save Replay button on result screen.
- [x] **Replay verification** — "Verify & Save" button POSTs deterministic replay content to the server, which SHA-256 hashes it and stores a 12-char hex ID in Firebase. The verified file embeds `{ id, hash }`. Playing a verified replay shows a green **✓ VERIFIED** badge.
- [x] **Disintegrate effect** — cleared line cells fan out as fading, brightening particles. On by default. Intensity fades with power-decay curve; cells slowly bloom to white.
- [x] **Chromatic aberration** — per-pixel red/blue channel split, edge-weighted (strongest at board edges, near-zero at center). Intensity slider 1–10.
- [x] **Configurable board size** — width 4–20 (slider), height 4–100 (slider). Standard 10×20 marked with red asterisk; non-standard disables ranked scoring.
- [x] **Combo Race mode** — fixed 4-wide × 20-tall board, overhang enabled, 30-second countdown. Objective: highest combo. Personal best saved to Stats screen.
- [x] **Overhang setting** — appears when board width = 4. Pre-fills bottom-right cells (Z-piece color) to bootstrap 4-wide combo chains. Locked on in Combo Race.
- [x] **Attack splash stacking fix** — attack numbers only stack when the player is in an active combo (≥2 consecutive clears) AND the new attack arrives within 1 second of the previous splash.
- [x] **Acid effect** — wave distortion + phosphor persistence applied to the board canvas. Acid Meter (1–10) controls strength, fade rate, and overlay opacity.
- [x] **Motion blur trail** — ghost images follow the active piece. Trail length/intensity sliders; 0 = off (no separate toggle). Hard drops produce a full-column streak.
- [x] **Board bounce** — board shifts on piece movement with exponential decay. Bounciness and Elasticity sliders.
- [x] **Drop trails** — speed lines on hard drop. Intensity slider; 0 = off.
- [x] **Piece outline** — lighter inner outline on all pieces. On by default.
- [x] **Four "stupid mode" effects** — Color Shift, Limbo, Drunk, Circles, each with independent On/Off + BPM clock.

---

## High Priority

- [ ] **Post-game stats screen** — show APM, PPS, finesse faults, T-spin count, B2B count, attack sent after each game ends instead of just score/lines.
- [ ] **Public leaderboards** — global top-10 for each sprint/blitz/combo-race category. Currently PBs are uploaded but never shown to others.
- [ ] **In-game APM / PPS display** — live attack-per-minute and pieces-per-second counters visible during play, not just post-game.

---

## Medium Priority

- [ ] **Friends system** — add friends by username, see their PBs inline on the leaderboard, challenge them to a private room directly.
- [ ] **ELO / rating ladder** — give the ranked quick-play queue a visible MMR number so players have a concrete goal to climb.
- [ ] **More practice sub-modes** — dedicated modes for: T-spin setups, perfect-clear hunting, cheese-race (clear a garbage stack), 20G survival.
- [ ] **Mobile / touch controls** — swipe left/right to move, swipe down to soft-drop, tap to rotate, swipe up to hard drop. Expands the audience significantly.
- [ ] **Daily challenge** — a fixed seed sprint or puzzle that resets at midnight; everyone gets the same board.
- [ ] **Chat in multiplayer** — a small text input in the room lobby and a few preset taunts/GGs during play.

---

## Lower Priority

- [ ] **Colorblind / high-contrast mode** — alternative piece color palette that works for deuteranopia and protanopia.
- [ ] **Spectator improvements** — let a spectator watch any ongoing quick-play or room game by sharing a link, with a small delay to prevent cheating.
- [ ] **More stupid effects** — ideas: gravity flip (board flips upside down on a tick), mirror (board reflected horizontally), invisible falling (piece disappears mid-fall), chaos bag (random piece draw instead of 7-bag).
- [ ] **Opener trainer** — a guided mode that teaches common openers (T-spin double setup, S/Z stacking, DT cannon) with step-by-step hints.
- [ ] **Tournament bracket** — a host can set up a 4/8-player single or double-elimination bracket inside a custom room.
- [ ] **Per-game history graph** — a small sparkline of PB progression over time on the stats page.
- [ ] **Keybind profiles** — save and switch between multiple keybind presets (e.g. one for 60% keyboard, one for full-size).
- [ ] **Bot difficulty expansion** — add an "adaptive" bot that targets a PPS slightly above the player's current average to stay challenging.
