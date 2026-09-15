import { DT, ROW_D, V_MAX } from '../sim/constants';
import { Ev, ShipState, stepShip } from '../sim/ship';
import type { DeathCause } from '../sim/ship';
import { InputTape, quantize } from '../sim/replay';
import type { InputFrame, RoadSource } from '../sim/types';
import type { WorldDef } from '../levels/worldTypes';
import type { GameView } from '../render/view';
import type { AudioEngine } from '../audio/audio';
import type { Input } from '../core/input';
import type { Settings } from '../core/save';
import type { Hud } from '../ui/hud';

export type Mode = 'campaign' | 'endless' | 'daily';

export interface RunConfig {
  mode: Mode;
  road: RoadSource;
  world: WorldDef;
  roadId: string;
  title: string;
  subtitle: string;
  ghost: InputTape | null;
  par: number | null;
  best: number | null;
  bestDistance: number | null;
}

export interface RunResult {
  finished: boolean;
  time: number;
  cause: DeathCause | null;
  distance: number;
  tape: InputTape;
  assist: boolean;
}

const INTRO_TIME = 1.1;
const DEATH_DELAY = 1.25;
const FINISH_DELAY = 1.5;
const MAX_STEPS_PER_FRAME = 12;

export const DEATH_TEXT: Record<DeathCause, [string, string]> = {
  crash: ['HULL BREACH', 'You hit a wall head-on'],
  burn: ['INCINERATED', 'Burning tiles are lethal'],
  fall: ['LOST IN THE VOID', 'You drifted off the road'],
  oxygen: ['OXYGEN DEPLETED', 'Move faster or grab supplies'],
  fuel: ['OUT OF FUEL', 'Supplies refill your tank'],
};

export class Session {
  cfg: RunConfig | null = null;
  readonly ship = new ShipState();
  readonly prev = new ShipState();
  private ghost = new ShipState();
  private ghostPrev = new ShipState();
  private tape = new InputTape();
  private acc = 0;
  private intro = 0;
  private raw: InputFrame = { steer: 0, throttle: 0, jump: false };
  private q: InputFrame = { steer: 0, throttle: 0, jump: false };
  private gq: InputFrame = { steer: 0, throttle: 0, jump: false };
  private events = 0;
  private endTimer = 0;
  private ended = false;
  private lowO2Beep = 0;
  attempts = 0;
  paused = false;
  showGhost = true;
  onEnd: ((r: RunResult) => void) | null = null;
  onAutoRestart: (() => void) | null = null;
  onEvents: ((events: number, ship: ShipState) => void) | null = null;

  constructor(
    private view: GameView,
    private audio: AudioEngine,
    private input: Input,
    private hud: Hud,
    private settings: () => Settings,
  ) {}

  start(cfg: RunConfig): void {
    this.cfg = cfg;
    this.view.setRoad(cfg.road, cfg.world);
    this.view.setBestMarker(cfg.mode === 'endless' && cfg.bestDistance ? cfg.bestDistance : null);
    this.hud.setup(cfg);
    this.attempts = 0;
    this.reset();
  }

  reset(): void {
    const cfg = this.cfg!;
    this.ship.reset(cfg.road);
    this.prev.copyFrom(this.ship);
    this.ghost.reset(cfg.road);
    this.ghostPrev.copyFrom(this.ghost);
    this.tape = new InputTape();
    this.acc = 0;
    this.intro = 0;
    this.events = 0;
    this.endTimer = 0;
    this.ended = false;
    this.paused = false;
    this.attempts++;
    this.view.resetRun();
    this.hud.hideMessage();
    this.hud.showTitle(cfg.title, cfg.subtitle);
  }

  get running(): boolean {
    return !!this.cfg && !this.ended;
  }

  update(realDt: number): void {
    const cfg = this.cfg;
    if (!cfg) return;
    const dt = Math.min(realDt, 0.1);
    const settings = this.settings();
    this.input.poll(dt, this.raw);

    if (!this.paused) {
      if (this.intro < INTRO_TIME) {
        this.intro += dt;
        if (this.intro >= INTRO_TIME) this.hud.hideTitle();
      } else {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
          this.acc -= DT;
          steps++;
          this.prev.copyFrom(this.ship);
          this.ghostPrev.copyFrom(this.ghost);
          const alive = this.ship.phase === 'alive';
          if (alive) {
            quantize(this.raw, this.q);
            this.tape.push(this.q);
          }
          stepShip(cfg.road, this.ship, this.q, { jumpAssist: settings.jumpAssist });
          this.events |= this.ship.events;
          if (cfg.ghost) {
            if (this.ghost.phase === 'alive') cfg.ghost.read(this.ghost.steps, this.gq);
            stepShip(cfg.road, this.ghost, this.gq, { jumpAssist: false });
          }
        }
        if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
      }
    }

    this.handleEvents();

    const s = this.ship;
    if (s.phase !== 'alive' && !this.ended && !this.paused) {
      this.endTimer += dt;
      const delay = s.phase === 'finished' ? FINISH_DELAY : DEATH_DELAY;
      if (this.endTimer >= delay) this.finishRun();
    }

    const alpha = this.intro < INTRO_TIME ? 1 : this.acc / DT;
    const ghostOn = !!cfg.ghost && this.showGhost && settings.ghost;
    this.view.frame({
      ship: s,
      prev: this.prev,
      alpha: this.paused ? 1 : alpha,
      throttle: s.phase === 'alive' ? this.raw.throttle : 0,
      ghost: ghostOn ? this.ghost : null,
      ghostPrev: ghostOn ? this.ghostPrev : null,
      events: this.events,
      dt: this.paused ? 0 : dt,
      intro: Math.min(1, this.intro / INTRO_TIME),
    });
    this.events = 0;

    this.audio.updateEngine(s.vz / V_MAX, this.raw.throttle, s.phase === 'alive' && !this.paused);
    this.audio.setMusicIntensity(this.paused ? 0.2 : 0.35 + (s.vz / V_MAX) * 0.65);
    this.hud.update(s, ghostOn ? this.ghost : null, cfg, settings.jumpAssist);

    if (s.phase === 'alive' && s.oxygen < 10 && !this.paused) {
      this.lowO2Beep -= dt;
      if (this.lowO2Beep <= 0) {
        this.audio.warn();
        this.lowO2Beep = s.oxygen < 5 ? 0.5 : 1;
      }
    }
  }

  private handleEvents(): void {
    const ev = this.events;
    const s = this.ship;
    if (!ev) return;
    this.onEvents?.(ev, s);
    if (ev & Ev.Jump) this.audio.jump();
    if (ev & Ev.Assist) this.audio.assist();
    if (ev & Ev.Land) this.audio.land(Math.min(1, s.lastLandSpeed / 14));
    if (ev & Ev.Bump) this.audio.bump();
    if (ev & Ev.Boost) this.audio.boost();
    if (ev & Ev.Sticky) this.audio.sticky();
    if (ev & Ev.Supply) this.audio.supply();
    if (ev & Ev.Death && s.cause) {
      if (s.cause === 'fall') this.audio.fall();
      else if (s.cause === 'oxygen' || s.cause === 'fuel') this.audio.fail();
      else this.audio.crash();
      const [title, sub] = DEATH_TEXT[s.cause];
      const mode = this.cfg!.mode;
      this.hud.showMessage(title, mode === 'campaign' ? `${sub} · retrying…` : sub, 'bad');
    }
    if (ev & Ev.Finish) {
      this.audio.finish();
      if (this.cfg!.mode === 'campaign') this.hud.showMessage('ROAD COMPLETE', '', 'good');
    }
  }

  private finishRun(): void {
    const cfg = this.cfg!;
    const s = this.ship;
    if (s.phase === 'dead' && cfg.mode === 'campaign') {
      this.onAutoRestart?.();
      this.reset();
      return;
    }
    this.ended = true;
    this.onEnd?.({
      finished: s.phase === 'finished',
      time: s.time,
      cause: s.cause,
      distance: Math.floor(s.z / ROW_D),
      tape: this.tape,
      assist: this.settings().jumpAssist,
    });
  }

  /** Skip the death delay (any key after a crash). */
  skipDeath(): void {
    if (this.ship.phase === 'dead' && this.endTimer > 0.35) this.endTimer = 99;
  }

  stop(): void {
    this.cfg = null;
    this.ended = true;
    this.audio.updateEngine(0, 0, false);
    this.hud.hide();
  }
}
