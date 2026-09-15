import * as THREE from 'three';
import { createHologramMaterial } from './hologram';

/** Original low-poly hover racer built from code: arrow hull, twin engine pods, glass canopy. */
export interface ShipModel {
  group: THREE.Group;
  flames: THREE.Mesh[];
  hull: THREE.Mesh;
  /** Set for ghost models: the shared hologram material and wireframe edge material. */
  hologram: THREE.ShaderMaterial | null;
  edges: THREE.LineBasicMaterial | null;
}

/** Original low-poly hover racer built from code. The ghost variant renders as a hologram. */
export function createShipModel(opts: { ghost?: boolean } = {}): ShipModel {
  const group = new THREE.Group();
  const ghost = !!opts.ghost;
  const holo = ghost ? createHologramMaterial() : null;

  const hullMat = holo ?? new THREE.MeshStandardMaterial({ color: '#dfe6f2', metalness: 0.55, roughness: 0.32, flatShading: true });
  const accentMat = ghost
    ? hullMat
    : new THREE.MeshStandardMaterial({ color: '#ff2fb4', emissive: '#ff2fb4', emissiveIntensity: 1.6, flatShading: true });
  const darkMat = ghost ? hullMat : new THREE.MeshStandardMaterial({ color: '#1b1f2e', metalness: 0.7, roughness: 0.5, flatShading: true });
  const glassMat = ghost
    ? hullMat
    : new THREE.MeshStandardMaterial({ color: '#0a2c40', emissive: '#2ad4ff', emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.1, flatShading: true });

  // Hull: an arrowhead with a raised spine. Forward is -Z.
  const P = {
    nose: [0, 0.07, -0.5],
    spine: [0, 0.17, -0.02],
    tail: [0, 0.13, 0.26],
    lw: [-0.3, 0.05, 0.22],
    rw: [0.3, 0.05, 0.22],
    lm: [-0.12, 0.06, -0.1],
    rm: [0.12, 0.06, -0.1],
    belly: [0, 0.0, 0.05],
  } as Record<string, number[]>;
  const tris = [
    ['nose', 'lm', 'spine'], ['nose', 'spine', 'rm'],
    ['lm', 'lw', 'spine'], ['rm', 'spine', 'rw'],
    ['spine', 'lw', 'tail'], ['spine', 'tail', 'rw'],
    ['nose', 'belly', 'lm'], ['nose', 'rm', 'belly'],
    ['lm', 'belly', 'lw'], ['rm', 'rw', 'belly'],
    ['lw', 'belly', 'tail'], ['rw', 'tail', 'belly'],
  ];
  const pos: number[] = [];
  for (const t of tris) for (const k of t) pos.push(...P[k]);
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, hullMat);
  group.add(hull);

  // Neon trim along the wing edges.
  const trimGeo = new THREE.BoxGeometry(0.34, 0.012, 0.03);
  for (const side of [-1, 1]) {
    const trim = new THREE.Mesh(trimGeo, accentMat);
    trim.position.set(side * 0.14, 0.075, 0.07);
    trim.rotation.y = side * -0.95;
    group.add(trim);
  }

  const canopy = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), glassMat);
  canopy.scale.set(0.8, 0.55, 1.7);
  canopy.position.set(0, 0.15, -0.1);
  group.add(canopy);

  const flames: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshBasicMaterial({
    color: '#6fe7ff',
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.36, 8).rotateX(Math.PI / 2), darkMat);
    pod.position.set(side * 0.2, 0.07, 0.1);
    group.add(pod);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 6, 12), accentMat);
    ring.position.set(side * 0.2, 0.07, 0.285);
    group.add(ring);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.14), accentMat);
    fin.position.set(side * 0.2, 0.15, 0.2);
    fin.rotation.x = -0.35;
    group.add(fin);
    if (!ghost) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.4, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.2), flameMat);
      flame.position.set(side * 0.2, 0.07, 0.29);
      group.add(flame);
      flames.push(flame);
    }
  }
  let edges: THREE.LineBasicMaterial | null = null;
  if (ghost) {
    // Glowing wireframe edges give the hologram a readable silhouette at speed.
    edges = new THREE.LineBasicMaterial({ color: '#8ffcff', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    for (const m of meshes) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), edges);
      lines.position.copy(m.position);
      lines.rotation.copy(m.rotation);
      lines.scale.copy(m.scale);
      group.add(lines);
    }
  }
  return { group, flames, hull, hologram: holo, edges };
}
