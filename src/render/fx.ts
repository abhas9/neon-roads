import * as THREE from 'three';

const MAX_SPARKS = 1400;

/** Pooled additive point particles for sparks, thruster trails and pickups. */
export class Sparks {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX_SPARKS * 3);
  private vel = new Float32Array(MAX_SPARKS * 3);
  private col = new Float32Array(MAX_SPARKS * 3);
  private life = new Float32Array(MAX_SPARKS);
  private maxLife = new Float32Array(MAX_SPARKS);
  private drag = new Float32Array(MAX_SPARKS);
  private grav = new Float32Array(MAX_SPARKS);
  private size = new Float32Array(MAX_SPARKS);
  private cursor = 0;
  private geo: THREE.BufferGeometry;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aSize;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * a * 2.0, 1.0);
        }
      `,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, life: number, size: number, drag = 1.5, gravity = 0): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_SPARKS;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.drag[i] = drag;
    this.grav[i] = gravity;
    this.size[i] = size;
  }

  burst(p: THREE.Vector3, n: number, speed: number, color: THREE.Color, life = 0.8, size = 0.12, gravity = 0, spread = new THREE.Vector3(1, 1, 1)): void {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiply(spread).multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      this.emit(p, v, color, life * (0.5 + Math.random() * 0.5), size * (0.5 + Math.random()), 1.2, gravity);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= d;
      this.vel[j + 1] = this.vel[j + 1] * d - this.grav[i] * dt;
      this.vel[j + 2] *= d;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.life[i] <= 0) this.size[i] = 0;
      else this.size[i] *= 0.985 + 0.015 * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
  }
}

/** Shards thrown out of the hull when the ship is destroyed. */
export class Debris {
  readonly group = new THREE.Group();
  private pieces: { mesh: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3 }[] = [];

  constructor() {
    const geo = new THREE.TetrahedronGeometry(0.07, 0);
    const mats = [
      new THREE.MeshStandardMaterial({ color: '#dfe6f2', metalness: 0.5, roughness: 0.4, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: '#ff2fb4', emissive: '#ff2fb4', emissiveIntensity: 2 }),
      new THREE.MeshStandardMaterial({ color: '#1b1f2e', flatShading: true }),
    ];
    for (let i = 0; i < 36; i++) {
      const mesh = new THREE.Mesh(geo, mats[i % 3]);
      mesh.visible = false;
      this.group.add(mesh);
      this.pieces.push({ mesh, v: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
  }

  explode(at: THREE.Vector3, carry: THREE.Vector3): void {
    for (const p of this.pieces) {
      p.mesh.visible = true;
      p.mesh.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.5));
      p.mesh.scale.setScalar(0.5 + Math.random() * 1.4);
      p.v.set((Math.random() - 0.5) * 9, Math.random() * 7 + 1, (Math.random() - 0.5) * 9).addScaledVector(carry, 0.35);
      p.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
    }
  }

  update(dt: number): void {
    for (const p of this.pieces) {
      if (!p.mesh.visible) continue;
      p.v.y -= 14 * dt;
      p.v.multiplyScalar(Math.exp(-0.6 * dt));
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.scale.multiplyScalar(Math.exp(-0.5 * dt));
      if (p.mesh.position.y < -30) p.mesh.visible = false;
    }
  }

  clear(): void {
    for (const p of this.pieces) p.mesh.visible = false;
  }
}

/** Expanding ring pulse (landings, supplies, explosions). */
export class Rings {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh; t: number; dur: number; scale: number }[] = [];

  constructor() {
    const geo = new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.items.push({ mesh, t: 0, dur: 1, scale: 1 });
    }
  }

  spawn(at: THREE.Vector3, color: THREE.Color, scale: number, dur: number): void {
    const it = this.items.find((i) => !i.mesh.visible) ?? this.items[0];
    it.mesh.visible = true;
    it.mesh.position.copy(at);
    (it.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    it.t = 0;
    it.dur = dur;
    it.scale = scale;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) {
        it.mesh.visible = false;
        continue;
      }
      it.mesh.scale.setScalar(0.1 + it.scale * (1 - Math.pow(1 - k, 3)));
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }
  }
}

/** Streaks around the camera that sell speed. */
export class SpeedLines {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private seeds: Float32Array;
  private count = 90;
  private mat: THREE.LineBasicMaterial;

  constructor() {
    this.pos = new Float32Array(this.count * 6);
    this.seeds = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.5 + Math.random() * 6;
      this.seeds[i * 3] = Math.cos(a) * r;
      this.seeds[i * 3 + 1] = Math.sin(a) * r * 0.6 + 1;
      this.seeds[i * 3 + 2] = Math.random() * 40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: '#bfe9ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
  }

  update(dt: number, cam: THREE.Vector3, speed: number, intensity: number): void {
    const len = 0.5 + speed * 0.12;
    for (let i = 0; i < this.count; i++) {
      let z = this.seeds[i * 3 + 2] - speed * dt * 1.6;
      if (z < -6) z += 46;
      this.seeds[i * 3 + 2] = z;
      const x = cam.x + this.seeds[i * 3];
      const y = cam.y + this.seeds[i * 3 + 1];
      const wz = cam.z - z;
      this.pos.set([x, y, wz, x, y, wz + len], i * 6);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.mat.opacity = intensity * 0.5;
  }
}
