// Stages the MediaPipe hand-tracking runtime into public/mediapipe/ so the deployed site serves
// it itself, rather than depending on a CDN that can disappear or be blocked.
//
// The WebAssembly ships inside the npm package and is only copied; the model weights are not on
// npm, so they are downloaded once and cached. Both are gitignored: ~20MB of binaries do not
// belong in the repo's history. Runs automatically before `npm run dev` and `npm run build`.
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const out = 'public/mediapipe';
// Resolved by path rather than require.resolve: the package's "exports" map deliberately hides
// both package.json and the wasm directory from module resolution.
const wasmDir = join('node_modules', '@mediapipe', 'tasks-vision', 'wasm');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_MIN_BYTES = 5_000_000;
// Both SIMD and non-SIMD builds are staged; the browser fetches whichever one it can run.
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const size = async (p) => (await stat(p).catch(() => null))?.size ?? 0;

await mkdir(out, { recursive: true });

let copied = 0;
for (const f of WASM_FILES) {
  const src = join(wasmDir, f);
  const dst = join(out, f);
  const want = await size(src);
  if (!want) {
    console.error(`[mediapipe] missing ${src} — run npm install`);
    process.exit(1);
  }
  if ((await size(dst)) === want) continue;
  await copyFile(src, dst);
  copied++;
}

const model = join(out, 'hand_landmarker.task');
const have = await size(model);
if (have < MODEL_MIN_BYTES) {
  console.log('[mediapipe] downloading hand landmarker model…');
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`[mediapipe] model download failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MODEL_MIN_BYTES) {
    console.error(`[mediapipe] model download looks truncated (${buf.length} bytes)`);
    process.exit(1);
  }
  await writeFile(model, buf);
  console.log(`[mediapipe] model staged (${(buf.length / 1e6).toFixed(1)} MB)`);
}

console.log(`[mediapipe] ready in ${out}${copied ? ` (${copied} runtime file(s) copied)` : ''}`);
