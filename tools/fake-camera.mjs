/**
 * A synthetic webcam for browser tests: draws a two-disc wand marker into a canvas and serves it
 * through a stubbed getUserMedia. Frames are pumped manually on a fixed interval rather than from
 * requestAnimationFrame, so the fake camera keeps a steady rate even while the software GL
 * renderer is busy.
 *
 * Install with `page.addInitScript(fakeCamera)`, then drive it through `window.__wand`.
 */
export function fakeCamera() {
  const W = 640;
  const H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // Pose is in un-mirrored camera space, exactly as a real webcam would deliver it.
  const pose = { x: 0.5, y: 0.5, half: 0.14, angle: 0, visible: true };
  // A flick raises the wand and holds it there. Snapping straight back down would let the whole
  // gesture fall between two camera samples on a slow page.
  let lift = 0;
  let liftTarget = 0;
  const disc = (cx, cy, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const draw = () => {
    ctx.fillStyle = '#c4bcb0'; // a neutral wall
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e0b496'; // a face-sized patch of skin tone, which must not be matched
    ctx.beginPath();
    ctx.ellipse(W * 0.5, H * 0.22, 54, 68, 0, 0, Math.PI * 2);
    ctx.fill();
    if (liftTarget > lift) lift = Math.min(liftTarget, lift + 0.0425);
    else lift = liftTarget;
    if (!pose.visible) return;
    const cx = pose.x * W;
    const cy = (pose.y - lift) * H;
    const dx = Math.cos(pose.angle) * pose.half * W;
    const dy = -Math.sin(pose.angle) * pose.half * W;
    ctx.strokeStyle = '#241a34';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
    // Un-mirrored: magenta on the right of the image, so it lands on the left once mirrored.
    disc(cx + dx, cy + dy, 22, '#ff00a8');
    disc(cx - dx, cy - dy, 22, '#00e5ff');
  };
  // A real getUserMedia always hands back a live stream, so a fresh one is minted per call;
  // reusing a stream whose tracks were stopped would make "turn off, turn on again" untestable.
  let tracks = [];
  const mint = () => {
    const s = canvas.captureStream(0);
    tracks.push(s.getVideoTracks()[0]);
    return s;
  };
  setInterval(() => {
    draw();
    tracks = tracks.filter((t) => t.readyState === 'live');
    for (const t of tracks) t.requestFrame();
  }, 16);
  window.__wand = {
    set: (next) => Object.assign(pose, next),
    flick: () => {
      liftTarget = 0.3;
    },
    drop: () => {
      liftTarget = 0;
    },
  };
  navigator.mediaDevices = navigator.mediaDevices ?? {};
  // Counted so tests can prove a second camera is never opened.
  window.__gumCalls = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    window.__gumCalls++;
    // A real permission prompt does not resolve instantly; the delay is what exposes a missing
    // re-entrancy guard on the enable button.
    await new Promise((r) => setTimeout(r, 120));
    return mint();
  };
}
