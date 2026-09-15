import type { Input } from '../core/input';

/** On-screen controls: a drag pad on the left (x steers, y throttles) and a jump button on the right. */
export class TouchControls {
  readonly root: HTMLElement;
  private knob: HTMLElement;
  private padId: number | null = null;
  private origin = { x: 0, y: 0 };

  constructor(parent: HTMLElement, private input: Input, onPause: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'touch hidden';
    this.root.innerHTML = `
      <div class="touch-pad"><div class="touch-ring"><div class="touch-knob"></div></div><span>STEER · THROTTLE</span></div>
      <button class="touch-jump" aria-label="Jump">JUMP</button>
      <button class="touch-pause" aria-label="Pause">❚❚</button>`;
    parent.appendChild(this.root);
    const pad = this.root.querySelector<HTMLElement>('.touch-pad')!;
    const ring = this.root.querySelector<HTMLElement>('.touch-ring')!;
    this.knob = this.root.querySelector<HTMLElement>('.touch-knob')!;
    const jump = this.root.querySelector<HTMLElement>('.touch-jump')!;

    pad.addEventListener('pointerdown', (e) => {
      this.padId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      const r = ring.getBoundingClientRect();
      this.origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.move(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.padId) this.move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.padId) return;
      this.padId = null;
      this.input.touch.steer = 0;
      this.input.touch.throttle = 0;
      this.knob.style.transform = '';
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);

    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.touch.jump = true;
      jump.classList.add('down');
    });
    const release = () => {
      this.input.touch.jump = false;
      jump.classList.remove('down');
    };
    jump.addEventListener('pointerup', release);
    jump.addEventListener('pointercancel', release);
    jump.addEventListener('pointerleave', release);
    this.root.querySelector('.touch-pause')!.addEventListener('click', onPause);
  }

  private move(e: PointerEvent): void {
    const R = 56;
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const sx = dx / R;
    const sy = -dy / R;
    this.input.touch.steer = Math.abs(sx) < 0.12 ? 0 : sx;
    this.input.touch.throttle = Math.abs(sy) < 0.25 ? 0 : sy;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    this.input.touch.active = v;
  }
}
