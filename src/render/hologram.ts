import * as THREE from 'three';

/** Additive "hologram" surface: fresnel rim, drifting scanlines, flicker and occasional glitch jitter. */
export function createHologramMaterial(color = '#5ff8ff'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vViewNormal;
      varying vec3 vViewPos;
      varying float vWorldY;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        // Brief horizontal glitch slices a few times per second.
        float slice = floor(uTime * 14.0);
        float glitch = step(0.93, hash(slice)) * (hash(slice + floor(world.y * 40.0)) - 0.5) * 0.06;
        world.x += glitch;
        vec4 view = viewMatrix * world;
        vViewPos = view.xyz;
        vViewNormal = normalize(normalMatrix * normal);
        vWorldY = world.y;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vViewNormal;
      varying vec3 vViewPos;
      varying float vWorldY;
      void main() {
        vec3 n = normalize(vViewNormal);
        vec3 v = normalize(-vViewPos);
        float fresnel = pow(1.0 - abs(dot(n, v)), 2.2);
        float scan = 0.55 + 0.45 * sin(vWorldY * 140.0 - uTime * 9.0);
        float band = smoothstep(0.0, 0.08, fract(vWorldY * 3.0 - uTime * 0.8)) * 0.35 + 0.65;
        float flicker = 0.85 + 0.15 * sin(uTime * 37.0) * sin(uTime * 13.0);
        float a = (0.1 + fresnel * 0.95) * scan * band * flicker * uOpacity;
        gl_FragColor = vec4(uColor * (0.5 + fresnel * 1.6) * a, a);
      }
    `,
  });
}

/** Canvas-texture sprite used for the ghost's floating time label. */
export class HoloLabel {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private text = '';

  constructor() {
    this.canvas.width = 512;
    this.canvas.height = 96;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(1.5, 0.28, 1);
    this.sprite.visible = false;
  }

  set(text: string | null): void {
    if (!text) {
      this.sprite.visible = false;
      this.text = '';
      return;
    }
    this.sprite.visible = true;
    if (text === this.text) return;
    this.text = text;
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 96);
    g.font = "700 54px 'Orbitron', 'Rajdhani', system-ui, sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#2ff3ff';
    g.shadowBlur = 18;
    g.fillStyle = '#bffcff';
    g.fillText(text, 256, 50);
    this.texture.needsUpdate = true;
  }
}
