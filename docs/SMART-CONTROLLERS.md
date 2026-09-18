# Building smart controllers

Notes from building two camera controllers in this repo: the **wand** (`src/wand/`), a printed
two-colour marker on a stick, and the **hand controller** (`src/hand/`), bare-handed MediaPipe
landmark tracking. Both drive a 120 Hz deterministic game.

§13 was written as a prediction before the second controller existed, then rewritten with what
actually happened. Where the two differ is marked.

This is written for whoever builds the next one — hand tracking, pose, face, voice, phone IMU.
It is a playbook, not a retrospective. Most of it is about the parts that are *not* the clever
signal processing, because those are the parts that decided whether the thing shipped.

**Read `docs/PLAN.md` for the game's architecture first.** This document assumes it.

---

## 1. The shape that worked

Split the controller into a **pure core** and a **thin imperative shell**. Non-negotiable: it is
what makes the whole thing testable without a camera, and what let the tracker be debugged in
milliseconds instead of by waving objects at a laptop.

```
src/wand/
  tracker.ts     pure   pixels            -> blobs          (no DOM, no state)
  calibrate.ts   pure   pixels + a box    -> a colour model
  filter.ts      pure   samples + dt      -> smoothed, gestures
  mapping.ts     pure   pose + dt         -> InputFrame     (stateful, but no DOM)
  wandInput.ts   shell  getUserMedia, video element, canvas readback, the frame loop
src/ui/wand.ts   shell  setup screen, calibration flow, live diagnostics
```

The rule: **if it can be a function of `(pixels, numbers)`, it must be.** The shell should
contain nothing you would want to set a breakpoint in. In the wand, the shell is ~20% of the
logic and 100% of the bugs found during review (see §10).

The core's output is a single `InputFrame { steer, throttle, jump }` — the same struct the
keyboard produces. Everything downstream stays unaware a camera exists.

---

## 2. Do the design review before writing code

The first version of any gesture controller is a list of gestures that sound good. Most of them
are wrong for reasons you can work out on paper in twenty minutes. Force this pass.

For each control the game needs, ask:

1. **What is the cheapest signal that carries it?** Prefer signals that survive degradation.
   A blurred magenta smear is still magenta; a blurred fiducial marker has no corners. That one
   observation is why this controller uses colour blobs and not ArUco, despite ArUco giving
   strictly more information when it works.
2. **How noisy is it, really?** Rank your candidate signals honestly. For a monocular camera:
   angle between two tracked points ≫ position ≫ distance-from-separation ≫ distance-from-area.
   Depth from a single blob's area is the worst signal in the set: it swings with partial
   occlusion and with any tilt away from the camera. Two tracked points instead of one upgraded
   depth *and* handed us tilt for free.

   **Prefer a relation between two points over either point's position.** This came up twice,
   independently, and both times it was the decision that made the controller feel solid. The
   wand steers on the angle between its two discs; the hand controller steers on the angle
   between the two palms. A relation is *self-correcting*: shift in your seat, lean, or let your
   arm wander, and both points move together so the control does not budge. Absolute position has
   no such property — it drifts, and the calibrated neutral silently goes stale. If your scheme
   has two trackable points, steer on the relation between them.

   Two axes taken as the **difference** and the **mean** of the same pair of points are
   independent by construction, so they cannot bleed into each other. That is worth designing
   towards, and worth a test that says so.
3. **How tiring is it?** Continuous full-arm motion is exhausting within a minute. Wrist motion
   is not. Tilt-to-steer was chosen over move-to-steer mostly for this, and it has a second
   benefit: a stick has a **physical detent** — you can feel level and return to neutral without
   watching the screen. Position-based controls drift because nothing tells your arm it has.
4. **Does the game's control want a position or a rate?** This game's `steer` sets a target
   lateral *velocity*, not a lane. Rate controls punish drift, which raised the value of that
   detent. Check what your target actually consumes before picking a mapping.

Then write the mapping table down and get it agreed before implementing:

| Signal | Source | Why this one |
|---|---|---|
| steer | angle between the two discs | most precise, least tiring, has a felt neutral |
| throttle | distance between the two discs | robust depth; matches the "push the throttle" metaphor |
| jump | upward velocity of their midpoint | the only discrete event; see §7 |

---

## 3. Compute the latency budget first. It may kill the idea.

Do this arithmetic before building anything:

```
camera sampling        1000/fps ms   (16 ms at 60fps, 33 ms at 30fps)
capture pipeline       20-50 ms      (getUserMedia is not free)
gesture recognition    N frames      (you must SEE a gesture before you can name it)
render                 16 ms
-------------------------------------------------
wand flick to jump:    ~100 ms worse than a key press
```

Then convert it into the game's own units. Here: at `V_MAX = 21` units/s a road row passes every
**48 ms**, so 100 ms is two rows of error on every jump. That is not a tuning problem, it is
physics, and no amount of filtering fixes it.

Three consequences, all of which shaped the build:

- **Say it out loud, early.** It was flagged to the user in the design review, before code. The
  reply — "it is fine even if wand-only play doesn't clear all worlds, this is experimental" —
  is what made the rest of the project safe to do. Do not discover this at the end.
- **Design for hybrid, not exclusive.** Steering and throttle come from the wand while `Space`
  still jumps, and the gamepad and phone pad stay live. In `Input.poll()` the wand *replaces*
  the analog axes but the jump is OR'd:
  ```ts
  if (Math.abs(this.wand.steer) > 0.02) steer = this.wand.steer;
  jump = jump || this.wand.jump;   // a flick is ~100ms slower than a key
  ```
- **Spend latency only where it buys robustness.** Fire on the *onset* of a gesture, not after
  confirming it. See §7.

---

## 4. Calibrate. Never hard-code what the world looks like.

The single highest-leverage decision in this controller: the colour model is **fitted to whatever
the player holds up**, not to the ink we designed.

- Home printers do not produce `#ff00a8`.
- Tungsten light, a backlit window and the game's own magenta glow all move colours.
- Most people trying a web game do not have a printer within reach.

Fitting the model at runtime solved all three with one mechanism. The calibration box is split in
half: whatever saturated colour dominates the left half becomes disc A, the right half disc B.
That means **two random coloured objects work exactly as well as the printed marker** — which
turned a hard prerequisite into a nice-to-have, and is covered by a test
(`works with any two coloured objects, not just the printed marker`).

Pick a **representation that is invariant to the thing you cannot control.** Here that is
brightness, so pixels are classified in normalised rg chromaticity (`r/(r+g+b)`, `g/(r+g+b)`)
rather than RGB or YCbCr. Under a uniform intensity change those coordinates are *exactly*
invariant, so shading across a disc, a dimmed lamp or a passing cloud do not move a pixel out of
its model. The measured separation is enormous — distance from neutral grey:

| | distance from grey |
|---|---|
| printed magenta | 109 |
| printed cyan | 92 |
| skin | 20 |
| a beige wall | 4 |

Fit a small **Gaussian** (mean + covariance, with a ridge so the inverse stays conditioned) and
classify by Mahalanobis distance. A fixed threshold band is the thing that breaks in real rooms.

And **validate the calibration, with errors a human can act on** — `no-marker-left`,
`no-marker-right`, `too-similar`, each mapped to a sentence telling the player what to change.

---

## 5. Filter with a 1€ filter, and re-tune `beta` for your units

Use the [1€ filter](https://gery.casiez.net/1euro/): a low-pass whose cutoff rises with speed, so
it removes jitter while the input is still and adds no lag when it moves. It is ~20 lines.

**The trap that cost real time here.** Published 1€ examples use `beta ≈ 0.007`, for pointer data
measured in *pixels*, where speeds run into the hundreds. Tilt in this controller is radians over
a range of ~0.7, so speeds are order 1–5. At the published value the adaptive term is worthless
and the filter degenerates into a flat 1 Hz low-pass — **~160 ms of steering lag**. The defaults
here are `minCutoff = 4, beta = 1.5`, roughly three orders of magnitude off the reference, and
that is correct.

Tune it against a target you can state: *"a third of a second into a sweep the filter must be
within 10% of the input"* is a test (`tracks a fast sweep closely instead of lagging behind it`).
"Feels smooth" is not.

Filter the **physical quantities** (angle delta, fractional separation), not the derived game
axes — and wrap angles before filtering, or a wraparound will produce a violent spike.

**Never filter the signal a discrete gesture is detected from.** Steering and throttle go through
1€; the flick velocity is read raw.

---

## 6. Shape the axes

Between the filter and the game: a **deadzone** (so a held-still hand is exactly zero, not
0.03), then a **signed-square response** so small movements near neutral are fine-grained and the
edges still reach full deflection. Both are three lines and both are worth it.

---

## 7. Discrete gestures: fire on onset, and respect the frame rate

A continuous axis can be smoothed. A gesture cannot — every frame you spend confirming it is
latency the player pays. The flick detector:

- fires on the **first** frame upward velocity crosses the threshold, not after confirmation;
- uses a weak 2-frame check on a sample it *already has*, so the check costs nothing;
- **re-arms only once the movement has slowed**, so one flick cannot fire twice on the way up;
- has a refractory period;
- **holds the output true for ~100 ms**, so the simulation's 120 ms jump buffer always catches it
  regardless of when the sim samples.

That last point generalises: **match the gesture's output duration to the consumer's input
window.** A one-frame pulse from a 30 Hz source into a 120 Hz consumer is a dropped input.

### The frame-rate trap

This is the subtlest bug in the project and the one most likely to recur.

Tracking runs on `requestVideoFrameCallback`, which is **tied to the page's render cadence**, not
the camera's. A heavy 3D scene drags tracking down with it. The e2e caught this as
intermittency: flick detection **passed at 15fps and failed at 11fps**.

Cause: at low frame rates a whole gesture lands in one or two samples, so the 2-frame
confirmation — averaging over a window wider than the gesture itself — vetoed every real flick.
The fix is to make the confirmation **time-based, not frame-based**:

```ts
// The 2-frame check only means anything while the window is shorter than a flick.
const confirmed = 2 * dt > CONFIRM_WINDOW || v2 > t * 0.6;
```

Velocity noise also *shrinks* as `dt` grows, so dropping the check at low frame rates is free.

**Generalise:** any threshold you express in frames is a bug on a machine with a different frame
rate. Express thresholds in seconds, and test at both 60fps and 12fps. Both are tests here.

---

## 8. Integration rules

**Do not touch the simulation.** This game records replays as quantized input tapes, and ghosts,
pars and medals all depend on the sim being deterministic. It is very tempting to "help" a
high-latency controller by widening `COYOTE_TIME` or `JUMP_BUFFER`. Doing so would desynchronise
every existing replay and invalidate every record. **All accommodation belongs in the input
layer.** The payoff: a wand run produces a valid ghost and a comparable record, for free, with
zero changes under `src/sim/`.

**Merge, never replace.** Add a source to `Input` alongside `remote` and `touch`; leave every
other device live.

**Fail safe, loudly.** When tracking is lost:
- controls fade to neutral over ~200 ms (holding the last value steers the ship into a wall);
- the run **auto-pauses** after 500 ms.

That second one is not a nicety. Campaign mode auto-restarts on death, so without it, reaching
for a drink is an infinite crash loop. **Work out what your game does when input stops, before
you ship a controller that can stop.** Guard it against re-firing (`wandPaused`) so resuming by
keyboard is not instantly undone.

**Tag the provenance.** Runs driven by the wand are marked 🪄 on the shared scorecard. Cheap, and
it keeps leaderboards honest without gating anything.

---

## 9. Testing: three layers, no camera required

This is the most transferable part of the whole project. **You can fully test a camera controller
without a camera.**

### Layer 1 — pure core against synthetic frames (Vitest, `tests/wand.test.ts`)

Draw frames in a `Uint8ClampedArray` and assert on the output. 51 tests. Model the *degradations*,
not just the happy path:

| Condition | Helper | What it protects |
|---|---|---|
| sensor noise | `noise()` | threshold margins |
| motion blur | `blur()` | detection during the fastest movement |
| brightness change | `dim(0.55 … 1.3)` | the invariance claim in §4 |
| coloured ambient light | `tint()` | the *limit* of that claim |
| chroma subsampling | `subsample()` | real webcam output |
| partial occlusion | drawn thumb | fingers on the marker |
| a same-coloured distractor | second disc across the frame | latching onto the room |
| a near-black room | `dim(0.05)` | **gives up instead of guessing** |
| a skin-toned frame | flat fill | never matches a face |

Two of those assert **negative** results. A tracker that always returns something is worse than
one that reports nothing, because the failure is silent. Test the giving-up.

Also assert cost (`< 3 ms per full-frame detect`) and that the gated path is cheaper than the
full scan — a cheap guard against a refactor quietly removing the optimisation.

### Layer 2 — synthetic camera end-to-end (Playwright, `tools/fake-camera.mjs`)

Stub `getUserMedia` with a `canvas.captureStream()` whose pose the test controls exactly. **No
video fixtures, no ffmpeg, no y4m, no real camera.** This runs the entire real pipeline: video
element, `requestVideoFrameCallback`, canvas readback, tracking, mapping, `Input`, the
simulation, the UI. 25 checks.

Four details that turned a flaky test into a reliable one:

1. **`captureStream(0)` plus a `setInterval` pump**, not `requestAnimationFrame`. rAF competes
   with the game's render loop, which pinned the fake camera at ~10fps.
2. **Poll for convergence; never `sleep(guessed_ms)`.** The first version slept and read values
   one gesture behind, which read as a sign error and sent me chasing the wrong bug.
3. **Watch short-lived state from inside the page.** The jump flag is held ~100 ms; a Playwright
   poll steps straight over it. An in-page `setInterval` counting edges is race-free.
4. **Make the synthetic gesture unmissable** — the flick raises and *holds*. A gesture that
   snaps back can fall entirely between two camera samples.

Make the stub behave like the real API, including its inconvenient parts: it resolves after a
delay (which is what exposes a missing re-entrancy guard on the Enable button) and mints a
**fresh stream per call** (a real `getUserMedia` never hands back stopped tracks). Both of those
corrections came from tests that were passing vacuously.

> **Watch for vacuous checks.** One assertion counted `document.querySelectorAll('video')` to
> prove a second camera had not opened. It reported `0` — the video element is never added to the
> DOM — so it would have passed no matter what. Any check that passes for a reason you cannot
> state is not a check. Counting `getUserMedia` calls was the real test.

### Layer 3 — the existing suite

Re-run everything. The contrast audit grew to cover the new screens (34 screens, 695 text boxes,
0 below WCAG AA) and caught a placeholder glyph at 2.44:1. Screenshots caught two layout bugs
that no assertion would have: the tuning panel growing past the viewport, and a title and
subtitle sitting side by side. **Look at the screenshots. Tests do not have eyes.**

---

## 10. Bug catalogue: check for these by name

Every one of these was a real defect in this build. They are generic to the pattern.

**Geometry and sign**
- **Inverted axis.** A clockwise tilt reads as a *negative* angle in a y-up frame. Derive the
  sign on paper, then verify empirically — and name the tests after the *physical gesture*
  ("tilts right"), never the sign, or the test encodes the bug.
- **Mirroring.** Mirror the frame; a camera is not a mirror. Then keep tracker, preview and game
  in the same handedness.
- **Aspect distortion.** Normalise both axes by the *same* dimension (height), or angles skew.
  Clamping the working width instead of preserving aspect reintroduces this silently.

**Lifecycle** — all four were found by reading the shell, not by tests failing
- A pending `requestVideoFrameCallback` fires **once after teardown**, drawing from a torn-down
  stream. Store the handle, cancel it, and guard the tick with `stopped`.
- **Double-start.** Two clicks before the permission promise resolves opens two streams and two
  loops. Guard with the in-flight promise, not just the terminal state.
- **Promises that never settle.** Stopping the camera, or navigating away, during a multi-frame
  calibration left it pending forever and stuck the UI on "Hold still…". Every async flow driven
  by a frame loop needs a cancellation path on *every* exit — including unmount.
- **Default canvas size.** A fresh `<canvas>` is 300×150, not 0×0. Using it as a "have we seen a
  frame yet" signal silently computes regions against the wrong dimensions.

**Gesture state machines**
- **Arm on a state, not on a transition.** A jump gesture that arms when the hand goes
  open-to-closed never arms at all if the *resting* posture is already closed — the transition
  never happens, and the controller simply cannot jump. Arm on "is currently closed". A unit test
  caught this; nothing else would have until playtest.
- **Decide what a partial signal means.** With one hand visible, an angle between two hands has no
  value at all. Freezing the last reading is the wrong answer; fade that axis out, leave the
  others alone, and say so on screen.

**Camera settings**
- Locking **exposure** can pin a dim room too dark to track. Lock **white balance** — that is the
  setting that actually moves calibrated colours — and leave exposure automatic.

**Performance**
- Use `getContext('2d', { willReadFrequently: true })`, or `getImageData` fights the GPU readback
  path beside a bloom pipeline.
- Downscale hard before processing. 160×120 is 19k pixels and tracks a 7px disc fine, at
  **~0.4 ms per frame**.
- **Gate the search** to a window around the previous frame's result, with a full-frame
  re-acquire on a miss. Faster, and it stops a same-coloured object across the room from stealing
  the track.
- Running sums over ring buffers, not `array.shift()` + `reduce()` per frame, for live readouts.

---

## 11. The setup screen is half the product

A controller whose feel depends on the user's room cannot ship as a black box.

- **Show diagnostics in the UI, not behind a debug flag.** Tracking lock %, camera fps, pipeline
  lag, CPU cost. When a player asks "why did that jump not register", the answer must be on
  screen. This is also how you close a latency budget you cannot measure in CI.
- **Never open the camera unprompted on page load**, even with permission already granted. A
  camera light turning on by itself is hostile. Restore the saved calibration; wait for a click.
- **State the privacy position plainly**, in the UI and the README: frames are processed in the
  page, nothing is recorded, nothing is uploaded. Turning it off releases the camera.
- **Live preview with the detection drawn on top.** Seeing the two circles lock on is the
  difference between "it's broken" and "I need more light".
- **Persist the calibration**, and keep *recalibrate* and *recentre* one click (and one key) away.
  Lighting changes between sessions.
- **Secure context required.** `getUserMedia` needs HTTPS or `localhost`; a plain-HTTP LAN
  address will not work. Say so in the troubleshooting section.
- Onboard in order: explain → permission → calibrate → **tune with live feedback** → play.

---

## 12. Checklist

Design
- [ ] Mapping table agreed, with a stated reason per signal
- [ ] Latency budget computed **and converted into the game's units**
- [ ] The honest limitation stated to the user before implementation
- [ ] Hybrid with existing inputs; never exclusive
- [ ] No changes under `src/sim/` — accommodation in the input layer only

Implementation
- [ ] Pure core / thin shell split
- [ ] Runtime calibration, with actionable validation errors
- [ ] A representation invariant to what you cannot control
- [ ] 1€ filter, `beta` re-tuned for your units, verified against a stated lag target
- [ ] Deadzone + response curve
- [ ] Gestures fire on onset, re-arm on slow-down, hold long enough for the consumer
- [ ] Every threshold in seconds, not frames
- [ ] Fade to neutral and auto-pause on signal loss
- [ ] Cancellation on every exit path of every frame-driven async flow

Verification
- [ ] Pure tests incl. noise, blur, brightness, occlusion, distractors
- [ ] Negative tests: it gives up rather than guessing
- [ ] Synthetic-camera e2e through the real pipeline, run repeatedly for flakiness
- [ ] Per-frame cost asserted
- [ ] Contrast audit extended to the new screens
- [ ] Screenshots reviewed by eye
- [ ] Full existing suite re-run

---

## 13. What happened on the second controller

§13 was originally a set of predictions for a hand controller. It has since been built. The
predictions and the measurements:

| Prediction | Outcome |
|---|---|
| ML inference costs ~5–15 ms/frame vs the wand's 0.4 ms | **6.7 ms measured** on a laptop GPU, with the game still rendering at 60 fps. No worker offload needed — but this was *measured before deciding*, not assumed. |
| A pinch or fist beats a flick for jumping | **Confirmed.** A fist is a state change, so it needs no confirmation window at all: ~70 ms against the wand's ~100 ms. The whole frame-rate trap in §7 simply does not apply. |
| A synthetic cartoon hand will not trip a real landmark model | **Confirmed**, and the fix is below. |
| No calibration needed | **Confirmed** for detection, but a *neutral pose* step is still needed, and the fist threshold has to be tunable — see below. |

### Stub the model's output, not its input

This is the technique that made the hand controller testable. Do not try to fake pixels an ML
model will accept. Instead put a seam where the model's *results* enter your code:

```ts
// handInput.ts — the seam the test replaces
const stub = window.__neonHandStub;
if (stub) { this.detector = stub; return; }
```

The test injects landmark skeletons directly. Everything downstream — hand assignment, geometry,
filtering, the mapper, `Input`, the simulation, the UI — then runs for real, and CI never
downloads 9 MB of weights. 25 end-to-end checks run in seconds.

**But be honest about what the stub hides.** It bypasses the dynamic import, the asset paths, the
wasm resolver, `createFromOptions` and `detectForVideo` — the entire real integration. So pair it
with a second, smaller check that loads the genuine model on a real GPU (`tools/hand-perf.mjs`)
and answers the questions the stub cannot: does the real path work, what does it cost, and does
the game still hit its frame rate with it running. That check found the honest performance number
quoted above, and it is the only thing verifying the build-time asset staging.

### Shipping an ML model

- **Lazy-load it.** A dynamic `import()` keeps the runtime out of the main bundle — here it
  becomes a 45 KB gzipped chunk fetched only when the screen opens.
- **Serve it yourself.** The wasm and weights are staged into the site at build time
  (`tools/fetch-mediapipe.mjs`), gitignored rather than committed. A CDN dependency at runtime is
  a feature that silently breaks one day.
- **Show real progress.** Stream the weights with a `ReadableStream` reader and pass the bytes as
  `modelAssetBuffer`, rather than handing the library a URL and having nothing to show for eight
  seconds.

### Landmark-specific traps

- **Handedness labels assume a selfie-flipped image.** Trusting them on an unflipped feed silently
  swaps every control. Assign hands by **mirrored screen position** instead — unambiguous whenever
  two hands are visible — and use the label only for a lone hand, learning what it means from
  frames where both were visible. The test stub deliberately reproduces the inverted convention,
  because that is the bug worth catching.
- **Pick a landmark that does not move with the gesture.** Steering reads the palm centre averaged
  over the wrist and knuckles. A centroid of all 21 points lurches sideways every time the fingers
  curl, so making a fist would drag the steering with it. There is a test comparing the two.
- **Derive gestures from ratios, not pixels.** Finger extension is measured from the wrist and
  divided by hand size, which makes it invariant to distance from the camera and to hand rotation.
  All four invariances are tests.
- **A held state must survive a dropped frame.** The simulation edge-triggers on jump, so one
  fist flickering for a single frame reads as two jumps. Hold the state through brief detection
  gaps, and test it by dropping exactly one frame mid-gesture.
- **The gesture threshold is not knowable in advance.** Hands differ. Ship a live openness bar
  with the threshold marked on it and a slider, so the player can see and set where their own
  fist crosses the line. Guessing a constant would have been wrong for somebody.

### Simplifying means deleting, not adding a mode

The first hand mapping had a joystick hand and a button hand, plus a *Split hands* alternative and
a *Left-handed* swap. It tested green and it worked — and it was too complicated to remember. The
replacement is a single symmetric scheme: grip an invisible wheel, turn to steer, raise or lower
to change speed, open a hand to jump.

The temptation when a user says "this is complicated" is to add their idea as another option.
That makes it worse. The symmetric scheme also made *Left-handed* meaningless, so three settings
became zero. If a redesign does not let you delete something, it probably has not simplified
anything.

A real-world metaphor is worth more than any amount of tuning: "hold a steering wheel" needs no
explanation at all, and the instructions shrank to three lines.

### Fairness is a design constraint, not a nicety

The cheap implementation of a hand controller is skin-tone segmentation: no download, a few
hundred lines, and it would have reused the wand's colour tracker almost unchanged. It was
rejected because it would work measurably better for some skin tones and lighting than others.
A pre-trained landmark model costs 9 MB and 6.7 ms a frame, and that is the price of the feature
working for everybody. Make this call explicitly and write down why.

### Build the second controller's foundations before the second controller

The camera lifecycle was extracted into `src/camera/source.ts` *before* the hand controller was
written, not after. Copying it would have copied all four lifecycle bugs from §10 verbatim — they
live entirely in that layer. The existing end-to-end check made the refactor safe to do: extract,
run the first controller's 25 checks, then build on it.

Related: **two camera controllers cannot share one webcam**, and trying is not worth it. Enforce
mutual exclusion — switching one on releases the other — and make that an end-to-end check.

## 14. What this process does not cover

Both controllers were verified against synthetic frames, a synthetic camera and — for the hand
controller — synthetic landmarks. Real sensor noise, rolling shutter, auto-exposure hunting,
actual room lighting, and whether a real model recognises *your* hands were **not** covered by any
automated check, and cannot be. Those gaps were stated to the user rather than papered over, and
playtesting closed them.

Plan for the same: automated tests buy you correctness of logic and freedom from regressions.
They do not tell you whether it feels good. Budget a real playtest, and make sure the diagnostics
panel is good enough that the playtester can tell you *why* something felt bad.
