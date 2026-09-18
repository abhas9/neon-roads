/**
 * Camera lifecycle and the per-frame tracking loop for the wand controller.
 *
 * Everything that can be tested without a browser lives in tracker/calibrate/mapping; this file
 * is the thin, unavoidably imperative shell around getUserMedia and a canvas.
 */
import { CalibrationSampler } from './calibrate';
import type { CalibrationError, CalibrationResult, Rect } from './calibrate';
import { detect, gateFor } from './tracker';
import type { Blob, Gate, WandModel } from './tracker';
import { WandMapper, poseFrom } from './mapping';
import type { WandPose } from './mapping';
import { CameraSource } from '../camera/source';
import type { CameraState } from '../camera/source';

export type WandState = CameraState;

/** Working resolution. 160x120 is 19k pixels: under a millisecond, and plenty for a 7px disc. */
const PROC_H = 120;
const MAX_PROC_W = 240;
/** Frames averaged for the tracking-lock and frame-rate readouts. */
const LOCK_WINDOW = 120;
/** Frames sampled during calibration, about half a second of holding still. */
export const CALIBRATION_FRAMES = 30;

export interface WandStats {
  fps: number;
  /** Our own per-frame tracking cost in milliseconds. */
  cost: number;
  /** Rough glass-to-callback latency in milliseconds, where the browser reports it. */
  latency: number;
  /** Fraction of recent frames where both discs were found. */
  lockRate: number;
}

export interface WandCalibration {
  model: WandModel;
  /** Pose treated as neutral: level, at the distance the player calibrated at. */
  neutral: { angle: number; sep: number };
}

const CAL_KEY = 'neon-roads-wand-v1';

export class WandInput {
  readonly mapper = new WandMapper();
  model: WandModel | null = null;
  /** Latest tracked discs, in processing-canvas pixels, for the preview overlay. */
  blobs: { a: Blob | null; b: Blob | null } = { a: null, b: null };
  pose: WandPose | null = null;
  readonly stats: WandStats = { fps: 0, cost: 0, latency: 0, lockRate: 0 };
  /** Called after every processed frame so a preview can redraw. */
  onFrame: (() => void) | null = null;
  onJump: (() => void) | null = null;

  private camera = new CameraSource({ width: 640, height: 480, frameRate: 60 });
  // Starts at 0x0 rather than the 300x150 a fresh canvas defaults to, so `width`/`height` are a
  // reliable "have we processed a frame yet" signal for the UI.
  private canvas = Object.assign(document.createElement('canvas'), { width: 0, height: 0 });
  private ctx: CanvasRenderingContext2D | null = null;
  private frame: ImageData | null = null;
  private gates: { a: Gate | null; b: Gate | null } = { a: null, b: null };
  // Ring buffer with a running sum: the readouts must not cost more than the tracking does.
  private lockHist = new Float32Array(LOCK_WINDOW);
  private lockAt = 0;
  private lockN = 0;
  private lockSum = 0;

  private sampler = new CalibrationSampler();
  private calibrating = false;
  private calFrames = 0;
  private calBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private calDone: ((r: CalibrationResult | CalibrationError) => void) | null = null;
  /** While set, coloured-pixel counts for this box are refreshed every frame for the aiming UI. */
  previewBox: Rect | null = null;

  get video(): HTMLVideoElement {
    return this.camera.video;
  }

  get state(): WandState {
    return this.camera.state;
  }

  get error(): string {
    return this.camera.error;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  get calibrationProgress(): number {
    return this.calibrating ? this.calFrames / CALIBRATION_FRAMES : 0;
  }

  async start(): Promise<boolean> {
    const ok = await this.camera.start();
    if (ok) this.camera.onFrame = (dt, latency) => this.tick(dt, latency);
    return ok;
  }

  stop(): void {
    this.camera.onFrame = null;
    this.camera.stop();
    // Anything awaiting calibration must be released, or the setup screen sticks on "Hold still".
    this.cancelCalibration();
    this.mapper.reset();
    this.blobs = { a: null, b: null };
    this.pose = null;
    this.lockSum = 0;
    this.lockN = 0;
    this.lockAt = 0;
    this.lockHist.fill(0);
  }

  private ensureCanvas(): boolean {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return false;
    // Aspect must be preserved, not clamped: blob coordinates are normalised by height, so a
    // squashed frame would quietly skew every tilt angle the tracker reports.
    let h = PROC_H;
    let w = Math.max(80, Math.round((h * vw) / vh));
    if (w > MAX_PROC_W) {
      w = MAX_PROC_W;
      h = Math.max(60, Math.round((w * vh) / vw));
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx = null;
    }
    if (!this.ctx) {
      // willReadFrequently keeps getImageData off the GPU readback path, which would otherwise
      // stall next to the game's bloom pipeline.
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    return !!this.ctx;
  }

  private tick(dt: number, latency: number): void {
    const t0 = performance.now();
    this.stats.latency = this.camera.stats.latency;
    this.stats.fps = this.camera.stats.fps;
    if (!this.ensureCanvas()) return;
    const ctx = this.ctx!;
    const w = this.canvas.width;
    const h = this.canvas.height;
    // Mirror: the player should see themselves as in a mirror, and moving right should mean right.
    ctx.setTransform(-1, 0, 0, 1, w, 0);
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.frame = ctx.getImageData(0, 0, w, h);
    const data = this.frame.data;

    if (this.calibrating) {
      this.sampler.addFrame(data, w, h, this.calBox);
      this.calFrames++;
      if (this.calFrames >= CALIBRATION_FRAMES) this.endCalibration();
    } else if (this.previewBox) {
      this.sampler.preview(data, w, h, this.previewBox);
    }

    if (this.model) {
      const found = detect(data, w, h, this.model, this.gates);
      this.blobs = found;
      this.gates = { a: gateFor(found.a, w, h), b: gateFor(found.b, w, h) };
      this.pose = found.a && found.b ? poseFrom(found.a, found.b) : null;
      const wasJumping = this.mapper.out.jump;
      this.mapper.update(this.pose, dt);
      if (this.mapper.out.jump && !wasJumping) this.onJump?.();
      this.lockSum += (this.pose ? 1 : 0) - this.lockHist[this.lockAt];
      this.lockHist[this.lockAt] = this.pose ? 1 : 0;
      this.lockAt = (this.lockAt + 1) % LOCK_WINDOW;
      this.lockN = Math.min(LOCK_WINDOW, this.lockN + 1);
      this.stats.lockRate = this.lockSum / this.lockN;
    }

    this.stats.cost = this.stats.cost * 0.9 + (performance.now() - t0) * 0.1;
    void latency;
    this.onFrame?.();
  }

  /** `box` is in processing-canvas pixels; the left half becomes disc A, the right half disc B. */
  beginCalibration(box: Rect): Promise<CalibrationResult | CalibrationError> {
    this.cancelCalibration();
    this.sampler.reset();
    this.calBox = box;
    this.calFrames = 0;
    this.calibrating = true;
    return new Promise((resolve) => {
      this.calDone = resolve;
    });
  }

  cancelCalibration(): void {
    this.calibrating = false;
    const done = this.calDone;
    this.calDone = null;
    done?.('cancelled');
  }

  private endCalibration(): void {
    this.calibrating = false;
    const res = this.sampler.finish();
    const done = this.calDone;
    this.calDone = null;
    if (typeof res !== 'string') {
      this.model = res.model;
      this.gates = { a: null, b: null };
      this.mapper.reset();
      this.mapper.neutral = { angle: 0, sep: 0 };
    }
    done?.(res);
  }

  /** Samples live pixels for the calibration preview: how much colour is currently in the box. */
  get sampleCounts(): { a: number; b: number } {
    return this.sampler.last;
  }

  /** Makes the pose being held right now the neutral. Returns false if the wand is not visible. */
  recentre(): boolean {
    if (!this.pose) return false;
    this.mapper.recentre(this.pose);
    return true;
  }

  /** Fills the shared object `Input` polls each frame. */
  read(out: { steer: number; throttle: number; jump: boolean; active: boolean }): void {
    const m = this.mapper;
    out.steer = m.out.steer;
    out.throttle = m.out.throttle;
    out.jump = m.out.jump;
    out.active = this.camera.ready && !!this.model && m.status !== 'searching';
  }

  save(): void {
    if (!this.model) return;
    try {
      const data: WandCalibration = { model: this.model, neutral: this.mapper.neutral };
      localStorage.setItem(CAL_KEY, JSON.stringify(data));
    } catch {
      // Storage unavailable; the player just recalibrates next session.
    }
  }

  /** Restores a previous session's calibration. Lighting changes, so the UI still offers a redo. */
  load(): boolean {
    try {
      const raw = localStorage.getItem(CAL_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as WandCalibration;
      if (!data?.model?.a || !data.model.b) return false;
      this.model = data.model;
      if (data.neutral) this.mapper.neutral = data.neutral;
      return true;
    } catch {
      return false;
    }
  }

  static clearSaved(): void {
    try {
      localStorage.removeItem(CAL_KEY);
    } catch {
      // Nothing to do.
    }
  }
}
