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

export type WandState = 'off' | 'starting' | 'denied' | 'error' | 'ready';

/** Working resolution. 160x120 is 19k pixels: under a millisecond, and plenty for a 7px disc. */
const PROC_H = 120;
const MAX_PROC_W = 240;
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
  state: WandState = 'off';
  error = '';
  model: WandModel | null = null;
  /** Latest tracked discs, in processing-canvas pixels, for the preview overlay. */
  blobs: { a: Blob | null; b: Blob | null } = { a: null, b: null };
  pose: WandPose | null = null;
  readonly stats: WandStats = { fps: 0, cost: 0, latency: 0, lockRate: 0 };
  /** Called after every processed frame so a preview can redraw. */
  onFrame: (() => void) | null = null;
  onJump: (() => void) | null = null;

  readonly video = document.createElement('video');
  private stream: MediaStream | null = null;
  // Starts at 0x0 rather than the 300x150 a fresh canvas defaults to, so `width`/`height` are a
  // reliable "have we processed a frame yet" signal for the UI.
  private canvas = Object.assign(document.createElement('canvas'), { width: 0, height: 0 });
  private ctx: CanvasRenderingContext2D | null = null;
  private frame: ImageData | null = null;
  private gates: { a: Gate | null; b: Gate | null } = { a: null, b: null };
  private raf = 0;
  private stopped = true;
  private last = 0;
  private lockHist: number[] = [];
  private fpsHist: number[] = [];

  private sampler = new CalibrationSampler();
  private calibrating = false;
  private calFrames = 0;
  private calBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private calDone: ((r: CalibrationResult | CalibrationError) => void) | null = null;
  /** While set, coloured-pixel counts for this box are refreshed every frame for the aiming UI. */
  previewBox: Rect | null = null;

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
    if (this.state === 'ready') return true;
    this.state = 'starting';
    this.error = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state = 'error';
      this.error = 'This browser has no camera access.';
      return false;
    }
    try {
      // Low resolution at a high frame rate: every frame of camera latency is jump latency.
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, min: 24 }, facingMode: 'user' },
        audio: false,
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      this.state = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error';
      this.error =
        this.state === 'denied'
          ? 'Camera permission was blocked. Allow it in the address bar, then try again.'
          : `Could not open the camera (${name ?? 'unknown error'}).`;
      return false;
    }
    this.lockCameraSettings();
    this.video.srcObject = this.stream;
    this.video.playsInline = true;
    this.video.muted = true;
    try {
      await this.video.play();
    } catch {
      // Autoplay of a muted local stream is allowed; if it is not, the loop below still polls.
    }
    this.stopped = false;
    this.last = performance.now();
    this.state = 'ready';
    this.loop();
    return true;
  }

  /**
   * Auto-exposure and auto-white-balance re-tune the whole frame when a bright wand enters it,
   * which shifts the calibrated colours. Locking them helps where supported and is ignored where
   * it is not, which is most places.
   */
  private lockCameraSettings(): void {
    const track = this.stream?.getVideoTracks()[0];
    if (!track?.applyConstraints) return;
    const advanced = [{ exposureMode: 'manual' }, { whiteBalanceMode: 'manual' }, { focusMode: 'continuous' }];
    void track.applyConstraints({ advanced } as MediaTrackConstraints).catch(() => {
      // Unsupported on this camera; auto modes stay on and calibration absorbs the difference.
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.state = 'off';
    this.mapper.reset();
    this.blobs = { a: null, b: null };
    this.pose = null;
  }

  private loop = (): void => {
    if (this.stopped) return;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: Record<string, number>) => void) => number;
    };
    if (v.requestVideoFrameCallback) {
      v.requestVideoFrameCallback((now, meta) => {
        // presentationTime shares the performance.now() timeline, so the gap is a fair estimate
        // of how stale the pixels already are before we even look at them.
        const captured = meta.captureTime ?? meta.presentationTime ?? 0;
        this.tick(captured > 0 ? Math.max(0, now - captured) : 0);
        this.loop();
      });
    } else {
      this.raf = requestAnimationFrame(() => {
        this.tick(0);
        this.loop();
      });
    }
  };

  private ensureCanvas(): boolean {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return false;
    const w = Math.min(MAX_PROC_W, Math.max(80, Math.round((PROC_H * vw) / vh)));
    if (this.canvas.width !== w || this.canvas.height !== PROC_H) {
      this.canvas.width = w;
      this.canvas.height = PROC_H;
      this.ctx = null;
    }
    if (!this.ctx) {
      // willReadFrequently keeps getImageData off the GPU readback path, which would otherwise
      // stall next to the game's bloom pipeline.
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    return !!this.ctx;
  }

  private tick(latency: number): void {
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(1e-4, (t0 - this.last) / 1000));
    this.last = t0;
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
      this.lockHist.push(this.pose ? 1 : 0);
      if (this.lockHist.length > 120) this.lockHist.shift();
      this.stats.lockRate = this.lockHist.reduce((a, b) => a + b, 0) / this.lockHist.length;
    }

    this.fpsHist.push(1 / dt);
    if (this.fpsHist.length > 30) this.fpsHist.shift();
    this.stats.fps = this.fpsHist.reduce((a, b) => a + b, 0) / this.fpsHist.length;
    this.stats.cost = this.stats.cost * 0.9 + (performance.now() - t0) * 0.1;
    if (latency > 0) this.stats.latency = this.stats.latency * 0.9 + latency * 0.1;
    this.onFrame?.();
  }

  /** `box` is in processing-canvas pixels; the left half becomes disc A, the right half disc B. */
  beginCalibration(box: Rect): Promise<CalibrationResult | CalibrationError> {
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
    this.calDone = null;
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
    out.active = this.state === 'ready' && !!this.model && m.status !== 'searching';
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
