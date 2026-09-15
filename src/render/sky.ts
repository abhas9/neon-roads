import * as THREE from 'three';
import type { SkyStyle } from '../levels/worldTypes';

const FEATURES = { planet: 0, ringed: 1, sun: 2, blackhole: 3, moon: 4, twin: 5, core: 6 } as const;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly grid: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private gridMat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uNebA: { value: new THREE.Color() },
        uNebB: { value: new THREE.Color() },
        uNebula: { value: 1 },
        uStars: { value: 1 },
        uFeature: { value: 0 },
        uFA: { value: new THREE.Color() },
        uFB: { value: new THREE.Color() },
        uFDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
        uFSize: { value: 0.3 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uTop, uHorizon, uNebA, uNebB, uFA, uFB, uFDir;
        uniform float uNebula, uStars, uFSize;
        uniform int uFeature;
        varying vec3 vDir;

        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

        vec3 stars(vec3 d, float density) {
          vec3 col = vec3(0.0);
          for (int layer = 0; layer < 2; layer++) {
            float scale = layer == 0 ? 180.0 : 420.0;
            vec3 p = d * scale;
            vec3 id = floor(p);
            float h = hash(id);
            if (h > 1.0 - 0.035 * density) {
              vec3 c = id + 0.5 + (vec3(hash(id + 3.1), hash(id + 7.7), hash(id + 1.3)) - 0.5) * 0.6;
              float dist = length(p - c);
              float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
              float b = smoothstep(0.35, 0.0, dist) * tw * (layer == 0 ? 1.4 : 0.7);
              col += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), hash(id + 9.0)) * b;
            }
          }
          return col;
        }

        void main() {
          vec3 d = normalize(vDir);
          float up = d.y;
          vec3 col = mix(uHorizon, uTop, smoothstep(-0.25, 0.6, up));
          col = mix(col, uHorizon * 0.35, smoothstep(0.0, -0.6, up));

          // Lensing: bend the lookup direction around a black hole.
          vec3 sd = d;
          float fd = dot(d, uFDir);
          if (uFeature == 3) {
            vec3 perp = normalize(d - uFDir * fd + 1e-5);
            float ang = acos(clamp(fd, -1.0, 1.0));
            float bend = uFSize * uFSize * 0.25 / max(ang, 0.02);
            sd = normalize(d - perp * bend * step(0.0, fd));
          }

          float n = fbm(sd * 2.2 + vec3(0.0, uTime * 0.004, 0.0));
          float n2 = fbm(sd * 5.0 + 11.0);
          float neb = smoothstep(0.35, 0.85, n) * uNebula;
          col += mix(uNebA, uNebB, smoothstep(0.3, 0.8, n2)) * neb * (0.35 + 0.5 * n2);
          col += stars(sd, uStars) * (1.0 - neb * 0.6);

          float ang = acos(clamp(fd, -1.0, 1.0));
          float r = ang / uFSize;
          vec3 right = normalize(cross(uFDir, vec3(0.0, 1.0, 0.0)));
          vec3 upv = cross(right, uFDir);
          vec2 q = vec2(dot(d, right), dot(d, upv)) / sin(uFSize);

          if (uFeature == 0 || uFeature == 1 || uFeature == 4 || uFeature == 5) {
            vec3 lightDir = normalize(vec3(-0.6, 0.4, 0.7));
            float glow = exp(-max(r - 1.0, 0.0) * 5.0) * 0.5;
            if (r < 1.0) {
              vec3 nrm = vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))));
              float lit = clamp(dot(nrm, lightDir), 0.0, 1.0);
              float bands = fbm(vec3(q.x * 2.0, q.y * (uFeature == 4 ? 3.0 : 14.0), 1.0));
              vec3 surf = mix(uFA, uFB, bands);
              if (uFeature == 4) surf *= 0.6 + 0.6 * smoothstep(0.4, 0.7, fbm(vec3(q * 6.0, 2.0)));
              col = surf * (0.08 + 1.1 * lit) + uFB * pow(1.0 - nrm.z, 3.0) * 0.8;
            } else {
              col += uFB * glow;
            }
            if (uFeature == 1) {
              vec2 rq = vec2(q.x, (q.y + q.x * 0.25) * 4.0);
              float rr = length(rq);
              float ring = smoothstep(1.35, 1.4, rr) * smoothstep(2.3, 2.2, rr) * (0.6 + 0.4 * sin(rr * 40.0));
              bool behind = r < 1.0 && (q.y + q.x * 0.25) > 0.0;
              if (!behind) col += uFA * ring * 0.9;
            }
            if (uFeature == 5) {
              vec2 q2 = q - vec2(2.2, -0.9);
              float r2 = length(q2) / 0.35;
              if (r2 < 1.0) col = mix(uFB, uFA, 0.4) * (0.2 + 0.8 * clamp(dot(vec3(q2 / 0.35, sqrt(1.0 - r2 * r2)), vec3(-0.6, 0.4, 0.7)), 0.0, 1.0));
            }
          } else if (uFeature == 2) {
            float corona = fbm(vec3(q * 3.0, uTime * 0.05));
            col += uFA * exp(-max(r - 1.0, 0.0) * (3.5 - corona)) * 0.55;
            if (r < 1.0) col = mix(uFB, uFA, fbm(vec3(q * 5.0, uTime * 0.1)) + q.y * 0.6) * 1.15;
          } else if (uFeature == 3) {
            float disk = length(vec2(q.x, q.y * 3.2));
            float acc = smoothstep(1.2, 1.5, disk) * smoothstep(3.4, 1.8, disk);
            float swirl = 0.6 + 0.4 * sin(atan(q.y * 3.2, q.x) * 6.0 - uTime * 1.5 + disk * 5.0);
            col += mix(uFA, uFB, smoothstep(1.5, 3.0, disk)) * acc * swirl * 1.2;
            col += uFA * exp(-abs(r - 1.05) * 12.0) * 0.9;
            if (r < 1.0) col = vec3(0.0);
          } else if (uFeature == 6) {
            float pulse = 0.8 + 0.2 * sin(uTime * 2.0);
            float rays = pow(abs(sin(atan(q.y, q.x) * 8.0 + uTime * 0.3)), 8.0);
            col += uFA * exp(-max(r - 0.6, 0.0) * 3.0) * pulse * 0.45;
            col += uFB * rays * exp(-r * 1.2) * 0.25;
            if (r < 0.6) col = mix(uFB, vec3(1.0), 0.35) * 0.85;
          }

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;

    this.gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color() }, uOffset: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        varying float vDist;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vPos = w.xz;
          vDist = length(w.xz - cameraPosition.xz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vPos;
        varying float vDist;
        void main() {
          vec2 g = abs(fract(vPos / 8.0) - 0.5) / fwidth(vPos / 8.0);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float fade = smoothstep(420.0, 60.0, vDist);
          gl_FragColor = vec4(uColor * 1.5, line * fade * 0.55 * uOpacity);
          #include <colorspace_fragment>
        }
      `,
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), this.gridMat);
    this.grid.position.y = -40;
    this.grid.frustumCulled = false;
  }

  apply(s: SkyStyle): void {
    const u = this.mat.uniforms;
    u.uTop.value.set(s.top);
    u.uHorizon.value.set(s.horizon);
    u.uNebA.value.set(s.nebulaA);
    u.uNebB.value.set(s.nebulaB);
    u.uNebula.value = s.nebula;
    u.uStars.value = s.stars;
    u.uFeature.value = FEATURES[s.feature];
    u.uFA.value.set(s.featureColorA);
    u.uFB.value.set(s.featureColorB);
    const az = THREE.MathUtils.degToRad(s.featureDir[0]);
    const el = THREE.MathUtils.degToRad(s.featureDir[1]);
    u.uFDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    u.uFSize.value = s.featureSize;
    this.grid.visible = s.grid;
    this.gridMat.uniforms.uColor.value.set(s.gridColor);
  }

  update(time: number, camera: THREE.Camera): void {
    this.mat.uniforms.uTime.value = time;
    this.mesh.position.copy(camera.position);
    this.grid.position.x = Math.round(camera.position.x / 8) * 8;
    this.grid.position.z = Math.round(camera.position.z / 8) * 8;
  }
}
