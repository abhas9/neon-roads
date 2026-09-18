# Building camera controllers

Reference for adding a camera- or sensor-driven controller to this game. Derived from two built
in this repo: a colour-marker wand (removed after playtesting) and the hand controller in
`src/hand/`. Read `docs/PLAN.md` for the game's architecture first.

---

## 1. Architecture

Split into a **pure core** and a **thin shell**.

```
src/hand/gestures.ts    pure   landmarks    -> readings      (no DOM, no state)
src/hand/mapping.ts     pure   readings+dt  -> InputFrame    (stateful, no DOM)
src/core/filter.ts      pure   samples+dt   -> smoothed
src/hand/handInput.ts   shell  camera, model, frame loop
src/camera/source.ts    shell  getUserMedia, video element, frame cadence, fps/latency
src/ui/hand.ts          shell  setup screen, diagnostics
```

Rule: if it can be a function of `(data, numbers)`, it must be. The shell should contain nothing
worth setting a breakpoint in.

Output a single `InputFrame { steer, throttle, jump }` — the same struct the keyboard produces.
Nothing downstream should know a camera exists.

**Reuse `src/camera/source.ts`.** Camera lifecycle bugs (§7) live entirely in that layer; a second
copy is a second set of them.

---

## 2. Choosing signals

For each control the game needs, ask:

**How noisy is it?** For a monocular camera, in descending order of reliability:
angle between two tracked points › position of one point › distance from separation ›
distance from apparent area.

**Is it a relation or an absolute?** Prefer a relation between two tracked points. A relation is
self-correcting: the player shifts in their seat, both points move together, the control does not
change. Absolute position drifts and takes the calibrated neutral with it.

Two axes taken as the **difference** and the **mean** of the same pair of points are independent
by construction and cannot bleed into each other. Assert this in a test.

**How tiring is it?** Continuous full-arm motion is exhausting within a minute; wrist motion is
not. Sustained muscle tension (a clenched fist, a raised arm) is worse than a held position.

**Position or rate?** Check what the game consumes. `steer` here sets a target lateral *velocity*,
not a lane, so drift is punished and a neutral the player can feel matters.

**Does the metaphor carry it?** "Hold a steering wheel" needs no instructions. A real-world
metaphor is worth more than any amount of tuning.

Write the mapping table down and agree it before implementing.

---

## 3. Latency budget

Compute before building:

```
camera sampling        1000/fps ms   (16 ms at 60fps, 33 ms at 30fps)
capture pipeline       20-50 ms
gesture recognition    N frames      (a gesture must be seen before it can be named)
render                 16 ms
```

Convert into the game's units. At `V_MAX = 21` a road row passes every **48 ms**, so 100 ms of
gesture latency is two rows of jump error. Measured here: opening a hand ~70 ms, a motion-based
flick ~100 ms.

Consequences:

- State-change gestures (open/close, pinch) beat motion-threshold gestures. They need no
  confirmation window.
- State the limitation to the user before implementing, not after.
- Merge with existing inputs, never replace them. In `Input.poll()` the camera replaces the analog
  axes but jump is OR'd, so `Space` always works.
- Never change `src/sim/**` to compensate. Replays, ghosts, pars and medals depend on determinism;
  widening `COYOTE_TIME` or `JUMP_BUFFER` desynchronises every existing replay. All accommodation
  belongs in the input layer.

---

## 4. Calibration

Calibrate against the player and their room; do not hard-code what the world looks like.

- **Choose a representation invariant to what you cannot control.** For colour tracking that means
  normalised chromaticity (`r/(r+g+b)`), which divides out intensity, rather than RGB or YCbCr.
  For landmarks it means ratios normalised by hand size, which are invariant to distance and
  rotation.
- **Calibrate only what actually varies.** A steering angle whose zero is "level" needs none; a
  resting height does.
- **Validate, with errors a human can act on** — name what was not seen and what to change.
- **Make gesture thresholds tunable, with a live readout.** Hands and rooms differ; a constant
  will be wrong for somebody. Ship a bar with the threshold marked on it and a slider.

---

## 5. Filtering and shaping

Use a [1€ filter](https://gery.casiez.net/1euro/) — a low-pass whose cutoff rises with speed.

**Re-tune `beta` for your units.** Published examples use `beta ≈ 0.007` for pointer data in
pixels, where speeds run to the hundreds. Radians over a range of ~0.7 need roughly three orders
more. At the published value the filter degenerates into a flat 1 Hz low-pass and adds ~160 ms of
lag. Defaults here: `minCutoff = 4, beta = 1.5`.

Verify against a stated target, e.g. *"a third of a second into a sweep, within 10% of the input"*.

- Filter physical quantities (angle delta, fractional height), not derived game axes.
- Wrap angles before filtering, or a wraparound produces a spike.
- Never filter the signal a discrete gesture is detected from.
- Between filter and game: a **deadzone**, then a **signed-square response** so small movements
  are fine-grained and the edges still reach full deflection.

---

## 6. Discrete gestures

- Fire on **onset**, not after confirmation. Every confirmation frame is latency.
- Arm on a **state**, not a transition (§7).
- Hold the output long enough for the consumer's input window. The sim buffers a jump for 120 ms;
  a one-frame pulse from a 30 Hz source is a dropped input.
- Hold state through brief detection gaps, or one gesture reads as two.
- **Express every threshold in seconds, never frames.** Tracking runs on
  `requestVideoFrameCallback`, which follows the page's render cadence, so a threshold in frames
  behaves differently on a slow machine. Test at 60 fps and 12 fps.

---

## 7. Defect catalogue

Check for these by name. All were real.

**Geometry**
- **Inverted axis.** Derive the sign on paper, verify empirically, and name tests after the
  physical gesture ("turns clockwise") so the test cannot encode the bug.
- **Mirroring.** Mirror the frame; a camera is not a mirror. Keep tracker, preview and game in one
  handedness.
- **Aspect distortion.** Normalise both axes by the same dimension. Clamping a working width
  instead of preserving aspect reintroduces this silently.
- **Handedness labels.** Detector handedness assumes a selfie-flipped image. Assign by mirrored
  screen position instead; use the label only for a lone point, and learn its meaning from frames
  where both were visible.
- **Landmarks that move with the gesture.** Read position from parts that stay put — palm centre
  over wrist and knuckles, not a centroid of all points, which lurches when fingers curl.

**State machines**
- **Arming on a transition.** If the resting posture is already "closed", a gesture that arms on
  open-to-closed never arms and can never fire. Arm on the state.
- **Undefined partial signals.** An angle between two points has no meaning with one point. Fade
  that axis out; do not freeze the last reading.

**Lifecycle** (all in the shell; all found by reading it, not by a failing test)
- A pending `requestVideoFrameCallback` fires once after teardown. Store the handle, cancel it,
  and guard the tick with a stopped flag.
- Two clicks before a permission promise resolves opens two streams. Guard with the in-flight
  promise, not the terminal state.
- Multi-frame async flows (calibration, model load) must have a cancellation path on **every**
  exit, including unmount, or they hang the UI or leak.
- A fresh `<canvas>` is 300×150, not 0×0. Do not use its size as a "have we seen a frame" signal.

**Camera settings**
- Lock white balance; leave exposure automatic. Locking exposure can pin a dim room too dark.

**Performance**
- `getContext('2d', { willReadFrequently: true })` for pixel readback.
- Downscale before processing. 160×120 tracks a 7 px target at ~0.4 ms/frame.
- Gate the search to a window around the previous result, with full-frame re-acquire on a miss.
- Running sums over ring buffers for live readouts, not `shift()` + `reduce()` per frame.

---

## 8. Testing

Three layers. **A camera controller is fully testable without a camera.**

### Pure core, synthetic input (`tests/hand.test.ts`, `tests/filter.test.ts`)

Generate input in code and assert on output. Model degradations, not just the happy path: sensor
noise, motion blur, brightness and colour shifts, chroma subsampling, partial occlusion, a
distractor, a near-black frame, a subject too far away.

Assert **negative** results too. A tracker that always returns something is worse than one that
reports nothing, because the failure is silent. Test that it gives up.

Assert per-frame cost, and that an optimised path is measurably cheaper than the naive one.

### End-to-end with a synthetic camera (`tools/fake-camera.mjs`, `tools/hand-e2e.mjs`)

Stub `getUserMedia` with a `canvas.captureStream()`. No video fixtures, no ffmpeg, no real camera.

For an ML detector, **stub the model's output, not its input** — a drawn subject will not reliably
trip a real model. `handInput.ts` checks `window.__neonHandStub` before loading MediaPipe;
`tools/fake-hands.mjs` injects landmark skeletons. Everything downstream runs for real and CI
never downloads the weights.

Four details that decide whether the test is reliable:

1. `captureStream(0)` plus a `setInterval` pump, not `requestAnimationFrame`, which competes with
   the game's render loop.
2. Poll for convergence; never `sleep(guessed_ms)`.
3. Watch short-lived state from inside the page. A ~100 ms flag is stepped over by a Playwright
   poll; an in-page `setInterval` counting edges is race-free.
4. Make the synthetic gesture unmissable — hold it rather than snapping back, or it can fall
   between two camera samples.

Make the stub behave like the real API, including its inconvenient parts: resolve after a delay,
and mint a fresh stream per call.

**Watch for vacuous checks.** Any assertion that passes for a reason you cannot state is not a
check. Comparing two zeroes passes with the feature entirely broken; hold the value off neutral
first. Counting DOM `<video>` elements proves nothing if the element is never attached; count
`getUserMedia` calls.

### Real integration (`tools/hand-perf.mjs`)

The stub bypasses the dynamic import, asset paths, wasm resolver and model API. A second, smaller
check must load the genuine model on a real GPU and measure cost plus in-game frame rate with and
without it. Measured here: 7–10 ms/frame inference, game holding 60 fps, so no worker offload was
needed — decided by measurement, not assumption.

### Existing suite

Re-run it. Extend the contrast audit to new screens. **Review screenshots by eye** — tests do not
catch a panel overflowing its viewport or two elements colliding.

---

## 9. Shipping an ML model

- **Lazy-load it.** A dynamic `import()` keeps the runtime out of the main bundle (45 KB gzipped
  chunk here, fetched on demand).
- **Serve it yourself.** `tools/fetch-mediapipe.mjs` stages wasm and weights into `public/` at
  build time, gitignored rather than committed. A runtime CDN dependency breaks silently later.
- **Show real progress.** Stream the weights with a `ReadableStream` reader and pass bytes as
  `modelAssetBuffer` rather than handing the library a URL.
- **Weigh fairness explicitly.** Skin-tone segmentation is far smaller and needs no download, but
  works better for some skin tones and lighting than others. A pre-trained model costs ~9 MB and
  ~7 ms/frame; that is the price of working for everybody. Record the decision.

---

## 10. The setup screen

A controller whose feel depends on the user's room cannot ship as a black box.

- **Diagnostics visible, not behind a debug flag:** tracking state, camera fps, pipeline lag, CPU
  cost. This is also how a latency budget gets closed outside CI.
- **Never open the camera on page load**, even with permission already granted.
- **State the privacy position** in the UI and the README: processed in the page, not recorded,
  not uploaded; switching off releases the camera.
- **Live preview with detection drawn on top.** Seeing the skeleton lock on is the difference
  between "it's broken" and "I need more light".
- **Indicate state that a bar cannot show.** A closed hand drives its openness bar to zero width
  exactly when the player needs to see it registered; give that state its own indicator.
- **Keep recalibrate and recentre one click and one key away.**
- Onboard in order: explain → permission → calibrate → tune with live feedback → play.
- **Secure context required.** `getUserMedia` needs HTTPS or `localhost`.

---

## 11. Simplification

Removing options is the only thing that simplifies. When a user reports controls are complicated,
adding their idea as another mode makes it worse.

A symmetric scheme removes settings that exist only to resolve asymmetry — the hand controller's
wheel mapping made a left-handed swap meaningless, so three settings became none.

---

## 12. Checklist

**Design**
- [ ] Mapping table agreed, one stated reason per signal
- [ ] Latency budget computed and converted into the game's units
- [ ] Limitation stated to the user before implementation
- [ ] Merges with existing inputs; never exclusive
- [ ] No changes under `src/sim/`

**Implementation**
- [ ] Pure core / thin shell; camera lifecycle reused, not copied
- [ ] Representation invariant to what you cannot control
- [ ] Runtime calibration with actionable errors; thresholds tunable with a live readout
- [ ] 1€ filter with `beta` re-tuned for the units, verified against a stated lag target
- [ ] Deadzone and response curve
- [ ] Gestures fire on onset, arm on state, hold for the consumer's window
- [ ] Every threshold in seconds
- [ ] Defined behaviour for partial signal; fade and auto-pause on loss
- [ ] Cancellation on every exit of every frame-driven async flow

**Verification**
- [ ] Pure tests including degradations and negative cases
- [ ] Synthetic-camera e2e through the real pipeline, run repeatedly for flakiness
- [ ] Real-integration check for anything the stub bypasses
- [ ] Per-frame cost asserted
- [ ] Contrast audit extended; screenshots reviewed by eye
- [ ] Full existing suite re-run

---

## 13. Limits

Automated checks cover logic and regressions. They do not cover real sensor noise, rolling shutter,
auto-exposure hunting, room lighting, or whether a model recognises a given user's hands. Budget a
real playtest, and make the diagnostics good enough that the playtester can say *why* something
felt wrong.
