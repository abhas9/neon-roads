/** WebAudio engine: synthesized SFX, a speed-reactive engine hum, and a procedural music sequencer. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private engine: { osc1: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private music: MusicSequencer | null = null;
  private volumes = { music: 0.55, sfx: 0.8 };
  private pendingTheme: { theme: number; intensity: number } | null = null;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.setVolumes(this.volumes.music, this.volumes.sfx);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.music = new MusicSequencer(ctx, this.musicBus, this.noise);
    if (this.pendingTheme) this.music.play(this.pendingTheme.theme, this.pendingTheme.intensity);
  }

  setVolumes(music: number, sfx: number): void {
    this.volumes = { music, sfx };
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx * 0.9, this.ctx.currentTime, 0.05);
  }

  playMusic(theme: number, intensity: number): void {
    this.pendingTheme = { theme, intensity };
    this.music?.play(theme, intensity);
  }

  setMusicIntensity(intensity: number): void {
    if (this.pendingTheme) this.pendingTheme.intensity = intensity;
    this.music?.setIntensity(intensity);
  }

  /** Engine hum follows speed and throttle; pass alive=false to silence. */
  updateEngine(speed01: number, throttle: number, alive: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.engine) {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(this.sfxBus);
      osc1.start();
      osc2.start();
      this.engine = { osc1, osc2, filter, gain };
    }
    const t = ctx.currentTime;
    const e = this.engine;
    e.osc1.frequency.setTargetAtTime(42 + speed01 * 70, t, 0.05);
    e.osc2.frequency.setTargetAtTime(42.7 + speed01 * 70.5, t, 0.05);
    e.filter.frequency.setTargetAtTime(180 + speed01 * 900 + Math.max(0, throttle) * 500, t, 0.05);
    e.gain.gain.setTargetAtTime(alive ? 0.035 + speed01 * 0.05 + Math.max(0, throttle) * 0.02 : 0, t, alive ? 0.05 : 0.15);
  }

  private env(g: GainNode, t: number, a: number, peak: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseHit(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  jump(): void {
    this.tone('triangle', 260, 720, 0.16, 0.18);
    this.noiseHit(0.12, 0.05, 'highpass', 3000, 6000);
  }
  land(strength: number): void {
    this.noiseHit(0.14, 0.08 + strength * 0.2, 'lowpass', 900, 120);
    this.tone('sine', 110, 50, 0.12, 0.12 + strength * 0.2);
  }
  bump(): void {
    this.tone('square', 90, 50, 0.1, 0.12);
  }
  boost(): void {
    this.noiseHit(0.5, 0.2, 'bandpass', 400, 4000);
    this.tone('sawtooth', 180, 900, 0.35, 0.08);
  }
  sticky(): void {
    this.tone('sawtooth', 160, 60, 0.25, 0.08);
    this.noiseHit(0.25, 0.08, 'lowpass', 600, 200);
  }
  supply(): void {
    [0, 4, 7, 12].forEach((s, i) => this.tone('triangle', 660 * Math.pow(2, s / 12), 660 * Math.pow(2, s / 12), 0.12, 0.1, i * 0.05));
  }
  assist(): void {
    this.tone('square', 880, 880, 0.05, 0.05);
    this.tone('square', 1320, 1320, 0.06, 0.05, 0.05);
  }
  crash(): void {
    this.noiseHit(1.4, 0.7, 'lowpass', 3000, 60);
    this.tone('sine', 90, 28, 0.9, 0.6);
    this.noiseHit(0.3, 0.3, 'highpass', 2000, 800);
  }
  fall(): void {
    this.tone('sine', 900, 120, 1.1, 0.14);
  }
  fail(): void {
    this.tone('square', 330, 300, 0.18, 0.08);
    this.tone('square', 247, 220, 0.3, 0.08, 0.18);
  }
  finish(): void {
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone('triangle', 392 * Math.pow(2, s / 12), 392 * Math.pow(2, s / 12), 0.25, 0.12, i * 0.07));
  }
  medal(level: number): void {
    for (let i = 0; i < level; i++) this.tone('sine', 1046 * Math.pow(2, (i * 5) / 12), 1046 * Math.pow(2, (i * 5) / 12), 0.3, 0.12, 0.15 * i);
  }
  fireworkLaunch(): void {
    this.tone('sine', 520 + Math.random() * 200, 1500 + Math.random() * 500, 0.7, 0.025);
    this.noiseHit(0.5, 0.03, 'highpass', 4000, 8000);
  }
  fireworkBurst(strength: number): void {
    this.noiseHit(0.9, 0.22 * strength, 'lowpass', 1800, 90);
    this.tone('sine', 70, 34, 0.5, 0.25 * strength);
    // Crackle tail.
    for (let i = 0; i < 7; i++) this.noiseHit(0.05, 0.05, 'highpass', 5000, 3000, 0.25 + Math.random() * 0.6);
  }
  ui(kind: 'move' | 'confirm' | 'back'): void {
    if (kind === 'move') this.tone('square', 1200, 1200, 0.025, 0.03);
    else if (kind === 'confirm') {
      this.tone('square', 880, 880, 0.04, 0.05);
      this.tone('square', 1760, 1760, 0.06, 0.05, 0.04);
    } else this.tone('square', 660, 440, 0.07, 0.05);
  }
  beep(high: boolean): void {
    this.tone('sine', high ? 1320 : 880, high ? 1320 : 880, high ? 0.3 : 0.12, 0.15);
  }
  warn(): void {
    this.tone('square', 740, 740, 0.08, 0.05);
  }
}

interface Theme {
  bpm: number;
  root: number;
  scale: number[];
  prog: number[];
  seed: number;
  arpStyle: number;
  swing: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MIXO = [0, 2, 4, 5, 7, 9, 10];

/** Theme presets: generic modal progressions; every melody is generated from the seed. */
const THEMES: Theme[] = [
  { bpm: 112, root: 45, scale: MINOR, prog: [0, 5, 2, 6], seed: 11, arpStyle: 0, swing: 0 },
  { bpm: 124, root: 40, scale: PHRYGIAN, prog: [0, 1, 0, 6], seed: 23, arpStyle: 1, swing: 0 },
  { bpm: 96, root: 48, scale: LYDIAN, prog: [0, 1, 4, 3], seed: 37, arpStyle: 2, swing: 0.08 },
  { bpm: 128, root: 43, scale: DORIAN, prog: [0, 3, 6, 4], seed: 41, arpStyle: 0, swing: 0 },
  { bpm: 88, root: 38, scale: MINOR, prog: [0, 6, 5, 4], seed: 59, arpStyle: 2, swing: 0.12 },
  { bpm: 118, root: 46, scale: MIXO, prog: [0, 6, 3, 0], seed: 67, arpStyle: 1, swing: 0 },
  { bpm: 136, root: 41, scale: MINOR, prog: [0, 2, 5, 4], seed: 71, arpStyle: 0, swing: 0 },
  { bpm: 104, root: 47, scale: DORIAN, prog: [0, 4, 3, 1], seed: 83, arpStyle: 2, swing: 0.05 },
  { bpm: 120, root: 42, scale: PHRYGIAN, prog: [0, 6, 1, 5], seed: 97, arpStyle: 1, swing: 0 },
  { bpm: 140, root: 44, scale: MINOR, prog: [0, 5, 6, 4], seed: 101, arpStyle: 0, swing: 0 },
  { bpm: 100, root: 45, scale: LYDIAN, prog: [0, 4, 5, 3], seed: 7, arpStyle: 2, swing: 0.06 },
];

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

class MusicSequencer {
  private theme: Theme = THEMES[0];
  private themeIndex = -1;
  private intensity = 0.5;
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private out: GainNode;
  private delay: DelayNode;
  private melody: number[] = [];
  private bassPattern: number[] = [];
  private arpPattern: number[] = [];

  constructor(private ctx: AudioContext, bus: GainNode, private noise: AudioBuffer) {
    this.out = ctx.createGain();
    this.out.connect(bus);
    this.delay = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 2500;
    this.delay.connect(fb).connect(lp).connect(this.delay);
    this.delay.connect(wet).connect(this.out);
  }

  play(index: number, intensity: number): void {
    this.intensity = intensity;
    const i = ((index % THEMES.length) + THEMES.length) % THEMES.length;
    if (i === this.themeIndex) return;
    this.themeIndex = i;
    this.theme = THEMES[i];
    this.delay.delayTime.value = (60 / this.theme.bpm) * 0.75;
    const rnd = mulberry(this.theme.seed);
    this.melody = Array.from({ length: 32 }, () => (rnd() < 0.45 ? -99 : Math.floor(rnd() * 8)));
    this.bassPattern = Array.from({ length: 16 }, (_, k) => (k % 4 === 0 ? 0 : rnd() < 0.6 ? (rnd() < 0.3 ? 12 : 0) : -99));
    this.arpPattern = Array.from({ length: 16 }, (_, k) => [0, 1, 2, 1, 0, 2, 1, 3][(k + (this.theme.arpStyle === 1 ? k >> 2 : 0)) % 8]);
    this.step = 0;
    if (!this.timer) {
      this.nextTime = this.ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
  }

  setIntensity(v: number): void {
    this.intensity = v;
  }

  private schedule(): void {
    const spb = 60 / this.theme.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      const swing = this.step % 2 === 1 ? this.theme.swing * spb : 0;
      this.playStep(this.step, this.nextTime + swing, spb);
      this.nextTime += spb;
      this.step++;
    }
  }

  private chordNotes(bar: number): number[] {
    const th = this.theme;
    const deg = th.prog[bar % th.prog.length];
    const sc = th.scale;
    const n = (d: number) => th.root + 12 + sc[d % 7] + 12 * Math.floor(d / 7);
    return [n(deg), n(deg + 2), n(deg + 4), n(deg + 6)];
  }

  private playStep(step: number, t: number, spb: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const section = Math.floor(bar / 8) % 4;
    const chord = this.chordNotes(bar);
    const I = this.intensity;

    if (s16 === 0) this.pad(chord, t, spb * 16, 0.05 + 0.03 * (1 - I));

    const drums = I > 0.25 && section !== 0;
    if (drums) {
      if (s16 % 4 === 0) this.kick(t);
      if (s16 === 4 || s16 === 12) this.snare(t);
      if (s16 % 2 === 0 || (I > 0.7 && s16 % 1 === 0)) this.hat(t, s16 % 4 === 2 ? 0.05 : 0.025);
    }

    const bn = this.bassPattern[s16];
    if (bn !== -99 && (I > 0.15 || s16 % 8 === 0)) this.bass(chord[0] - 24 + bn, t, spb * 0.9);

    if (section !== 3 || I > 0.6) {
      const an = chord[this.arpPattern[s16]] + (this.theme.arpStyle === 2 && s16 % 8 >= 4 ? 12 : 0);
      if (this.theme.arpStyle !== 2 || s16 % 2 === 0) this.pluck(an + 12, t, spb * 0.8, 0.04);
    }

    if (section === 2 && I > 0.35) {
      const m = this.melody[(step % 32 + 32) % 32];
      if (m !== -99 && step % 2 === 0) {
        const th = this.theme;
        const note = th.root + 24 + th.scale[m % 7] + 12 * Math.floor(m / 7);
        this.lead(note, t, spb * 1.8);
      }
    }
  }

  private voice(type: OscillatorType, freq: number, t: number, dur: number, vol: number, cutoff: number, attack = 0.005, dest: AudioNode = this.out, detune = 0): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(cutoff * 0.25, 80), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(chord: number[], t: number, dur: number, vol: number): void {
    for (const n of chord.slice(0, 3)) {
      this.voice('sawtooth', midi(n), t, dur, vol * 0.5, 900, dur * 0.3, this.out, -8);
      this.voice('sawtooth', midi(n), t, dur, vol * 0.5, 900, dur * 0.3, this.out, 8);
    }
  }
  private bass(n: number, t: number, dur: number): void {
    this.voice('sawtooth', midi(n), t, dur, 0.16, 700);
    this.voice('square', midi(n - 12), t, dur, 0.06, 300);
  }
  private pluck(n: number, t: number, dur: number, vol: number): void {
    this.voice('square', midi(n), t, dur, vol, 2600, 0.003, this.out);
    this.voice('square', midi(n), t, dur, vol * 0.6, 2600, 0.003, this.delay);
  }
  private lead(n: number, t: number, dur: number): void {
    this.voice('triangle', midi(n), t, dur, 0.09, 3000, 0.02, this.out);
    this.voice('sawtooth', midi(n), t, dur, 0.025, 1800, 0.02, this.delay, 6);
  }
  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.35);
  }
  private snare(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f).connect(g).connect(this.out);
    src.connect(f).connect(g).connect(this.delay);
    src.start(t, Math.random());
    src.stop(t + 0.2);
    this.voice('triangle', 190, t, 0.1, 0.12, 2000);
  }
  private hat(t: number, vol: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }
}
