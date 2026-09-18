/**
 * Shared webcam lifecycle for every camera-based controller.
 *
 * This exists because the second camera controller would otherwise have copied the first one's
 * teardown, re-entrancy and sizing bugs verbatim. Anything that touches getUserMedia, the video
 * element or the frame loop belongs here; anything that interprets pixels does not.
 */

export type CameraState = 'off' | 'starting' | 'denied' | 'error' | 'ready';

export interface CameraStats {
  fps: number;
  /** Rough glass-to-callback latency in milliseconds, where the browser reports it. */
  latency: number;
}

const FPS_WINDOW = 30;

export interface CameraOptions {
  width?: number;
  height?: number;
  frameRate?: number;
}

export class CameraSource {
  state: CameraState = 'off';
  error = '';
  readonly video = document.createElement('video');
  readonly stats: CameraStats = { fps: 0, latency: 0 };
  /** Called once per delivered frame with the seconds since the previous one. */
  onFrame: ((dt: number, latency: number) => void) | null = null;

  private stream: MediaStream | null = null;
  private raf = 0;
  private vfc = 0;
  private stopped = true;
  private starting: Promise<boolean> | null = null;
  private last = 0;
  private fpsHist = new Float32Array(FPS_WINDOW);
  private fpsAt = 0;
  private fpsN = 0;
  private fpsSum = 0;

  constructor(private opts: CameraOptions = {}) {}

  get ready(): boolean {
    return this.state === 'ready';
  }

  /** True once the video element is actually producing frames of a known size. */
  get live(): boolean {
    return this.state === 'ready' && this.video.videoWidth > 0;
  }

  async start(): Promise<boolean> {
    if (this.state === 'ready') return true;
    // Double-clicking an Enable button would otherwise open a second stream and a second loop.
    if (this.starting) return this.starting;
    this.starting = this.open();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async open(): Promise<boolean> {
    this.state = 'starting';
    this.error = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state = 'error';
      this.error = 'This browser has no camera access.';
      return false;
    }
    const { width = 640, height = 480, frameRate = 60 } = this.opts;
    try {
      // Every frame of camera latency is gesture latency, so a high frame rate is worth more
      // than resolution here.
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate, min: 24 }, facingMode: 'user' },
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
    this.lockSettings();
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
   * Auto-white-balance re-tunes the whole frame when something bright enters it, which shifts
   * calibrated colours. Exposure is deliberately left on auto: locking it in a dim room can pin
   * the image too dark to track at all.
   */
  private lockSettings(): void {
    const track = this.stream?.getVideoTracks()[0];
    if (!track?.applyConstraints) return;
    const advanced = [{ whiteBalanceMode: 'manual' }, { focusMode: 'continuous' }];
    void track.applyConstraints({ advanced } as MediaTrackConstraints).catch(() => {
      // Unsupported on this camera; auto modes stay on and calibration absorbs the difference.
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (this.vfc && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.vfc);
    this.vfc = 0;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.state = 'off';
    this.stats.fps = 0;
    this.fpsHist.fill(0);
    this.fpsAt = 0;
    this.fpsN = 0;
    this.fpsSum = 0;
  }

  private loop = (): void => {
    if (this.stopped) return;
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: Record<string, number>) => void) => number;
    };
    if (v.requestVideoFrameCallback) {
      this.vfc = v.requestVideoFrameCallback((now, meta) => {
        this.vfc = 0;
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

  private tick(latency: number): void {
    // A callback already in flight when stop() ran must not touch a torn-down stream.
    if (this.stopped) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(1e-4, (now - this.last) / 1000));
    this.last = now;
    this.fpsSum += 1 / dt - this.fpsHist[this.fpsAt];
    this.fpsHist[this.fpsAt] = 1 / dt;
    this.fpsAt = (this.fpsAt + 1) % FPS_WINDOW;
    this.fpsN = Math.min(FPS_WINDOW, this.fpsN + 1);
    this.stats.fps = this.fpsSum / this.fpsN;
    if (latency > 0) this.stats.latency = this.stats.latency * 0.9 + latency * 0.1;
    this.onFrame?.(dt, latency);
  }
}
