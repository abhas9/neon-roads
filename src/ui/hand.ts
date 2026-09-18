/**
 * Setup screen for the hand controller: permission, model download, live skeleton preview and
 * tuning. Like the wand screen, the diagnostics are on show rather than behind a debug flag:
 * how well hand tracking works depends entirely on the room, and the player needs to see why.
 */
import type { HandInput } from '../hand/handInput';
import type { HandObservation } from '../hand/gestures';
import type { Settings } from '../core/save';

export type HandStep = 'intro' | 'denied' | 'error' | 'live';

/** MediaPipe hand skeleton edges, for the preview overlay. */
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** Both hands share every job now, so the colours just say which hand the tracker thinks is which. */
const RIGHT_HAND = '#2ff3ff';
const LEFT_HAND = '#ff2fb4';

export class HandScreen {
  step: HandStep = 'intro';
  private root: HTMLElement | null = null;
  private raf = 0;

  constructor(
    private hand: HandInput,
    private settings: () => Settings,
    private onDone: () => void,
  ) {}

  initialStep(): HandStep {
    if (this.hand.state === 'denied') return 'denied';
    if (this.hand.state === 'error') return 'error';
    return this.hand.state === 'ready' ? 'live' : 'intro';
  }

  mount(root: HTMLElement): void {
    this.root = root;
    this.step = this.initialStep();
    this.render();
    this.tick();
  }

  unmount(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.root = null;
  }

  render(): void {
    if (!this.root) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.action;
    this.root.innerHTML = this.html();
    if (focused) this.root.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
  }

  private html(): string {
    return `
  <div class="screen hand-screen no-anim">
    <div class="panel wide wand-panel">
      <div class="screen-head inline">
        <button class="nav btn ghost back" data-action="back">‹ Back</button>
        <h2>Hand Controller</h2>
        <span class="tag-exp">Experimental</span>
      </div>
      <div class="wand-grid">
        <div class="wand-view ${this.step}">
          <canvas class="wand-preview hand-preview" width="480" height="360"></canvas>
          ${this.step === 'live' ? '<div class="hand-load hidden"><div class="hand-load-bar"><i></i></div><span class="hand-load-text"></span></div>' : '<div class="wand-camera-off">🖐</div>'}
        </div>
        <div class="wand-side">${this.sideHtml()}</div>
      </div>
    </div>
  </div>`;
  }

  private sideHtml(): string {
    switch (this.step) {
      case 'intro':
        return `
          <p>Hold both hands up as if gripping a steering wheel, and fly the ship with them. Nothing to print, nothing to hold.</p>
          <ul class="wand-steps">
            <li><b>Turn</b> the wheel — one hand up, the other down — to steer.</li>
            <li><b>Raise or lower both hands</b> together to speed up or brake.</li>
            <li><b>Open either hand</b> to jump, then close it again for the next one.</li>
          </ul>
          <p class="dim small">Hand tracking downloads about 9 MB the first time and then runs entirely in this page. Video never leaves your device: nothing is recorded and nothing is uploaded.</p>
          <div class="actions left">
            <button class="nav btn primary" data-action="hand-enable">Enable camera</button>
          </div>
          <p class="dim small">Sit where both hands fit in the picture, at about chest height. Your grip can stay relaxed — only a deliberate open hand counts as a jump.</p>`;
      case 'denied':
      case 'error':
        return `
          <p class="wand-error">${this.hand.error}</p>
          <div class="actions left">
            <button class="nav btn primary" data-action="hand-enable">Try again</button>
            <button class="nav btn ghost" data-action="back">Back</button>
          </div>`;
      case 'live': {
        const s = this.settings();
        const slider = (key: 'handSteerRange' | 'handThrottleRange' | 'handOpen', label: string, min: number, max: number, step: number, hint: string) =>
          `<label class="setting wand-slider"><span><b>${label}</b><small>${hint}</small></span>
            <input class="nav" type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-slider="${key}"></label>`;
        return `
          <div class="wand-live">
            <div class="wand-axes">
              <span>Steer<div class="wand-bar steer"><i></i></div></span>
              <span>Throttle<div class="wand-bar throttle"><i></i></div></span>
              <span>Left hand<div class="wand-bar open left"><i></i><b class="mark"></b><em class="jump-pill">OPEN</em></div></span>
              <span>Right hand<div class="wand-bar open right"><i></i><b class="mark"></b><em class="jump-pill">OPEN</em></div></span>
            </div>
            <div class="wand-diag">
              <span>Hands<b class="v-hands">–</b></span>
              <span>Camera<b class="v-fps">–</b></span>
              <span>Lag<b class="v-lat">–</b></span>
              <span>CPU<b class="v-cost">–</b></span>
            </div>
          </div>
          ${slider('handSteerRange', 'Steering range', 15, 60, 1, 'Degrees of wheel turn for full lock. Lower is twitchier.')}
          ${slider('handThrottleRange', 'Throttle range', 0.08, 0.32, 0.01, 'How far you raise or lower both hands for full speed.')}
          ${slider('handOpen', 'Open sensitivity', 0.35, 0.9, 0.01, 'The marker is where a hand counts as open. Lower needs less of a splay.')}
          <div class="actions left">
            <button class="nav btn primary" data-action="hand-done">Play with your hands</button>
            <button class="nav btn ghost" data-action="hand-recentre">Recentre <kbd>C</kbd></button>
            <button class="nav btn ghost" data-action="hand-off">Turn off</button>
          </div>
          <p class="dim small">Level hands already mean straight ahead. <b>Recentre</b> only sets the resting height for the throttle. <kbd>Space</kbd> still jumps.</p>`;
      }
    }
  }

  async enable(): Promise<void> {
    const ok = await this.hand.start();
    this.step = ok ? 'live' : this.hand.state === 'denied' ? 'denied' : 'error';
    this.render();
    this.applyTuning();
  }

  applyTuning(): void {
    const s = this.settings();
    this.hand.mapper.setTuning({
      steerRange: (s.handSteerRange * Math.PI) / 180,
      throttleRange: s.handThrottleRange,
      openThreshold: s.handOpen,
    });
  }

  done(): void {
    this.onDone();
  }

  private tick = (): void => {
    if (!this.root) return;
    this.draw();
    this.updateReadouts();
    this.raf = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const canvas = this.root?.querySelector<HTMLCanvasElement>('.hand-preview');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width: cw, height: ch } = canvas;
    ctx.clearRect(0, 0, cw, ch);
    if (this.hand.state !== 'ready' || !this.hand.video.videoWidth) {
      ctx.fillStyle = '#120a28';
      ctx.fillRect(0, 0, cw, ch);
      return;
    }
    // Mirrored, for the same reason the tracker mirrors: people expect to see themselves.
    ctx.save();
    ctx.setTransform(-1, 0, 0, 1, cw, 0);
    ctx.drawImage(this.hand.video, 0, 0, cw, ch);
    ctx.restore();

    for (const o of this.hand.observations) {
      const mine = this.roleOf(o);
      this.drawSkeleton(ctx, o, cw, ch, mine === 'right' ? RIGHT_HAND : mine === 'left' ? LEFT_HAND : 'rgba(255,255,255,.35)');
    }
    if (this.hand.modelState === 'ready' && this.hand.mapper.raw.hands < 2) {
      ctx.fillStyle = 'rgba(10,4,26,.72)';
      ctx.fillRect(0, ch / 2 - 26, cw, 52);
      ctx.fillStyle = '#fff';
      ctx.font = '600 20px Rajdhani, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Show both hands to the camera', cw / 2, ch / 2 + 7);
    }
  }

  /** Which role this skeleton was assigned, by matching its palm against the assigned pair. */
  private roleOf(o: HandObservation): 'left' | 'right' | null {
    const { left, right } = this.hand.pair;
    const cx = o.landmarks?.[9]?.x ?? 0;
    const mirrored = (0.5 - cx) * this.hand.aspect;
    const near = (v: { x: number } | null) => v && Math.abs(v.x - mirrored) < 0.12;
    if (near(right)) return 'right';
    if (near(left)) return 'left';
    return null;
  }

  private drawSkeleton(ctx: CanvasRenderingContext2D, o: HandObservation, cw: number, ch: number, color: string): void {
    const lm = o.landmarks;
    if (!lm || lm.length < 21) return;
    // The preview is mirrored, so landmarks map straight across.
    const px = (i: number) => (1 - lm[i].x) * cw;
    const py = (i: number) => lm[i].y * ch;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
    }
    ctx.stroke();
    ctx.fillStyle = color;
    for (let i = 0; i < 21; i++) {
      ctx.beginPath();
      ctx.arc(px(i), py(i), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private updateReadouts(): void {
    const root = this.root;
    if (!root || this.step !== 'live') return;
    const load = root.querySelector<HTMLElement>('.hand-load');
    if (load) {
      const state = this.hand.modelState;
      // A failed model load must say so: hiding the bar would leave a live preview that simply
      // never tracks anything, with nothing on screen to explain why.
      const show = state !== 'ready';
      load.classList.toggle('hidden', !show);
      load.classList.toggle('failed', state === 'error');
      if (show) {
        const bar = load.querySelector<HTMLElement>('.hand-load-bar i');
        if (bar) bar.style.width = state === 'error' ? '100%' : `${Math.round(this.hand.progress * 100)}%`;
        const text = load.querySelector('.hand-load-text');
        if (text) {
          text.textContent =
            state === 'error' ? this.hand.error || 'Hand tracking failed to load.' : `Loading hand tracking… ${Math.round(this.hand.progress * 100)}%`;
        }
      }
    }
    const m = this.hand.mapper;
    const st = this.hand.stats;
    const fill = (sel: string, v: number, signed = true) => {
      const el = root.querySelector<HTMLElement>(`${sel} i`);
      if (!el) return;
      if (signed) {
        const w = Math.min(1, Math.abs(v)) * 50;
        el.style.width = `${w}%`;
        el.style.left = v < 0 ? `${50 - w}%` : '50%';
      } else {
        el.style.left = '0';
        el.style.width = `${Math.min(100, Math.max(0, v * 100))}%`;
      }
    };
    fill('.wand-bar.steer', m.out.steer);
    fill('.wand-bar.throttle', m.out.throttle);
    fill('.wand-bar.open.left', m.raw.leftOpen, false);
    fill('.wand-bar.open.right', m.raw.rightOpen, false);
    const threshold = `${this.settings().handOpen * 100}%`;
    for (const mark of root.querySelectorAll<HTMLElement>('.wand-bar.open .mark')) mark.style.left = threshold;
    // A closed hand drives its bar to zero width, so the open state gets its own indicator
    // rather than being read off a bar that is empty exactly when it matters.
    root.querySelector('.wand-bar.open.left .jump-pill')?.classList.toggle('on', m.raw.leftOpen > this.settings().handOpen);
    root.querySelector('.wand-bar.open.right .jump-pill')?.classList.toggle('on', m.raw.rightOpen > this.settings().handOpen);

    const set = (sel: string, text: string, cls = '') => {
      const el = root.querySelector(sel);
      if (!el) return;
      if (el.textContent !== text) el.textContent = text;
      if (cls) el.className = `${sel.slice(1)} ${cls}`;
    };
    const both = m.raw.hands === 2;
    set('.v-hands', m.status === 'lost' ? 'none' : both ? 'both' : m.raw.hands === 1 ? 'one' : 'none', both ? 'good' : m.status === 'lost' ? 'bad' : 'warn');
    set('.v-fps', `${Math.round(st.fps)} fps`);
    set('.v-lat', st.latency > 0 ? `${Math.round(st.latency)} ms` : 'n/a');
    set('.v-cost', `${st.cost.toFixed(1)} ms`);
  }
}
