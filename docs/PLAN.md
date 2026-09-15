# NEON ROADS — Design & Build Plan
A SkyRoads-inspired web game (original name; no original assets, level data, names or art are reused)

## Confirmed decisions
- **Name:** Neon Roads
- **Visual style:** neon-retro (flat-shaded geometry with glow, bloom, shader skies)
- **Extras in v1:** medals, ghost replays, Endless mode and Daily Run
- **Controls:** keyboard, gamepad and touch
- **Added mid-build:** use a phone as a wireless controller (serverless WebRTC, see §6)
- **Out of v1 scope:** new tile mechanics (jump pads, crumbling, moving blocks, gravity flip, warp, crystals, checkpoints) and the level editor. Section 2 still lists them as future ideas.

---

## 1. What the original was (from the full playthrough + research)

### Core loop
- A hover-car rides a floating **road made of a grid 7 lanes wide**, suspended in space.
- Controls: **Left/Right** steer, **Up/Down** accelerate/brake (the speed persists), **Space** to jump.
- Goal: reach the end of the road. Each world has 3 roads; 10 worlds = 30 roads; any unlocked road can be picked from a grid menu.
- Unlimited retries: dying restarts the road from the beginning.

### Road geometry (confirmed by video + level-format docs)
Each road cell is made of stacked parts:
- a **floor tile** (or empty = gap)
- a **half-height block** or **full-height block** on top (a wall you can land on or crash into)
- a **tunnel** (half-pipe you drive through; its curved roof is also a surface)
- flat-topped pipes (tunnel + block combined)

### Tile effects (colour-coded)
| Tile | Effect |
|---|---|
| Burning | explode on contact |
| Supplies | refill oxygen + fuel |
| Boost | sudden acceleration |
| Sticky | fast deceleration |
| Slippery | no steering |

### Resources and pressure
- **Oxygen**: drains with time, so it acts as a hidden timer. Some roads drain it faster.
- **Fuel**: drains with distance and speed.
- **Gravity** (100 to 1700) is set per road: floaty "moon jumps" at one end, almost no jump at the other.
- **Jump-O-Master**: an automatic jump that fires just before you drive off an edge (HUD shows IDLE / IN USE).

### Ways to die
Drive head-on into a wall at speed, fall off the road, touch a burning tile, or run out of O2 or fuel.

### Presentation
- Chase camera behind the car, with a cockpit dashboard frame covering the bottom third.
- Dashboard gauges: gravity number, O2 and fuel rings, speed bar, jump-assist status, road progress.
- A painted space backdrop per world (sun, planet, asteroid field, space station, Earth, moon city, wormhole, nebula).
- Flat-shaded polygons in bold per-road palettes; the whole road's colours change per level.
- "Road Completed" text, then a fade; the menu marks progress per road.
- Tracker music.

### Why it worked
1. **Instantly readable**: 5 inputs, one goal, and colour tells you the rules.
2. **Deep through combinations**: gravity × O2 × fuel × tile mix × geometry make each road a distinct puzzle (a sprint road, a precision road, a resource road, a reflex road).
3. **Fast retry loop** with short roads (30 to 90 s), so "one more try" is easy.
4. **Pseudo-3D speed** at a time when that was rare; strong sense of flow.
5. **Shareware distribution** plus a free level pack (the X-Mas Special) kept it alive.
6. Great music that kept frustration low across many retries.

### Documented weaknesses we will fix
- No score, no reward beyond a finish mark, and a flat "The End".
- Colour-only tile coding is hard for colour-blind players.
- Keyboard feel is too binary; no analog input.
- Difficulty spikes, and no way to practise a hard section.
- Level design is repetitive (flat, straight lines only).

---

## 2. Vision: "Everything it had, plus more"

A modern, **neon-retro** take: crisp flat-shaded geometry with glowing edges, bloom, speed lines and particles, living procedural skies, and a synth soundtrack. Tight, deterministic, frame-perfect controls.

### Keep (1:1 feature parity)
- 7-lane grid road; floor, half block, full block, tunnel and flat-top tunnel
- All 5 tile effects
- O2, fuel and gravity per road
- Jump assist
- All death conditions
- 10 worlds × 3 roads, a world select grid and per-road completion marks
- Chase camera and a dashboard HUD
- Unlimited lives with instant restart

### Add (the "more")
**Gameplay**
- New tile and hazard types (used sparingly and introduced gradually):
  - Jump pad
  - Crumbling tile
  - Moving and phasing blocks
  - Gravity-flip zone
  - Warp gate
  - Checkpoint gate (practice mode only)
  - Supply crystals (collectibles)
- **Scoring and medals**: time, O2/fuel remaining and crystals give Bronze / Silver / Gold / "Ace" per road.
- **Ghost replays**: race against your best run. Deterministic fixed-step physics makes this cheap: record inputs, replay them.
- **Practice mode**: checkpoints and a slow-mo toggle. Medals are disabled in this mode.
- **Endless / Daily Run**: a procedurally generated road from a seed, with a difficulty ramp and a high score.
- **Level editor**: paint cells in a top-down grid, test instantly, and share a road as a URL.

**Feel**
- Analog steering with gamepad support.
- Coyote time and jump buffering (small, tunable).
- Camera FOV kick at speed, landing squash, screen shake on crash.
- A shattering-shard explosion.

**Presentation**
- Procedural skyboxes per world (shader nebulae, planets, star fields).
- Emissive tile edges and bloom.
- A modern minimal HUD, plus an optional retro cockpit dashboard mode.

**Accessibility**
- Tile **icons/patterns** in addition to colour, and a colour-blind palette.
- Remappable keys, reduced motion, and volume sliders.

**Audio**
- A procedural WebAudio synthwave soundtrack (one theme per world).
- Synthesised sound effects (engine hum tied to speed, jump, land, boost, crash, pickup).
- No external audio files needed.

**Platforms**
- Desktop keyboard and gamepad, plus mobile touch controls.
- Progress saved in localStorage.

---

## 3. Technical architecture

- **Stack**: Vite + TypeScript + three.js (npm). Post-processing uses three's EffectComposer and UnrealBloomPass. No physics engine; grid collision is custom and deterministic.
- **Loop**: fixed 120 Hz simulation step with interpolated rendering. Input is sampled per step, which makes replays deterministic.

```
src/
  main.ts                 boot, router between screens
  core/
    loop.ts               fixed-step loop + interpolation
    input.ts              keyboard / gamepad / touch -> InputFrame
    rng.ts                seeded RNG
    save.ts               localStorage progress, settings, ghosts
  sim/                    PURE logic, no three.js; unit-testable
    types.ts              Cell, Road, TileType, BlockType
    physics.ts            ship integration, gravity, jump, speed
    collision.ts          grid sampling: floor height, walls, tunnels
    tiles.ts              tile effects
    resources.ts          O2 / fuel
    ship.ts               state machine: alive, airborne, dead, finished
    replay.ts             input recording / playback
  levels/
    format.ts             compact text DSL <-> Road, URL share encoding
    worlds.ts             10 worlds: palette, sky, music theme, 3 roads
    roads/*.ts            handcrafted original roads
    procedural.ts         endless / daily generator (chunk grammar)
  render/
    roadMesh.ts           merged / instanced geometry per chunk, edge glow
    shipMesh.ts           procedural low-poly hover ship + thruster FX
    sky.ts                shader skybox per world
    fx.ts                 particles, explosion shards, speed lines
    camera.ts             chase cam, FOV kick, shake
    post.ts               bloom, vignette, optional CRT/retro filter
  audio/
    synth.ts              WebAudio sound effects
    music.ts              procedural sequencer: patterns per world
  ui/                     HTML/CSS overlay screens
    title, worldSelect, hud, pause, results, settings, editor
  editor/
    editor.ts             grid painter, playtest, share link
tests/                    vitest for sim + level format
```

### Road data model
- `Road = { name, gravity, oxygen, fuel, o2Drain, palette, rows: Cell[7][] }`
- `Cell = { floor?: Tile, block?: 'half' | 'full', blockTile?: Tile, tunnel?: boolean, special?: ... }`
- Author roads in a readable ASCII DSL (one line = one row, 7 cells, with a legend). This keeps 30 roads fast to write, easy to diff, and shareable as compressed base64 in a URL.

### Physics (tuned for the classic feel)
- Forward speed is between 0 and vMax. Up and down change acceleration, and speed persists.
- Lateral speed comes from steering and uses a responsive curve. Slippery tiles lock it.
- Vertical motion uses gravity g (from the road's 100 to 1700 scale). Jump velocity is constant, so jump height ∝ 1/g.
- Collision samples the grid at the ship's AABB:
  - Floor height is max(floor, block top, tunnel roof curve).
  - Frontal wall hit above a speed threshold kills; below it, the ship bumps and stops.
  - Side walls stop lateral motion.
  - Tunnel interiors are passable; tunnel side walls collide.
- Falling below the kill plane counts as death.

---

## 4. Level design plan (all original)
Ten worlds, each with a theme, a sky, a music theme and a signature mechanic introduced in its roads:

| # | World (working name) | Gravity | Signature |
|---|---|---|---|
| 1 | Launch Ring | normal | basics: steer, gaps, blocks |
| 2 | Solar Forge | normal | burning tiles, supply management |
| 3 | Glass Moon | low (floaty) | long jumps, tunnels |
| 4 | Ion Drift | normal | slippery + boost corridors |
| 5 | Tar Nebula | heavy | sticky tiles, precise short hops |
| 6 | Orbital Yard | varies | jump pads, stacked blocks, flat-top pipes |
| 7 | Shatterfield | normal | crumbling tiles, speed pressure (fast O2) |
| 8 | Phase Station | normal | moving / phasing blocks |
| 9 | Event Horizon | flips | gravity-flip zones, warp gates |
| 10 | Core | extreme | everything, resource-starved finale |

- A secret 11th world unlocks with all Golds.
- Each world has 3 roads: (1) teach, (2) combine, (3) test.

---

## 5. Milestones (build order)
1. **Scaffold**: Vite/TS/three, loop, input, a test road rendered, chase camera.
2. **Core sim**: movement, jump, gravity, grid collision, blocks, tunnels, gaps, death, finish, restart. Vitest coverage for the sim.
3. **Tiles and resources**: 5 classic tiles, O2/fuel, jump assist, HUD.
4. **Juice**: ship model, thrusters, explosion, bloom, sky shaders, camera FX.
5. **Audio**: synth SFX and a procedural music sequencer.
6. **Game shell**: title, world select, pause, results with medals, save progress, settings.
7. **New mechanics**: jump pads, crumbling, moving/phasing, gravity flip, warp, crystals, checkpoints.
8. **Content**: 30 roads plus the secret world.
9. **Replays and ghosts**, practice mode.
10. **Endless / Daily** procedural mode.
11. **Level editor** plus share links.
12. **Mobile touch controls**, accessibility pass, performance pass, and a playtest balancing pass.

**Verification**: vitest for the sim/format; Playwright headless runs for screenshots of each screen; scripted "bot" input replays to confirm each road is completable (a solution replay per road).

---

## 6. Phone as controller (added scope)
**Goal:** a phone on the same local network acts as a zero-install gamepad, similar to AirConsole, with no backend we host.

**Transport**
- PeerJS (WebRTC DataChannels). The free public PeerJS broker is used only for the initial handshake.
- After that, all traffic is peer-to-peer and stays on the local network (direct host ICE candidates).
- The broker can be swapped for a self-hosted PeerServer via `VITE_PEER_HOST`/`VITE_PEER_PORT`.

**Channels**
- `input`: unreliable and unordered. Carries compact binary frames (steer, throttle, buttons, seq), sent on every change plus a 30 Hz heartbeat.
- `ctl`: reliable. Carries JSON events: pause, restart, ghost toggle, menu navigation, ping/pong. Game→phone messages go here too: screen mode (menu/game) and haptics (jump/land/boost/crash/finish).

**Pairing**
- The game creates a peer `neonroads-<CODE>` and shows a QR code of `<origin>/controller.html#<CODE>`, plus the code in text.
- In dev, the LAN origin is detected by Vite so a phone can reach the laptop.
- The phone connects automatically, or the user can type the code by hand.

**Phone UI**
- Landscape, full screen, and kept awake with the Wake Lock API.
- Game mode:
  - Left pad: drag to steer; up/down for throttle.
  - Optional tilt steering.
  - "Cruise" auto-throttle toggle.
  - Big JUMP button.
  - Restart and pause buttons.
- Menu mode: D-pad plus A/B.
- Status bar with a ping readout. Haptics via `navigator.vibrate` where supported.

**Game integration**
- The remote source is merged in `Input.poll` like touch.
- Menu events feed the same spatial navigation as keyboard and gamepad.
- A connection toast and a controller badge on the title screen.


---

## 7. Build status (v1)
All milestones in scope are implemented:

- [x] Deterministic 120 Hz simulation: grid collision, blocks, tunnels, 5 tile types, O₂/fuel/gravity, jump assist. Unit tested.
- [x] Boost overdrive (above top speed) and viscous sticky tar, added during balancing.
- [x] 10 worlds × 3 original roads. A beam-search solver proves each one can be finished without assist and generates the par times (`src/levels/pars.json`).
- [x] Neon renderer: chunk-streamed road meshes with glowing edges, animated tile patterns, per-world shader skies, bloom and chromatic aberration, props, particles, explosion, speed lines.
- [x] HUD, title screen, campaign grid with progress, pause, results with medals, settings, how-to-play.
- [x] Medals (Bronze/Silver/Gold/Neon) and ghost replays (encoded input tapes in localStorage).
- [x] Endless and Daily Run procedural modes. Generator windows are checked by the solver.
- [x] Keyboard (analog ramp), gamepad, touch overlay.
- [x] Phone controller over PeerJS/WebRTC. Tested end to end with Playwright on real Chrome.
- [x] Procedural music per world and synthesized SFX.

- [x] Holographic ghost ship: hologram shader, wireframe edges, best-time label, proximity fade, assist-synced replays, toggle via G, pause, settings and phone.
- [x] Victory celebration: fireworks and an orbiting camera at the finish gate, continuing behind the results screen.
- [x] Share on X: ASCII scorecard copied to the clipboard plus a pre-filled post with time, medal, fuel, O₂ and the game URL.

Deferred ideas: new tile mechanics (jump pads, crumbling, moving blocks, gravity flip, warp), level editor with share links, key remapping UI.
