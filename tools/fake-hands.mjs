/**
 * A synthetic hand detector for browser tests.
 *
 * Drawing a cartoon hand would not reliably trip a real landmark model, so instead of faking
 * pixels this fakes the model's *output*: it installs `window.__neonHandStub`, the seam
 * HandInput checks before loading MediaPipe. Everything downstream of the model — assignment,
 * geometry, filtering, the mapper, Input, the simulation, the UI — then runs for real, and CI
 * never downloads 9 MB of weights.
 *
 * Install with `page.addInitScript(fakeHands)`, then drive it through `window.__hands`.
 */
export function fakeHands() {
  const ASPECT = 4 / 3;
  // Poses are in centred height units of the unmirrored camera image, x right, y up. The
  // player's right hand sits at negative x, because a camera does not mirror.
  const pose = {
    right: { x: -0.22, y: 0, scale: 0.12, curl: 0 },
    left: { x: 0.22, y: 0, scale: 0.12, curl: 0 },
  };

  /** Mirrors the skeleton builder used by the unit tests. */
  function build({ x, y, scale, curl }) {
    const lm = new Array(21);
    const pt = (hx, hy) => ({ x: 0.5 + hx / ASPECT, y: 0.5 - hy, z: 0 });
    const wx = x;
    const wy = y - scale * 0.5;
    lm[0] = pt(wx, wy);
    const spread = [-0.34, -0.02, 0.28, 0.56];
    const reach = [0.98, 1.06, 1.0, 0.88];
    const theta = curl * 2.6;
    const rot = (vx, vy, a) => [vx * Math.cos(a) - vy * Math.sin(a), vx * Math.sin(a) + vy * Math.cos(a)];
    for (let f = 0; f < 4; f++) {
      const mx = wx + scale * spread[f];
      const my = wy + scale * reach[f];
      const [d2x, d2y] = rot(0, 1, -theta);
      const [d3x, d3y] = rot(0, 1, -theta * 1.5);
      const pipx = mx;
      const pipy = my + scale * 0.45;
      const dipx = pipx + d2x * scale * 0.3;
      const dipy = pipy + d2y * scale * 0.3;
      const tipx = dipx + d3x * scale * 0.24;
      const tipy = dipy + d3y * scale * 0.24;
      const base = 5 + f * 4;
      lm[base] = pt(mx, my);
      lm[base + 1] = pt(pipx, pipy);
      lm[base + 2] = pt(dipx, dipy);
      lm[base + 3] = pt(tipx, tipy);
    }
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      lm[i] = pt(wx - scale * 0.5 * t, wy + scale * 0.5 * t);
    }
    return lm;
  }

  let detections = 0;
  window.__neonHandStub = {
    detect() {
      detections++;
      const out = [];
      // MediaPipe labels handedness as if the image were selfie-flipped, so the player's right
      // hand comes back labelled "Left". The stub reproduces that, because getting it backwards
      // is exactly the bug worth catching.
      if (pose.right) out.push({ landmarks: build(pose.right), label: 'Left' });
      if (pose.left) out.push({ landmarks: build(pose.left), label: 'Right' });
      return out;
    },
  };
  window.__hands = {
    set(next) {
      for (const side of ['right', 'left']) {
        if (!(side in next)) continue;
        if (next[side] === null) pose[side] = null;
        else pose[side] = { ...(pose[side] ?? { x: side === 'right' ? -0.22 : 0.22, y: 0, scale: 0.12, curl: 0 }), ...next[side] };
      }
    },
    detections: () => detections,
  };
}
