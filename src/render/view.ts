import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { supportBelow } from '../sim/collision';
import type { Support } from '../sim/collision';
import { ROW_D, V_MAX } from '../sim/constants';
import { Ev } from '../sim/ship';
import type { ShipState } from '../sim/ship';
import { Tile } from '../sim/types';
import type { RoadSource } from '../sim/types';
import type { WorldDef } from '../levels/worldTypes';
import { createRoadMaterial } from './roadMaterial';
import { buildRoadChunk, paletteColors } from './roadMesh';
import type { PaletteColors } from './roadMesh';
import { Sky } from './sky';
import { createShipModel } from './shipMesh';
import { Debris, Rings, Sparks, SpeedLines } from './fx';
import { buildProps } from './props';

const CHUNK = 24;
const AHEAD = 160;
const BEHIND = 8;

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0.0 },
    uVignette: { value: 0.35 },
    uFlash: { value: 0.0 },
    uFlashColor: { value: new THREE.Color('#ffffff') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAberration, uVignette, uFlash;
    uniform vec3 uFlashColor;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uAberration * 0.03;
      vec3 col = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      col *= 1.0 - uVignette * smoothstep(0.1, 0.6, r2 * 1.6);
      col = mix(col, uFlashColor, uFlash);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface ViewSettings {
  bloom: boolean;
  /** Skip the composer entirely (fast path for weak GPUs). */
  post: boolean;
  shake: boolean;
  pixelRatio: number;
}

interface ChunkEntry {
  mesh: THREE.Mesh;
  props: THREE.Object3D | null;
}

export interface FrameInfo {
  ship: ShipState;
  prev: ShipState;
  alpha: number;
  throttle: number;
  ghost: ShipState | null;
  ghostPrev: ShipState | null;
  events: number;
  dt: number;
  /** 0..1 intro swoop progress. */
  intro: number;
}

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(64, 1, 0.05, 1200);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;
  private sky = new Sky();
  private roadMat = createRoadMaterial();
  private chunks = new Map<number, ChunkEntry>();
  private road: RoadSource | null = null;
  private world: WorldDef | null = null;
  private pc: PaletteColors | null = null;
  private ship = createShipModel();
  private ghost = createShipModel({ ghost: true });
  private shadow: THREE.Mesh;
  private ghostShadow: THREE.Mesh;
  private sparks = new Sparks();
  private debris = new Debris();
  private rings = new Rings();
  private speedLines = new SpeedLines();
  private finishGate = new THREE.Group();
  private bestMarker = new THREE.Group();
  private edgeColor = new THREE.Color();
  private shake = 0;
  private fovKick = 0;
  private flash = 0;
  private time = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private sup: Support = { found: false, height: 0, tile: Tile.Normal };
  private settings: ViewSettings = { bloom: true, post: true, shake: true, pixelRatio: Math.min(window.devicePixelRatio, 2) };
  private squash = 0;
  private bloomBroken = false;
  private deathHandled = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(this.settings.pixelRatio);

    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    // No MSAA render targets: on ANGLE/Metal (Apple GPUs) a resolved multisampled half-float
    // image fed into UnrealBloomPass turns the bloom output NaN and blacks out the frame.
    // Edges are anti-aliased with SMAA instead, which avoids the driver's multisample path.
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0.6, 0.45, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(
      new BloomHealthPass(() => {
        this.bloomBroken = true;
        this.bloom.enabled = false;
        console.warn('[neon-roads] Bloom produced invalid pixels on this GPU; bloom disabled.');
      }),
    );
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new SMAAPass());
    this.composer.addPass(new OutputPass());

    this.scene.add(this.sky.mesh, this.sky.grid);
    this.scene.add(new THREE.HemisphereLight('#b9c8ff', '#301040', 1.4));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(-3, 6, 4);
    this.scene.add(sun);

    this.scene.add(this.ship.group, this.ghost.group);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: '#000000', transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const shadowTex = radialTexture();
    shadowMat.alphaMap = shadowTex;
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9).rotateX(-Math.PI / 2), shadowMat);
    this.ghostShadow = new THREE.Mesh(this.shadow.geometry, shadowMat.clone());
    this.scene.add(this.shadow, this.ghostShadow);
    this.scene.add(this.sparks.points, this.debris.group, this.rings.group, this.speedLines.lines, this.finishGate, this.bestMarker);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  applySettings(s: ViewSettings): void {
    this.settings = s;
    this.renderer.setPixelRatio(s.pixelRatio);
    this.bloom.enabled = s.bloom && !this.bloomBroken;
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.settings.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Keep the road readable in portrait by widening the vertical FOV.
    this.camera.userData.baseFov = w / h < 1 ? 82 : 64;
    this.camera.updateProjectionMatrix();
  }

  setRoad(road: RoadSource, world: WorldDef): void {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    this.road = road;
    this.world = world;
    this.pc = paletteColors(world.palette);
    this.sky.apply(world.sky);
    this.edgeColor.set(world.palette.edge);
    this.roadMat.uniforms.uEdgeColor.value.copy(this.edgeColor);
    this.roadMat.uniforms.uFogColor.value.set(world.sky.horizon).multiplyScalar(0.6);
    this.buildFinishGate();
    this.setBestMarker(null);
    this.resetRun();
  }

  resetRun(): void {
    this.sparks.clear();
    this.debris.clear();
    this.ship.group.visible = true;
    this.shake = 0;
    this.flash = 0;
    this.fovKick = 0;
    this.deathHandled = false;
    this.camPos.set(0, 6, 8);
    this.camLook.set(0, 0, -10);
  }

  /** Marker line across the road at a distance (endless best). */
  setBestMarker(row: number | null): void {
    this.bestMarker.clear();
    if (row === null) return;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd23f').multiplyScalar(2), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.4), mat);
    bar.position.set(0, 1.2, -row * ROW_D);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 0.08), mat);
    frame.position.set(0, 2.5, -row * ROW_D);
    bar.material = mat.clone();
    (bar.material as THREE.MeshBasicMaterial).opacity = 0.12;
    this.bestMarker.add(bar, frame);
  }

  private buildFinishGate(): void {
    this.finishGate.clear();
    if (!this.road || !Number.isFinite(this.road.length)) return;
    const z = -this.road.length * ROW_D;
    const col = this.edgeColor.clone().multiplyScalar(3);
    const mat = new THREE.MeshBasicMaterial({ color: col });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3, 0.12), mat);
      post.position.set(side * 3.8, 1.2, z);
      this.finishGate.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(7.72, 0.12, 0.12), mat);
    beam.position.set(0, 2.7, z);
    this.finishGate.add(beam);
    const curtain = new THREE.Mesh(
      new THREE.PlaneGeometry(7.6, 2.6),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    curtain.position.set(0, 1.35, z);
    this.finishGate.add(curtain);
  }

  private disposeChunk(c: ChunkEntry): void {
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    if (c.props) {
      this.scene.remove(c.props);
      c.props.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
  }

  private streamChunks(z: number, budget: number): void {
    if (!this.road || !this.pc || !this.world) return;
    const row = Math.floor(z / ROW_D);
    const first = Math.max(0, Math.floor((row - BEHIND) / CHUNK));
    const lastRow = Math.min(this.road.length, row + AHEAD);
    const last = Math.floor((lastRow - 1) / CHUNK);
    for (const [k, c] of this.chunks) {
      if (k < first || k > last) {
        this.disposeChunk(c);
        this.chunks.delete(k);
      }
    }
    for (let k = first; k <= last && budget > 0; k++) {
      if (this.chunks.has(k)) continue;
      const r0 = k * CHUNK;
      const r1 = Math.min(this.road.length, r0 + CHUNK);
      const geo = buildRoadChunk(this.road, r0, r1, this.pc);
      const mesh = new THREE.Mesh(geo, this.roadMat);
      const props = buildProps(this.world.props, r0, r1, this.edgeColor, hashString(this.world.id));
      this.scene.add(mesh);
      if (props) this.scene.add(props);
      this.chunks.set(k, { mesh, props });
      budget--;
    }
  }

  private placeShip(model: { group: THREE.Group }, shadow: THREE.Mesh, s: ShipState, p: ShipState, a: number, isGhost: boolean): THREE.Vector3 {
    const x = p.x + (s.x - p.x) * a;
    const y = p.y + (s.y - p.y) * a;
    const z = p.z + (s.z - p.z) * a;
    const vx = p.vx + (s.vx - p.vx) * a;
    const vy = p.vy + (s.vy - p.vy) * a;
    const hover = s.grounded ? Math.sin(this.time * 18) * 0.004 : 0;
    model.group.position.set(x, y + 0.015 + hover, -z);
    model.group.rotation.set(THREE.MathUtils.clamp(vy * 0.035, -0.35, 0.35), 0, THREE.MathUtils.clamp(-vx * 0.085, -0.45, 0.45));
    if (!isGhost) {
      const sq = this.squash;
      model.group.scale.set(1 + sq * 0.25, 1 - sq * 0.45, 1 + sq * 0.1);
    }
    if (this.road) {
      supportBelow(this.road, x, z, y + 0.01, 40, this.sup);
      shadow.visible = this.sup.found && model.group.visible;
      if (this.sup.found) {
        const gap = y - this.sup.height;
        shadow.position.set(x, this.sup.height + 0.012, -z);
        const k = Math.max(0, 1 - gap / 5);
        shadow.scale.setScalar(0.8 + gap * 0.08);
        (shadow.material as THREE.MeshBasicMaterial).opacity = (isGhost ? 0.2 : 0.6) * k;
      }
    }
    return model.group.position;
  }

  frame(f: FrameInfo): void {
    const dt = f.dt;
    this.time += dt;
    const s = f.ship;
    this.roadMat.uniforms.uTime.value = this.time;
    this.streamChunks(s.z, this.chunks.size === 0 ? 99 : 2);

    // Reactions to sim events.
    const ev = f.events;
    const shipPos = this.ship.group.position;
    if (ev & Ev.Land) {
      const k = Math.min(1, s.lastLandSpeed / 14);
      this.squash = Math.max(this.squash, 0.2 + k * 0.5);
      this.addShake(0.05 + k * 0.12);
      this.rings.spawn(new THREE.Vector3(shipPos.x, s.y + 0.02, shipPos.z), this.edgeColor, 1.2 + k, 0.45);
    }
    if (ev & Ev.Boost) {
      this.fovKick = 9;
      this.sparks.burst(shipPos, 26, 4, new THREE.Color('#5dff8a'), 0.5, 0.1);
    }
    if (ev & Ev.Supply) {
      this.rings.spawn(new THREE.Vector3(shipPos.x, s.y + 0.05, shipPos.z), new THREE.Color('#4cc9ff'), 2.2, 0.6);
      this.sparks.burst(shipPos, 30, 2.5, new THREE.Color('#61d4ff'), 0.9, 0.09, -2);
    }
    if (ev & Ev.Bump) this.addShake(0.12);
    if (s.phase === 'dead' && !this.deathHandled) {
      this.deathHandled = true;
      const p = shipPos.clone();
      if (s.cause !== 'fall' && s.cause !== 'oxygen' && s.cause !== 'fuel') {
        this.ship.group.visible = false;
        this.debris.explode(p, new THREE.Vector3(s.vx, 0, -s.vz));
        this.sparks.burst(p, 160, 9, new THREE.Color('#ff9a3c'), 1.1, 0.2, 4);
        this.sparks.burst(p, 80, 5, new THREE.Color('#ff2fb4'), 0.9, 0.16, 2);
        this.rings.spawn(p, new THREE.Color('#ff7a3c'), 5, 0.7);
        this.flash = 0.55;
        this.addShake(0.6);
      } else if (s.cause === 'fall') {
        this.flash = 0.2;
      }
    }

    this.squash *= Math.exp(-dt * 9);
    this.placeShip(this.ship, this.shadow, s, f.prev, f.alpha, false);
    if (s.phase === 'dead' && s.cause === 'fall') this.shadow.visible = false;

    this.ghost.group.visible = !!f.ghost && f.ghost.phase !== 'dead';
    this.ghostShadow.visible = false;
    if (f.ghost && f.ghostPrev && this.ghost.group.visible) this.placeShip(this.ghost, this.ghostShadow, f.ghost, f.ghostPrev, f.alpha, true);

    // Thrusters and trail.
    const thrust = s.phase === 'dead' ? 0 : Math.max(0.15, f.throttle * 0.7 + (s.vz / V_MAX) * 0.5 + (s.phase === 'finished' ? 1 : 0));
    for (const fl of this.ship.flames) {
      fl.scale.set(1, 1, thrust * (0.85 + Math.random() * 0.3));
      (fl.material as THREE.MeshBasicMaterial).opacity = 0.5 + thrust * 0.4;
    }
    if (s.phase !== 'dead' && s.vz > 2 && Math.random() < 0.9) {
      const back = new THREE.Vector3(shipPos.x + (Math.random() < 0.5 ? -0.2 : 0.2), shipPos.y + 0.07, shipPos.z + 0.45);
      this.sparks.emit(back, new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 1.5), new THREE.Color('#58d8ff').multiplyScalar(0.6), 0.35, 0.07, 3);
    }

    this.sparks.update(dt);
    this.debris.update(dt);
    this.rings.update(dt);

    // Camera.
    const speedK = s.vz / V_MAX;
    const cam = this.camera;
    const tx = shipPos.x * 0.6;
    const ty = Math.max(shipPos.y * 0.65, -2) + 1.2;
    const tz = shipPos.z + 3.0;
    const lookX = shipPos.x * 0.85;
    const lookY = shipPos.y * 0.7 + 0.25;
    const lookZ = shipPos.z - 7;
    if (s.phase === 'dead') {
      // Hold position and look at the wreck.
      this.camLook.lerp(new THREE.Vector3(shipPos.x, Math.max(shipPos.y, -3), shipPos.z), 1 - Math.exp(-dt * 3));
    } else if (s.phase === 'finished') {
      this.camLook.lerp(shipPos, 1 - Math.exp(-dt * 4));
      this.camPos.y += dt * 0.4;
    } else {
      const introK = 1 - Math.pow(1 - f.intro, 3);
      const sx = THREE.MathUtils.lerp(tx - 2.5, tx, introK);
      const sy = THREE.MathUtils.lerp(ty + 3.5, ty, introK);
      const sz = THREE.MathUtils.lerp(tz - 7, tz, introK);
      const follow = f.intro < 1 ? 1 : 1 - Math.exp(-dt * 10);
      this.camPos.x += (sx - this.camPos.x) * follow;
      this.camPos.y += (sy - this.camPos.y) * (f.intro < 1 ? 1 : 1 - Math.exp(-dt * 5));
      this.camPos.z = sz;
      this.camLook.set(lookX, lookY, lookZ);
    }
    cam.position.copy(this.camPos);
    if (this.settings.shake && this.shake > 0) {
      const a = this.shake * this.shake * 0.35;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
    }
    this.shake = Math.max(0, this.shake - dt * 1.8);
    cam.lookAt(this.camLook);
    this.fovKick *= Math.exp(-dt * 2.5);
    const baseFov = (cam.userData.baseFov as number) ?? 64;
    const fov = baseFov + speedK * 12 + (this.settings.shake ? this.fovKick : 0);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    this.roadMat.uniforms.uShip.value.set(shipPos.x, s.phase === 'dead' ? -99 : shipPos.y, shipPos.z);
    this.speedLines.update(dt, cam.position, s.phase === 'dead' ? 0 : s.vz, Math.max(0, speedK - 0.45) * 1.6);
    this.sky.update(this.time, cam);
    this.finishGate.children.forEach((c, i) => {
      if (i === 3) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.06 + 0.04 * Math.sin(this.time * 4);
    });

    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.final.uniforms.uFlash.value = this.flash;
    this.final.uniforms.uAberration.value = 0.15 + speedK * 0.5 + this.shake * 2;
    this.present(dt);
  }

  private present(dt: number): void {
    if (this.settings.post) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Static render for menus: slow flyover of the current road. */
  idle(dt: number, z: number): void {
    this.time += dt;
    this.roadMat.uniforms.uTime.value = this.time;
    this.streamChunks(z, this.chunks.size === 0 ? 99 : 2);
    this.ship.group.visible = false;
    this.ghost.group.visible = false;
    this.shadow.visible = false;
    this.ghostShadow.visible = false;
    this.camera.position.set(Math.sin(this.time * 0.15) * 2.5, 2.4 + Math.sin(this.time * 0.1) * 0.5, -z + 4);
    this.camera.lookAt(0, 0, -z - 12);
    this.roadMat.uniforms.uShip.value.set(0, -99, 0);
    this.sparks.update(dt);
    this.rings.update(dt);
    this.sky.update(this.time, this.camera);
    this.final.uniforms.uFlash.value = 0;
    this.final.uniforms.uAberration.value = 0.15;
    this.speedLines.update(dt, this.camera.position, 0, 0);
    this.present(dt);
  }

  addShake(a: number): void {
    this.shake = Math.min(1, this.shake + a);
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function radialTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#aaaaaa');
  grad.addColorStop(1, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * Safety net for driver bugs: a few frames after start, samples a small block of the
 * post-bloom buffer once and reports NaN/Inf so bloom can be switched off instead of
 * rendering a black screen.
 */
class BloomHealthPass extends Pass {
  private frame = 0;
  private readonly checkFrames = [5, 90];

  constructor(private onBroken: () => void) {
    super();
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.frame++;
    if (!this.checkFrames.includes(this.frame)) return;
    const n = 8;
    const px = new Uint16Array(n * n * 4);
    const x = Math.max(0, Math.floor(readBuffer.width / 2 - n / 2));
    const y = Math.max(0, Math.floor(readBuffer.height / 2 - n / 2));
    renderer.readRenderTargetPixels(readBuffer, x, y, n, n, px);
    for (let i = 0; i < px.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        if (!Number.isFinite(THREE.DataUtils.fromHalfFloat(px[i + c]))) {
          this.onBroken();
          return;
        }
      }
    }
  }
}
