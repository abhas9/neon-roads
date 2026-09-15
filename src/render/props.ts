import * as THREE from 'three';
import type { PropStyle } from '../levels/worldTypes';

function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Deterministic scenery placed beside the road for parallax, streamed with road chunks. */
export function buildProps(style: PropStyle, r0: number, r1: number, accent: THREE.Color, seed: number): THREE.Object3D | null {
  if (style === 'none') return null;
  const rng = rand(seed * 7919 + r0 * 104729 + 1);
  const group = new THREE.Group();
  const count = Math.max(1, Math.round(((r1 - r0) / 24) * (style === 'asteroids' ? 5 : 3)));
  const dummy = new THREE.Object3D();

  let geo: THREE.BufferGeometry;
  let mat: THREE.Material;
  switch (style) {
    case 'asteroids':
      geo = new THREE.IcosahedronGeometry(1, 0);
      mat = new THREE.MeshStandardMaterial({ color: '#4a4058', roughness: 0.95, flatShading: true });
      break;
    case 'pylons':
      geo = new THREE.BoxGeometry(0.6, 14, 0.6);
      mat = new THREE.MeshStandardMaterial({ color: '#141026', emissive: accent, emissiveIntensity: 0.35, flatShading: true });
      break;
    case 'rings':
      geo = new THREE.TorusGeometry(5, 0.12, 6, 40);
      mat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.6) });
      break;
    case 'shards':
      geo = new THREE.OctahedronGeometry(1, 0);
      mat = new THREE.MeshStandardMaterial({ color: '#1a2233', emissive: accent, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.2, flatShading: true });
      break;
    case 'cubes':
      geo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
      mat = new THREE.MeshStandardMaterial({ color: '#101420', emissive: accent, emissiveIntensity: 0.25, flatShading: true });
      break;
  }
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  for (let i = 0; i < count; i++) {
    const row = r0 + rng() * (r1 - r0);
    const side = rng() < 0.5 ? -1 : 1;
    const dist = 9 + rng() * 40;
    let y = (rng() - 0.6) * 30;
    let s = 0.6 + rng() * 2.5;
    dummy.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    if (style === 'pylons') {
      y = -14 - rng() * 10;
      s = 1 + rng();
      dummy.rotation.set(0, rng() * 6, 0);
    } else if (style === 'rings') {
      dummy.rotation.set(0, 0, 0);
      s = 1;
      y = 0.5;
    }
    const x = style === 'rings' ? 0 : side * dist;
    dummy.position.set(x, y, -row);
    dummy.scale.setScalar(style === 'rings' ? 1 : s);
    if (style === 'rings' && i % 2 === 1) dummy.scale.setScalar(0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  group.add(mesh);
  return group;
}
