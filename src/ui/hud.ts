import { ROW_D, V_MAX } from '../sim/constants';
import type { ShipState } from '../sim/ship';
import type { RunConfig } from '../game/session';
import { formatTime, MEDAL_NAMES, medalTarget } from '../game/medals';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

/** Heads-up display. DOM writes are skipped when values have not changed. */
export class Hud {
  readonly root: HTMLElement;
  private timer: HTMLElement;
  private target: HTMLElement;
  private delta: HTMLElement;
  private roadName: HTMLElement;
  private progressFill: HTMLElement;
  private progressGhost: HTMLElement;
  private progressWrap: HTMLElement;
  private o2Fill: HTMLElement;
  private o2Val: HTMLElement;
  private o2Wrap: HTMLElement;
  private fuelFill: HTMLElement;
  private fuelVal: HTMLElement;
  private fuelWrap: HTMLElement;
  private speedVal: HTMLElement;
  private speedSegs: HTMLElement[] = [];
  private grav: HTMLElement;
  private assist: HTMLElement;
  private ghostChip: HTMLElement;
  private wandChip: HTMLElement;
  private msg: HTMLElement;
  private msgTitle: HTMLElement;
  private msgSub: HTMLElement;
  private title: HTMLElement;
  private titleMain: HTMLElement;
  private titleSub: HTMLElement;
  private cache = new Map<HTMLElement, string>();
  private lastSegs = -1;
  private lastGrav = -1;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', parent);
    const top = el('div', 'hud-top', this.root);
    this.roadName = el('div', 'hud-road', top);
    const center = el('div', 'hud-center', top);
    this.timer = el('div', 'hud-timer', center, '00:00.00');
    const sub = el('div', 'hud-sub', center);
    this.target = el('span', 'hud-target', sub);
    this.delta = el('span', 'hud-delta', sub);
    el('div', 'hud-spacer', top);

    this.progressWrap = el('div', 'hud-progress', this.root);
    this.progressFill = el('div', 'hud-progress-fill', this.progressWrap);
    this.progressGhost = el('div', 'hud-progress-ghost', this.progressWrap);

    const bottom = el('div', 'hud-bottom', this.root);
    const res = el('div', 'hud-res', bottom);
    this.o2Wrap = el('div', 'meter o2', res);
    el('span', 'meter-label', this.o2Wrap, 'O₂');
    const o2Bar = el('div', 'meter-bar', this.o2Wrap);
    this.o2Fill = el('div', 'meter-fill', o2Bar);
    this.o2Val = el('span', 'meter-val', this.o2Wrap);
    this.fuelWrap = el('div', 'meter fuel', res);
    el('span', 'meter-label', this.fuelWrap, 'FUEL');
    const fuelBar = el('div', 'meter-bar', this.fuelWrap);
    this.fuelFill = el('div', 'meter-fill', fuelBar);
    this.fuelVal = el('span', 'meter-val', this.fuelWrap);

    const speed = el('div', 'hud-speed', bottom);
    const segs = el('div', 'speed-segs', speed);
    for (let i = 0; i < 20; i++) this.speedSegs.push(el('i', '', segs));
    const sv = el('div', 'speed-val', speed);
    this.speedVal = el('span', '', sv, '0');
    el('small', '', sv, 'SPEED');

    const chips = el('div', 'hud-chips', bottom);
    this.grav = el('div', 'chip grav', chips);
    this.assist = el('div', 'chip assist', chips, 'ASSIST');
    this.ghostChip = el('div', 'chip ghost-chip hidden', chips);
    this.wandChip = el('div', 'chip wand-chip hidden', chips);

    this.msg = el('div', 'hud-msg hidden', this.root);
    this.msgTitle = el('div', 'hud-msg-title', this.msg);
    this.msgSub = el('div', 'hud-msg-sub', this.msg);

    this.title = el('div', 'hud-title hidden', this.root);
    this.titleMain = el('div', 'hud-title-main', this.title);
    this.titleSub = el('div', 'hud-title-sub', this.title);
  }

  private set(e: HTMLElement, text: string): void {
    if (this.cache.get(e) === text) return;
    this.cache.set(e, text);
    e.textContent = text;
  }

  private style(e: HTMLElement, prop: string, value: string): void {
    const key = `${prop}`;
    if ((e.dataset[key] ?? '') === value) return;
    e.dataset[key] = value;
    e.style.setProperty(prop, value);
  }

  setup(cfg: RunConfig): void {
    this.root.classList.remove('hidden');
    this.root.dataset.mode = cfg.mode;
    this.set(this.roadName, cfg.title);
    this.progressWrap.classList.toggle('endless', cfg.mode === 'endless');
    this.lastGrav = -1;
  }

  /** Camera wand tracking state, shown only while the wand is switched on. */
  setWand(state: 'off' | 'searching' | 'tracking' | 'lost'): void {
    this.wandChip.classList.toggle('hidden', state === 'off');
    if (state === 'off') return;
    this.set(this.wandChip, state === 'tracking' ? 'WAND' : state === 'lost' ? 'WAND LOST' : 'WAND …');
    this.wandChip.classList.toggle('bad', state === 'lost');
    this.wandChip.classList.toggle('warn', state === 'searching');
  }

  update(s: ShipState, ghost: ShipState | null, cfg: RunConfig, assistOn: boolean): void {
    const hasGhost = !!cfg.ghost;
    this.ghostChip.classList.toggle('hidden', !hasGhost);
    if (hasGhost) {
      this.set(this.ghostChip, ghost ? `GHOST ${cfg.ghostTime ? formatTime(cfg.ghostTime) : 'ON'}` : 'GHOST OFF · G');
      this.ghostChip.classList.toggle('off', !ghost);
    }
    const endless = cfg.mode === 'endless';
    const len = cfg.road.length * ROW_D;
    if (endless) {
      this.set(this.timer, `${Math.floor(s.z)} m`);
      this.set(this.target, cfg.bestDistance ? `BEST ${cfg.bestDistance} m` : '');
      this.set(this.delta, formatTime(s.time));
      this.delta.className = 'hud-delta';
    } else {
      this.set(this.timer, formatTime(s.time));
      if (cfg.par) {
        const next = [4, 3, 2].find((m) => s.time <= medalTarget(m, cfg.par!)) ?? 0;
        this.set(this.target, next ? `${MEDAL_NAMES[next].toUpperCase()} ${formatTime(medalTarget(next, cfg.par))}` : '');
        this.target.dataset.medal = String(next);
      } else if (cfg.best) {
        this.set(this.target, `BEST ${formatTime(cfg.best)}`);
      }
      if (ghost && s.phase === 'alive') {
        const dz = ghost.z - s.z;
        const dt = dz / Math.max(s.vz, 6);
        const txt = `${dt > 0 ? '+' : '−'}${Math.abs(dt).toFixed(2)}`;
        this.set(this.delta, txt);
        this.delta.className = `hud-delta ${dt > 0.05 ? 'behind' : dt < -0.05 ? 'ahead' : ''}`;
      } else if (!ghost) {
        this.set(this.delta, '');
      }
      const p = Math.min(1, s.z / len);
      this.style(this.progressFill, 'width', `${(p * 100).toFixed(1)}%`);
      this.progressGhost.style.display = ghost ? 'block' : 'none';
      if (ghost) this.style(this.progressGhost, 'left', `${(Math.min(1, ghost.z / len) * 100).toFixed(1)}%`);
    }

    const o2 = s.oxygen / s.maxOxygen;
    const fuel = s.fuel / s.maxFuel;
    this.style(this.o2Fill, 'transform', `scaleX(${o2.toFixed(3)})`);
    this.style(this.fuelFill, 'transform', `scaleX(${fuel.toFixed(3)})`);
    this.set(this.o2Val, `${Math.ceil(s.oxygen)}s`);
    this.set(this.fuelVal, `${Math.ceil(fuel * 100)}%`);
    this.o2Wrap.classList.toggle('low', s.oxygen < 10);
    this.fuelWrap.classList.toggle('low', fuel < 0.15);

    const speedK = s.vz / V_MAX;
    this.set(this.speedVal, String(Math.round(s.vz * 10)));
    const segs = Math.round(speedK * 20);
    if (segs !== this.lastSegs) {
      this.lastSegs = segs;
      this.speedSegs.forEach((seg, i) => (seg.className = i < segs ? (i >= 16 ? 'on hot' : 'on') : ''));
    }
    if (s.gravity !== this.lastGrav) {
      if (this.lastGrav > 0 && endless) this.flashChip(this.grav);
      this.lastGrav = s.gravity;
      this.set(this.grav, `G ${s.gravity}`);
    }
    this.assist.classList.toggle('hidden', !assistOn);
    this.assist.classList.toggle('active', s.assistAge < 0.4);
  }

  private flashChip(e: HTMLElement): void {
    e.classList.remove('flash');
    void e.offsetWidth;
    e.classList.add('flash');
  }

  showMessage(title: string, sub: string, tone: 'good' | 'bad' | 'info'): void {
    this.msg.className = `hud-msg ${tone}`;
    this.msgTitle.textContent = title;
    this.msgSub.textContent = sub;
  }

  hideMessage(): void {
    this.msg.classList.add('hidden');
  }

  showTitle(main: string, sub: string): void {
    this.title.classList.remove('hidden');
    this.titleMain.textContent = main;
    this.titleSub.textContent = sub;
    this.title.classList.remove('fade');
    void this.title.offsetWidth;
    this.title.classList.add('fade');
  }

  hideTitle(): void {
    this.title.classList.add('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
