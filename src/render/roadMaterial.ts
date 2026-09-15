import * as THREE from 'three';

export function createRoadMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uEdgeColor: { value: new THREE.Color('#ff4fd8') },
      uFogColor: { value: new THREE.Color('#05010f') },
      uFogNear: { value: 60 },
      uFogFar: { value: 150 },
      uDrawIn: { value: new THREE.Vector2(95, 150) },
      uShip: { value: new THREE.Vector3() },
      uLightDir: { value: new THREE.Vector3(0.35, 0.9, 0.45).normalize() },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float aTile;
      attribute vec4 aEdge;
      uniform vec2 uDrawIn;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec2 vUv;
      varying vec4 vEdge;
      varying float vTile;
      varying vec3 vWorld;
      varying float vDist;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float dist = length(world.xz - cameraPosition.xz);
        float k = smoothstep(uDrawIn.x, uDrawIn.y, dist);
        world.y -= k * k * 18.0;
        vColor = color;
        vNormal = normal;
        vUv = uv;
        vEdge = aEdge;
        vTile = aTile;
        vWorld = world.xyz;
        vDist = dist;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uEdgeColor;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform vec3 uShip;
      uniform vec3 uLightDir;
      uniform float uFade;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec2 vUv;
      varying vec4 vEdge;
      varying float vTile;
      varying vec3 vWorld;
      varying float vDist;

      float edgeLine(float d, float aa) {
        return smoothstep(0.035 + aa, 0.0, d) + 0.35 * exp(-d * 18.0);
      }

      void main() {
        vec3 n = normalize(vNormal);
        float diff = max(dot(n, uLightDir), 0.0);
        float hemi = 0.5 + 0.5 * n.y;
        vec3 base = vColor * (0.28 + 0.55 * diff + 0.25 * hemi);
        vec3 emissive = vec3(0.0);

        vec2 uv = vUv;
        float aa = fwidth(uv.x) + fwidth(uv.y);
        float e = max(max(vEdge.x * edgeLine(uv.y, aa), vEdge.y * edgeLine(1.0 - uv.x, aa)),
                      max(vEdge.z * edgeLine(1.0 - uv.y, aa), vEdge.w * edgeLine(uv.x, aa)));
        vec3 edgeCol = mix(uEdgeColor, vColor * 1.6 + 0.15, 0.35);
        emissive += edgeCol * e * 1.1;

        int tile = int(vTile + 0.5);
        bool top = n.y > 0.5;
        if (tile >= 3 && top) {
          vec2 c = uv - 0.5;
          if (tile == 3) {
            float s = fract((uv.x + uv.y) * 2.0 - uTime * 1.3);
            float stripe = smoothstep(0.45, 0.5, s) * smoothstep(1.0, 0.95, s);
            float flick = 0.75 + 0.25 * sin(uTime * 9.0 + vWorld.z * 1.7);
            emissive += mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.7, 0.15), stripe) * (0.35 + stripe * 0.6) * flick;
          } else if (tile == 4) {
            float plus = step(max(abs(c.x), abs(c.y)), 0.28) * step(min(abs(c.x), abs(c.y)), 0.07);
            float pulse = 0.6 + 0.4 * sin(uTime * 4.0 - vWorld.z * 0.4);
            emissive += vec3(0.3, 0.85, 1.0) * (0.35 * pulse + plus * 1.6);
          } else if (tile == 5) {
            float ch = fract(uv.y * 2.0 - abs(c.x) * 1.4 - uTime * 2.5);
            float chev = smoothstep(0.0, 0.08, ch) * smoothstep(0.42, 0.3, ch);
            emissive += vec3(0.25, 0.9, 0.4) * (0.08 + chev * 0.75);
          } else if (tile == 6) {
            vec2 g = fract(uv * 3.0) - 0.5;
            float dots = smoothstep(0.26, 0.2, length(g));
            base *= 1.0 - dots * 0.45;
            emissive += vec3(0.35, 0.55, 0.1) * dots * (0.25 + 0.15 * sin(uTime * 2.0 + vWorld.z));
          } else if (tile == 7) {
            float s = fract((uv.x - uv.y) * 4.0);
            float line = smoothstep(0.08, 0.0, abs(s - 0.5));
            float sheen = smoothstep(0.9, 1.0, sin(vWorld.z * 0.15 + vWorld.x * 0.3 - uTime * 3.0));
            emissive += vec3(0.8, 0.9, 1.0) * (line * 0.35 + sheen * 0.5);
          }
        }

        // Neon wash under and just ahead of the ship.
        vec2 dShip = vWorld.xz - uShip.xz;
        float near = exp(-dot(dShip, dShip) * 0.35) * smoothstep(3.0, 0.0, abs(vWorld.y - uShip.y));
        emissive += edgeCol * near * 0.35 * (top ? 1.0 : 0.3);

        vec3 col = base + emissive;
        float fog = smoothstep(uFogNear, uFogFar, vDist);
        col = mix(col, uFogColor, fog);
        gl_FragColor = vec4(col * uFade, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
