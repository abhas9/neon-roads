/**
 * A synthetic webcam for browser tests: renders a neutral scene and serves it through a stubbed
 * getUserMedia. Frames are pumped manually on a fixed interval rather than from
 * requestAnimationFrame, so the fake camera keeps a steady rate even while the software GL
 * renderer is busy.
 *
 * It supplies frames only. Hand landmarks are stubbed separately, in fake-hands.mjs.
 *
 * Install with `page.addInitScript(fakeCamera)`.
 */
export function fakeCamera() {
  const W = 640;
  const H = 480;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const draw = () => {
    ctx.fillStyle = '#c4bcb0'; // a neutral wall
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e0b496'; // a face-sized patch of skin tone
    ctx.beginPath();
    ctx.ellipse(W * 0.5, H * 0.22, 54, 68, 0, 0, Math.PI * 2);
    ctx.fill();
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
