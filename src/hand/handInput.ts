/**
 * Camera and MediaPipe lifecycle for the hand controller.
 *
 * The thin imperative shell: everything that interprets a hand lives in gestures.ts and
 * mapping.ts, which are pure and tested without a browser. The landmark model is loaded lazily,
 * because it is ~9 MB on the wire and nobody who never opens this screen should pay for it.
 */
import { CameraSource } from '../camera/source';
import type { CameraState } from '../camera/source';
import { HandAssigner } from './gestures';
import type { HandObservation, HandPair } from './gestures';
import { HandMapper } from './mapping';

export type ModelState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The seam the end-to-end test replaces.
 *
 * A synthetic frame cannot reliably trip a real landmark model — drawing a cartoon hand proves
 * nothing — so the test injects landmarks directly and exercises everything downstream of the
 * model for real. It also keeps 9 MB of weights out of CI.
 */
export interface HandDetector {
  detect(video: HTMLVideoElement, timestampMs: number): HandObservation[];
  close?(): void;
}

export interface HandStats {
  fps: number;
  /** Landmark detection plus mapping, in milliseconds per frame. */
  cost: number;
  latency: number;
  /** Fraction of recent frames in which the flying hand was found. */
  lockRate: number;
  hands: number;
}

const LOCK_WINDOW = 90;

function assetBase(): string {
  return new URL('mediapipe/', document.baseURI).href;
}

export class HandInput {
  readonly mapper = new HandMapper();
  private camera = new CameraSource({ width: 640, height: 480, frameRate: 60 });
  private assigner = new HandAssigner();
  private detector: HandDetector | null = null;
  private loadPromise: Promise<boolean> | null = null;

  modelState: ModelState = 'idle';
  modelError = '';
  /** Model download progress, 0..1, for the loading bar. */
  progress = 0;
  pair: HandPair = { left: null, right: null };
  /** Raw skeletons for the preview overlay. */
  observations: HandObservation[] = [];
  readonly stats: HandStats = { fps: 0, cost: 0, latency: 0, lockRate: 0, hands: 0 };
  onFrame: (() => void) | null = null;

  private lockHist = new Float32Array(LOCK_WINDOW);
  private lockAt = 0;
  private lockN = 0;
  private lockSum = 0;

  get video(): HTMLVideoElement {
    return this.camera.video;
  }

  get state(): CameraState {
    return this.camera.state;
  }

  get error(): string {
    return this.camera.error || this.modelError;
  }

  get ready(): boolean {
    return this.camera.ready && this.modelState === 'ready';
  }

  /** Frame aspect, needed to keep hand geometry undistorted. */
  get aspect(): number {
    const v = this.camera.video;
    return v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 4 / 3;
  }

  /** Opens the camera first so the preview appears immediately, then loads the model behind it. */
  async start(): Promise<boolean> {
    const ok = await this.camera.start();
    if (!ok) return false;
    this.camera.onFrame = (dt, latency) => this.tick(dt, latency);
    void this.loadModel();
    return true;
  }

  async loadModel(): Promise<boolean> {
    if (this.modelState === 'ready') return true;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.openModel();
    try {
      return await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async openModel(): Promise<boolean> {
    // Test seam: an injected detector skips the model download entirely.
    const stub = (window as unknown as { __neonHandStub?: HandDetector }).__neonHandStub;
    if (stub) {
      this.detector = stub;
      this.modelState = 'ready';
      this.progress = 1;
      return true;
    }
    this.modelState = 'loading';
    this.modelError = '';
    this.progress = 0;
    try {
      const base = assetBase();
      // Dynamic import: the MediaPipe runtime must not land in the main bundle.
      const vision = await import('@mediapipe/tasks-vision');
      const buffer = await this.fetchModel(`${base}hand_landmarker.task`);
      const fileset = await vision.FilesetResolver.forVisionTasks(base);
      const landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: buffer, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      this.detector = {
        detect: (video, ts) => {
          const res = landmarker.detectForVideo(video, ts);
          return (res.landmarks ?? []).map((landmarks, i) => ({
            landmarks,
            label: res.handedness?.[i]?.[0]?.categoryName as 'Left' | 'Right' | undefined,
          }));
        },
        close: () => landmarker.close(),
      };
      this.modelState = 'ready';
      this.progress = 1;
      return true;
    } catch (e) {
      this.modelState = 'error';
      this.modelError = `Could not load hand tracking (${(e as Error)?.message ?? 'unknown error'}).`;
      return false;
    }
  }

  /** Streams the weights so the setup screen can show real progress on a ~8 MB download. */
  private async fetchModel(url: string): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`model ${res.status}`);
    const total = Number(res.headers.get('content-length') ?? 0);
    if (!res.body || !total) {
      const buf = new Uint8Array(await res.arrayBuffer());
      this.progress = 1;
      return buf;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      this.progress = Math.min(1, got / total);
    }
    const out = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  stop(): void {
    this.camera.onFrame = null;
    this.camera.stop();
    this.detector?.close?.();
    this.detector = null;
    this.modelState = 'idle';
    this.progress = 0;
    this.mapper.reset();
    this.assigner.reset();
    this.pair = { left: null, right: null };
    this.observations = [];
    this.stats.hands = 0;
    this.lockHist.fill(0);
    this.lockAt = 0;
    this.lockN = 0;
    this.lockSum = 0;
  }

  private tick(dt: number, latency: number): void {
    void latency;
    this.stats.fps = this.camera.stats.fps;
    this.stats.latency = this.camera.stats.latency;
    if (!this.detector || !this.camera.live) return;
    const t0 = performance.now();
    let observations: HandObservation[] = [];
    try {
      observations = this.detector.detect(this.camera.video, t0);
    } catch {
      // A single detection failure must not kill the loop; the next frame usually succeeds.
      observations = [];
    }
    this.observations = observations;
    this.pair = this.assigner.assign(observations, this.aspect);
    this.mapper.update(this.pair, dt);
    this.stats.hands = observations.length;

    const locked = this.mapper.raw.fly ? 1 : 0;
    this.lockSum += locked - this.lockHist[this.lockAt];
    this.lockHist[this.lockAt] = locked;
    this.lockAt = (this.lockAt + 1) % LOCK_WINDOW;
    this.lockN = Math.min(LOCK_WINDOW, this.lockN + 1);
    this.stats.lockRate = this.lockSum / this.lockN;
    this.stats.cost = this.stats.cost * 0.9 + (performance.now() - t0) * 0.1;
    this.onFrame?.();
  }

  /** Makes the pose being held right now the neutral. */
  recentre(): boolean {
    return this.mapper.recentre(this.pair);
  }

  /** Fills the shared object `Input` polls each frame. */
  read(out: { steer: number; throttle: number; jump: boolean; active: boolean }): void {
    const m = this.mapper;
    out.steer = m.out.steer;
    out.throttle = m.out.throttle;
    out.jump = m.out.jump;
    out.active = this.ready && m.status !== 'searching';
  }
}
