import './style.css';
import { GameView } from './render/view';
import { AudioEngine } from './audio/audio';
import { Input } from './core/input';
import type { MenuAction } from './core/input';
import { loadSave, writeSave } from './core/save';
import type { SaveData, Settings } from './core/save';
import { WORLDS, getRoad, roadId } from './levels/worlds';
import { EndlessRoad, dailySeed } from './levels/procedural';
import PARS from './levels/pars.json';
import { Session, DEATH_TEXT } from './game/session';
import type { RunConfig, RunResult } from './game/session';
import { formatTime, medalFor } from './game/medals';
import { copyToClipboard, gameUrl, postIntentUrl, postText, scorecard } from './game/share';
import type { Score } from './game/share';
import { InputTape } from './sim/replay';
import { Hud } from './ui/hud';
import { TouchControls } from './ui/touch';
import * as S from './ui/screens';
import { RemoteHost } from './net/remoteHost';
import { WandInput } from './wand/wandInput';
import { WandScreen } from './ui/wand';
import { Ev } from './sim/ship';
import { V_MAX } from './sim/constants';
import qrcode from 'qrcode-generator';

type Screen = 'title' | 'worlds' | 'playing' | 'paused' | 'results' | 'settings' | 'help' | 'phone' | 'wand';

const pars = PARS as Record<string, number>;

class App {
  private canvas = document.getElementById('game') as HTMLCanvasElement;
  private ui = document.getElementById('ui') as HTMLElement;
  private screenEl: HTMLElement;
  private view = new GameView(this.canvas);
  private audio = new AudioEngine();
  private input = new Input();
  private save: SaveData = loadSave();
  private hud: Hud;
  private touch: TouchControls;
  private session: Session;
  private screen: Screen = 'title';
  private settingsReturn: Screen = 'title';
  private current: { mode: 'campaign'; world: number; road: number } | { mode: 'endless' | 'daily'; seed: number; label: string; world: number } | null = null;
  private menuZ = 0;
  private menuWorld = 0;
  private last = performance.now();
  private remote = new RemoteHost();
  private wand = new WandInput();
  private wandScreen: WandScreen;
  /** True once the wand has been lost long enough to auto-pause; cleared when tracking returns. */
  private wandPaused = false;
  /** Whether the wand drove any part of the current run, for the shared scorecard. */
  private wandRun = false;
  private hudPush = 0;
  private toastEl: HTMLElement;
  private lastScore: Score | null = null;
  /** Present only when an automated test injects `window.__neonTest` before load. */
  private test = (window as unknown as { __neonTest?: NeonTestHook }).__neonTest;

  constructor() {
    this.hud = new Hud(this.ui);
    this.screenEl = document.createElement('div');
    this.screenEl.className = 'screens';
    this.ui.appendChild(this.screenEl);
    this.touch = new TouchControls(this.ui, this.input, () => this.togglePause());
    this.session = new Session(this.view, this.audio, this.input, this.hud, () => this.save.settings);
    this.session.onEnd = (r) => this.onRunEnd(r);
    this.wandScreen = new WandScreen(this.wand, () => this.settings, () => this.leaveWand());
    this.input.wandSource = (o) => this.wand.read(o);
    // Restore a previous session's colour model, but never open the camera unasked.
    this.wand.load();
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast hidden';
    this.ui.appendChild(this.toastEl);
    this.bindRemote();
    this.view.onFirework = (kind, strength) => (kind === 'launch' ? this.audio.fireworkLaunch() : this.audio.fireworkBurst(strength));
    if (this.test) {
      this.test.fireworkLoad = () => this.view.fireworkLoad;
      this.test.screen = () => this.screen;
      this.test.wand = () => ({
        state: this.wand.state,
        steer: this.wand.mapper.out.steer,
        throttle: this.wand.mapper.out.throttle,
        jump: this.wand.mapper.out.jump,
        status: this.wand.mapper.status,
        lock: this.wand.stats.lockRate,
        fps: this.wand.stats.fps,
        cost: this.wand.stats.cost,
        calibrated: !!this.wand.model,
      });
      this.test.ship = () => ({ x: this.session.ship.x, y: this.session.ship.y, z: this.session.ship.z, vz: this.session.ship.vz });
    }

    this.applySettings();
    this.bindInput();
    this.bindUi();
    this.setMenuWorld(0);
    this.show('title');
    document.getElementById('boot')?.remove();
    requestAnimationFrame((t) => this.loop(t));
  }

  private bindRemote(): void {
    this.input.remoteSource = (o) => this.remote.read(o);
    this.remote.onButton = (b) => {
      this.input.lastDevice = 'remote';
      this.audio.unlock();
      if (b === 'confirm' && this.screen !== 'playing' && !this.screenEl.contains(document.activeElement)) {
        this.focusFirst();
        return;
      }
      this.input.emit(b);
    };
    this.remote.onConnect = (name, connected) => {
      this.toast(connected ? `🎮 ${name} connected` : `${name} disconnected`);
      if (connected) this.remote.setMode(this.screen === 'playing' ? 'game' : 'menu');
    };
    this.remote.onChange = () => {
      if (this.screen === 'phone') this.renderPhone();
      const label = this.screenEl.querySelector('.phone-status');
      if (label) label.textContent = this.phoneLabel();
    };
    this.session.onEvents = (ev) => {
      if (!this.remote.count) return;
      if (ev & Ev.Death) this.remote.broadcast({ t: 'haptic', p: 'crash' });
      else if (ev & Ev.Finish) this.remote.broadcast({ t: 'haptic', p: 'finish' });
      else if (ev & Ev.Boost) this.remote.broadcast({ t: 'haptic', p: 'boost' });
      else if (ev & Ev.Supply) this.remote.broadcast({ t: 'haptic', p: 'supply' });
      else if (ev & Ev.Land) this.remote.broadcast({ t: 'haptic', p: 'land' });
      else if (ev & Ev.Jump) this.remote.broadcast({ t: 'haptic', p: 'jump' });
    };
    // Re-open the pairing channel automatically if a phone was paired before.
    try {
      if (localStorage.getItem('neon-roads-controller-code')) this.remote.start();
    } catch {
      // Storage unavailable.
    }
  }

  private wandLabel(): string {
    if (this.wand.state === 'ready') return this.wand.model ? 'tracking' : 'needs calibration';
    if (this.wand.state === 'denied') return 'camera blocked';
    return this.wand.model ? 'calibrated · tap to start' : 'steer with a printed marker';
  }

  private leaveWand(): void {
    this.show(this.current ? 'worlds' : 'title');
  }

  private phoneLabel(): string {
    if (this.remote.count) return this.remote.names.join(', ');
    if (this.remote.status === 'ready') return `code ${this.remote.code}`;
    return 'pair via QR';
  }

  private renderPhone(): void {
    const url = this.remote.controllerUrl();
    let svg = '';
    if (this.remote.code) {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      svg = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
    }
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.action;
    const rerender = this.screenEl.querySelector('.phone-screen') !== null;
    this.screenEl.innerHTML = S.phoneScreen({
      status: this.remote.status,
      error: this.remote.error,
      code: this.remote.code,
      url,
      qrSvg: svg,
      names: this.remote.names,
      lanHint: /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(location.hostname),
    });
    // Status updates re-render in place; only the first render fades in.
    if (rerender) this.screenEl.querySelector<HTMLElement>('.screen')?.classList.add('no-anim');
    const again = focused && this.screenEl.querySelector<HTMLElement>(`[data-action="${focused}"]`);
    if (again) again.focus();
    else this.focusFirst();
  }

  private toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden', 'show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
    clearTimeout(Number(this.toastEl.dataset.timer));
    this.toastEl.dataset.timer = String(setTimeout(() => this.toastEl.classList.add('hidden'), 2600));
  }

  private get settings(): Settings {
    return this.save.settings;
  }

  private persist(): void {
    writeSave(this.save);
  }

  private applySettings(): void {
    const s = this.settings;
    this.audio.setVolumes(s.music, s.sfx);
    this.view.applySettings({
      bloom: s.bloom,
      post: s.quality === 'high' && !new URLSearchParams(location.search).has('nopost'),
      shake: s.shake,
      pixelRatio: s.quality === 'high' ? Math.min(window.devicePixelRatio, 2) : Math.min(window.devicePixelRatio, 1) * 0.75,
    });
    this.updateTouchVisibility();
    this.wandScreen.applyTuning();
  }

  private updateTouchVisibility(): void {
    const mode = this.settings.touchControls;
    const touchDevice = (matchMedia('(pointer: coarse)').matches || this.input.lastDevice === 'touch') && !this.remote.count;
    const want = mode === 'on' || (mode === 'auto' && touchDevice);
    this.touch.setVisible(want && this.screen === 'playing');
  }

  private bindInput(): void {
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.input.on('restart', () => {
      if (this.screen === 'playing' || this.screen === 'paused') this.restartRun();
      else if (this.screen === 'results') this.retry();
    });
    this.input.on('pause', () => {
      if (this.screen === 'playing' || this.screen === 'paused') this.togglePause();
    });
    this.input.on('ghost', () => this.toggleGhost());
    this.input.on('recentre', () => {
      if (this.wand.state !== 'ready') return;
      this.toast(this.wand.recentre() ? '🪄 Neutral pose set' : 'Hold the wand up first');
    });
    this.input.on('any', () => {
      if (this.screen === 'playing') this.session.skipDeath();
    });
    this.input.onMenu((a) => this.menuNav(a));
    window.addEventListener('pointerdown', () => this.updateTouchVisibility());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'playing') this.togglePause();
    });
  }

  private bindUi(): void {
    this.screenEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-toggle],[data-select]');
      if (!target) return;
      this.audio.unlock();
      if (target.dataset.toggle) {
        const key = target.dataset.toggle as keyof Settings;
        (this.settings as unknown as Record<string, unknown>)[key] = !this.settings[key];
        target.querySelector('.switch')?.classList.toggle('on', !!this.settings[key]);
        this.audio.ui('confirm');
        this.applySettings();
        this.persist();
        return;
      }
      if (target.dataset.select) {
        (this.settings as unknown as Record<string, unknown>)[target.dataset.select] = target.dataset.value;
        target.parentElement?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === target));
        this.audio.ui('confirm');
        this.applySettings();
        this.persist();
        return;
      }
      this.action(target.dataset.action!, target);
    });
    this.screenEl.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.slider) {
        (this.settings as unknown as Record<string, number>)[t.dataset.slider] = Number(t.value);
        this.applySettings();
        this.persist();
      }
    });
    this.screenEl.addEventListener('focusin', (e) => {
      const w = (e.target as HTMLElement).closest<HTMLElement>('[data-world]');
      if (w && this.screen === 'worlds') this.setMenuWorld(Number(w.dataset.world));
    });
    this.screenEl.addEventListener('pointerover', (e) => {
      const w = (e.target as HTMLElement).closest<HTMLElement>('.world-card');
      if (w && this.screen === 'worlds') this.setMenuWorld(Number(w.dataset.world));
    });
  }

  private action(name: string, el: HTMLElement): void {
    this.audio.ui(name === 'back' || name === 'quit' ? 'back' : 'confirm');
    switch (name) {
      case 'campaign':
      case 'worlds':
        this.leaveRun();
        this.show('worlds');
        break;
      case 'daily': {
        const { seed, label } = dailySeed();
        this.startEndless('daily', seed, label);
        break;
      }
      case 'endless':
        this.startEndless('endless', (Math.random() * 2 ** 31) >>> 0, 'Endless');
        break;
      case 'help':
        this.show('help');
        break;
      case 'phone':
        this.remote.start();
        this.show('phone');
        break;
      case 'wand':
        this.show('wand');
        break;
      case 'wand-enable':
        void this.wandScreen.enable();
        break;
      case 'wand-calibrate':
        void this.wandScreen.calibrate();
        break;
      case 'wand-recalibrate':
        this.wandScreen.recalibrate();
        break;
      case 'wand-recentre':
        this.toast(this.wand.recentre() ? '🪄 Neutral pose set' : 'Hold the wand up first');
        break;
      case 'wand-done':
        this.wandScreen.done();
        break;
      case 'wand-off':
        this.wand.stop();
        this.wandScreen.step = 'intro';
        this.wandScreen.render();
        break;
      case 'wand-print':
        return;
      case 'phone-new-code':
        this.remote.newCode();
        break;
      case 'phone-disconnect':
        this.remote.stop();
        try {
          localStorage.removeItem('neon-roads-controller-code');
        } catch {
          // Ignore.
        }
        this.show('title');
        break;
      case 'settings':
        this.settingsReturn = this.screen;
        this.show('settings');
        break;
      case 'back':
        if (this.screen === 'settings') this.show(this.settingsReturn === 'paused' ? 'paused' : this.settingsReturn);
        else if (this.screen === 'phone' || this.screen === 'wand') this.show('title');
        else this.show('title');
        break;
      case 'road':
        this.startCampaign(Number(el.dataset.world), Number(el.dataset.road));
        break;
      case 'resume':
        this.togglePause();
        break;
      case 'toggle-ghost':
        this.toggleGhost();
        break;
      case 'share':
        this.share();
        break;
      case 'restart':
        this.restartRun();
        break;
      case 'quit':
      case 'menu':
        this.leaveRun();
        this.show(this.current?.mode === 'campaign' ? 'worlds' : 'title');
        break;
      case 'retry':
        this.retry();
        break;
      case 'next':
        this.nextRoad();
        break;
    }
  }

  private show(screen: Screen): void {
    if (this.screen === 'wand' && screen !== 'wand') this.wandScreen.unmount();
    this.screen = screen;
    let html = '';
    switch (screen) {
      case 'wand':
        this.screenEl.dataset.screen = screen;
        this.wandScreen.mount(this.screenEl);
        this.focusFirst();
        return;
      case 'phone':
        this.screen = screen;
        this.screenEl.dataset.screen = screen;
        this.remote.setMode('menu');
        this.renderPhone();
        return;
      case 'title':
        html = S.titleScreen(this.save, this.dailyLabel(), this.phoneLabel(), this.wandLabel());
        this.audio.playMusic(10, 0.3);
        break;
      case 'worlds':
        html = S.worldSelect(WORLDS, this.save, pars);
        this.audio.playMusic(WORLDS[this.menuWorld].music, 0.3);
        break;
      case 'settings':
        html = S.settingsScreen(this.settings);
        break;
      case 'help':
        html = S.helpScreen();
        break;
      case 'paused':
        html = S.pauseScreen(this.session.cfg?.title ?? '', { available: !!this.session.cfg?.ghost, on: this.settings.ghost });
        break;
      case 'playing':
        html = '';
        break;
      case 'results':
        return;
    }
    this.screenEl.innerHTML = html;
    this.screenEl.dataset.screen = screen;
    this.remote.setMode(screen === 'playing' ? 'game' : 'menu');
    this.updateTouchVisibility();
    this.focusFirst();
  }

  private showHtml(html: string, screen: Screen): void {
    this.screen = screen;
    this.remote.setMode('menu');
    this.screenEl.innerHTML = html;
    this.screenEl.dataset.screen = screen;
    this.updateTouchVisibility();
    this.focusFirst();
  }

  private focusFirst(): void {
    if (this.input.lastDevice === 'touch') return;
    const el = this.screenEl.querySelector<HTMLElement>('.nav:not([disabled]).primary') ?? this.screenEl.querySelector<HTMLElement>('.nav:not([disabled])');
    el?.focus({ preventScroll: true });
    if (this.screen === 'worlds') {
      // Jump to the furthest unlocked road.
      const roads = [...this.screenEl.querySelectorAll<HTMLElement>('.road-btn:not([disabled])')];
      const next = roads.find((r) => !this.save.roads[roadId(Number(r.dataset.world), Number(r.dataset.road))]?.completions) ?? roads[roads.length - 1];
      next?.focus();
      next?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    }
  }

  private menuNav(a: MenuAction): void {
    if (this.screen === 'playing') return;
    const active = document.activeElement as HTMLElement | null;
    if (a === 'back') {
      if (this.screen === 'paused') this.togglePause();
      else if (this.screen === 'results') this.action(this.current?.mode === 'campaign' ? 'worlds' : 'menu', active ?? this.screenEl);
      else if (this.screen !== 'title') this.action('back', active ?? this.screenEl);
      return;
    }
    if (a === 'confirm') {
      if (active && this.screenEl.contains(active)) {
        if (active.matches('input[type=range]')) return;
        active.click();
      }
      return;
    }
    if (active?.matches('input[type=range]') && (a === 'left' || a === 'right')) {
      const r = active as HTMLInputElement;
      r.value = String(Math.max(0, Math.min(1, Number(r.value) + (a === 'right' ? 0.05 : -0.05))));
      r.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const navs = [...this.screenEl.querySelectorAll<HTMLElement>('.nav:not([disabled])')].filter((n) => n.offsetParent !== null);
    if (!navs.length) return;
    if (!active || !navs.includes(active)) {
      navs[0].focus();
      return;
    }
    const r = active.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const n of navs) {
      if (n === active) continue;
      const b = n.getBoundingClientRect();
      const dx = b.left + b.width / 2 - cx;
      const dy = b.top + b.height / 2 - cy;
      const along = a === 'left' ? -dx : a === 'right' ? dx : a === 'up' ? -dy : dy;
      const across = a === 'left' || a === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 4) continue;
      const score = along + across * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (best) {
      best.focus();
      best.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      this.audio.ui('move');
    }
  }

  private setMenuWorld(i: number): void {
    if (i === this.menuWorld && this.menuZ > 0) return;
    this.menuWorld = i;
    this.view.setRoad(getRoad(i, 0), WORLDS[i]);
    this.menuZ = 0;
    if (this.screen === 'worlds') this.audio.playMusic(WORLDS[i].music, 0.3);
  }

  private dailyLabel(): string {
    const { label } = dailySeed();
    const rec = this.save.daily[label];
    return rec ? `today best ${rec.best} m` : label;
  }

  private startCampaign(world: number, road: number): void {
    const id = roadId(world, road);
    const rec = this.save.roads[id];
    const w = WORLDS[world];
    const def = w.roads[road];
    this.current = { mode: 'campaign', world, road };
    const cfg: RunConfig = {
      mode: 'campaign',
      road: getRoad(world, road),
      world: w,
      roadId: id,
      title: `${world + 1}-${road + 1} · ${def.name}`,
      subtitle: `${w.name.toUpperCase()} · G ${def.gravity} · O₂ ${def.oxygen}s`,
      ghost: rec?.ghost ? InputTape.decode(rec.ghost) : null,
      ghostAssist: rec?.ghostAssist ?? false,
      ghostTime: rec?.completions ? rec.best : null,
      inputTape: this.takeAutoplay(id),
      par: pars[id] ?? null,
      best: rec?.best ?? null,
      bestDistance: null,
    };
    this.menuWorld = -1;
    this.beginRun(cfg, w.music);
  }

  private startEndless(mode: 'endless' | 'daily', seed: number, label: string): void {
    const road = new EndlessRoad(seed, label);
    const worldIndex = mode === 'daily' ? seed % WORLDS.length : Math.floor(Math.random() * WORLDS.length);
    this.current = { mode, seed, label, world: worldIndex };
    const w = WORLDS[worldIndex];
    const daily = this.save.daily[label];
    const cfg: RunConfig = {
      // Daily runs share the endless HUD (distance instead of a timer).
      mode: 'endless',
      road,
      world: w,
      roadId: road.id,
      title: mode === 'daily' ? `Daily Run · ${label}` : 'Endless',
      subtitle: mode === 'daily' ? 'Same road for everyone today · how far can you go?' : `${w.name.toUpperCase()} · supplies every few hundred metres`,
      ghost: mode === 'daily' && daily?.ghost ? InputTape.decode(daily.ghost) : null,
      ghostAssist: daily?.ghostAssist ?? false,
      ghostTime: null,
      par: null,
      best: null,
      bestDistance: mode === 'daily' ? daily?.best ?? null : this.save.endless.best || null,
    };
    this.menuWorld = -1;
    this.beginRun(cfg, w.music);
  }

  private beginRun(cfg: RunConfig, music: number): void {
    this.wandRun = false;
    this.session.start(cfg);
    this.view.setGhostLabel(cfg.ghost ? (cfg.ghostTime ? `BEST ${formatTime(cfg.ghostTime)}` : cfg.bestDistance ? `BEST ${cfg.bestDistance} m` : 'BEST RUN') : null);
    this.audio.playMusic(music, 0.5);
    this.show('playing');
  }

  private restartRun(): void {
    if (!this.session.cfg) {
      this.retry();
      return;
    }
    if (this.screen === 'paused') this.show('playing');
    this.session.reset();
  }

  private retry(): void {
    const c = this.current;
    if (!c) return;
    if (c.mode === 'campaign') this.startCampaign(c.world, c.road);
    else this.startEndless(c.mode, c.mode === 'daily' ? c.seed : (Math.random() * 2 ** 31) >>> 0, c.label);
  }

  private nextRoad(): void {
    const c = this.current;
    if (!c || c.mode !== 'campaign') return;
    let { world, road } = c;
    road++;
    if (road >= WORLDS[world].roads.length) {
      world++;
      road = 0;
    }
    if (world >= WORLDS.length || !S.isRoadUnlocked(WORLDS, this.save, world, road)) {
      this.leaveRun();
      this.show('worlds');
      return;
    }
    this.startCampaign(world, road);
  }

  /** Ends the current run (or its celebration) and keeps the menu backdrop in the same world. */
  private leaveRun(): void {
    const wasActive = !!this.session.cfg;
    this.session.stop();
    this.view.stopCelebration();
    if (wasActive && this.current) {
      this.menuWorld = -2;
      this.setMenuWorld(this.current.world);
    }
  }

  private toggleGhost(): void {
    this.settings.ghost = !this.settings.ghost;
    this.persist();
    this.toast(this.settings.ghost ? '👻 Holographic ghost on' : 'Ghost off');
    if (this.screen === 'paused') this.show('paused');
    const toggle = this.screenEl.querySelector('[data-action="toggle-ghost"]');
    if (toggle && this.screen === 'results') toggle.textContent = this.settings.ghost ? 'Turn ghosts off' : 'Turn ghosts on';
  }

  private share(): void {
    const score = this.lastScore;
    if (!score) return;
    const url = gameUrl();
    const card = scorecard(score, url);
    const intent = postIntentUrl(postText(score), url);
    // Copy first, synchronously, while this page still has focus; then open the post composer.
    const copied = copyToClipboard(card);
    const win = window.open(intent, '_blank');
    if (win) win.opener = null;
    if (this.test) this.test.lastShare = { card, intent, opened: !!win };
    this.toast(win ? (copied ? '📋 Scorecard copied — paste it into your post' : 'Opening X…') : '📋 Scorecard copied — allow pop-ups to open X');
  }

  private takeAutoplay(roadIdToPlay: string): InputTape | null {
    const auto = this.test?.autoplay;
    if (!auto || auto.roadId !== roadIdToPlay) return null;
    this.test!.autoplay = undefined;
    return InputTape.decode(auto.tape);
  }

  /**
   * Auto-pauses when the camera loses the wand. Without this, reaching for a drink mid-run means
   * the ship keeps its last heading into a wall, and campaign mode restarts instantly, over and
   * over. Only fires once per loss so resuming by keyboard is not immediately undone.
   */
  private watchWand(): void {
    if (this.wand.state !== 'ready' || !this.wand.model) {
      this.hud.setWand('off');
      return;
    }
    this.hud.setWand(this.wand.mapper.status);
    const lost = this.wand.mapper.status === 'lost';
    if (!lost) {
      this.wandPaused = false;
      return;
    }
    if (this.wandPaused || this.screen !== 'playing' || !this.session.running) return;
    this.wandPaused = true;
    this.toast('🪄 Wand out of view — paused');
    this.togglePause();
  }

  private togglePause(): void {
    if (this.screen === 'playing' && this.session.running) {
      this.session.paused = true;
      this.show('paused');
    } else if (this.screen === 'paused') {
      this.session.paused = false;
      this.show('playing');
    }
  }

  private onRunEnd(r: RunResult): void {
    const c = this.current;
    const cfg = this.session.cfg;
    if (!c || !cfg) return;
    if (c.mode === 'campaign') {
      const id = cfg.roadId;
      const rec = (this.save.roads[id] ??= { best: Infinity, medal: 0, completions: 0, attempts: 0 });
      const par = pars[id] ?? r.time;
      const medal = medalFor(r.time, par);
      const prevBest = Number.isFinite(rec.best) && rec.completions ? rec.best : null;
      const newRecord = !prevBest || r.time < prevBest;
      rec.completions++;
      rec.attempts += this.session.attempts;
      if (newRecord) {
        // The fastest run on every road becomes the ghost.
        rec.best = r.time;
        rec.ghost = r.tape.encode();
        rec.ghostAssist = r.assist;
      }
      rec.medal = Math.max(rec.medal, medal);
      this.persist();
      const hasNext = c.road + 1 < WORLDS[c.world].roads.length || c.world + 1 < WORLDS.length;
      const def = WORLDS[c.world].roads[c.road];
      this.lastScore = {
        kind: 'road',
        roadCode: `${c.world + 1}-${c.road + 1}`,
        roadName: def.name,
        worldName: WORLDS[c.world].name,
        time: r.time,
        par,
        medal,
        fuel: r.fuel,
        oxygen: r.oxygen,
        topSpeed: r.topSpeed * 10,
        jumps: r.jumps,
        attempts: this.session.attempts,
        newRecord: newRecord && !!prevBest,
        assist: r.assist,
        wand: this.wandRun,
      };
      // The session keeps rendering the fly-out and fireworks behind the results panel.
      this.showHtml(
        S.resultsScreen({
          roadName: `${c.world + 1}-${c.road + 1} · ${WORLDS[c.world].roads[c.road].name}`,
          worldName: WORLDS[c.world].name,
          time: r.time,
          medal,
          prevBest,
          newRecord: newRecord && !!prevBest,
          par,
          hasNext,
          attempts: this.session.attempts,
          assist: r.assist,
          fuel: r.fuel,
          oxygen: r.oxygen,
          topSpeed: r.topSpeed * 10,
          jumps: r.jumps,
          ghostOn: this.settings.ghost,
        }),
        'results',
      );
      setTimeout(() => {
        this.audio.medal(medal);
        this.view.celebrate(medal * 3);
      }, 350);
    } else {
      const daily = c.mode === 'daily';
      let best: number;
      let newRecord = false;
      if (daily) {
        const rec = (this.save.daily[c.label] ??= { best: 0, attempts: 0 });
        rec.attempts++;
        if (r.distance > rec.best) {
          rec.best = r.distance;
          rec.ghost = r.tape.encode();
          rec.ghostAssist = r.assist;
          newRecord = true;
        }
        best = rec.best;
      } else {
        if (r.distance > this.save.endless.best) {
          this.save.endless.best = r.distance;
          newRecord = true;
        }
        best = this.save.endless.best;
      }
      this.persist();
      const [title, sub] = r.cause ? DEATH_TEXT[r.cause] : ['RUN OVER', ''];
      this.lastScore = { kind: 'distance', daily, label: c.label, distance: r.distance, best, time: r.time, newRecord, endedBy: title, wand: this.wandRun };
      this.leaveRun();
      this.showHtml(S.endlessResults({ daily, label: c.label, distance: r.distance, best, newRecord, cause: title, sub, time: r.time }), 'results');
    }
  }

  private loop(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const inRun = this.screen === 'playing' || this.screen === 'paused' || (this.screen === 'settings' && this.settingsReturn === 'paused');
    this.watchWand();
    if ((inRun || (this.screen === 'results' && this.session.celebrating)) && this.session.cfg) {
      this.session.update(dt);
      if (this.input.wand.active && (Math.abs(this.input.wand.steer) > 0.02 || this.input.wand.jump)) this.wandRun = true;
      this.hudPush -= dt;
      if (this.remote.count && this.hudPush <= 0) {
        this.hudPush = 0.2;
        const sh = this.session.ship;
        this.remote.broadcast({ t: 'hud', o2: sh.oxygen / sh.maxOxygen, fuel: sh.fuel / sh.maxFuel, spd: sh.vz / V_MAX, alive: sh.phase !== 'dead' });
      }
    } else {
      if (this.menuWorld < 0) this.setMenuWorld(0);
      this.menuZ += dt * 9;
      const len = getRoad(this.menuWorld, 0).length;
      if (this.menuZ > len - 60) this.menuZ = 0;
      this.view.idle(dt, this.menuZ);
    }
    requestAnimationFrame((t) => this.loop(t));
  }
}

interface NeonTestHook {
  /** Plays this encoded input tape instead of live input the next time the road starts. */
  autoplay?: { roadId: string; tape: string };
  fireworkLoad?: () => number;
  screen?: () => string;
  lastShare?: { card: string; intent: string; opened: boolean };
  /** Live wand tracking and mapping state, for the camera end-to-end check. */
  wand?: () => { state: string; steer: number; throttle: number; jump: boolean; status: string; lock: number; fps: number; cost: number; calibrated: boolean };
  /** Ship position, so a test can prove input actually reached the simulation. */
  ship?: () => { x: number; y: number; z: number; vz: number };
}

new App();
