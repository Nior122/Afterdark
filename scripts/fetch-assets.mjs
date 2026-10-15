/**
 * Vendor every runtime asset the app needs, so nothing is fetched from a CDN at runtime.
 *
 * Sources of truth:
 *  - face_landmarker.task : MediaPipe Tasks bundle, Apache-2.0 (Google).
 *      sha256 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff
 *      Verified against the Git LFS object id declared by five independent mirrors.
 *  - facecap.glb : "Face Cap" scan head by Bannaflak, distributed with the MIT
 *      three.js examples. 52 ARKit blendshapes + separate eye/teeth meshes.
 *      sha256 recorded in MODEL_LICENSES.md. See that file before commercial launch.
 *  - MediaPipe WASM + Basis transcoder are copied out of node_modules at build time
 *      (they are already pinned, offline, and hash-locked by package-lock.json).
 *
 * Run with: npm run assets   (also wired to prebuild / predev)
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pub = (...p) => join(root, 'public', ...p)
const nm = (...p) => join(root, 'node_modules', ...p)

/** Assets that live in the repo (binary app assets, not build output). */
const LOCAL = [
  { dest: pub('models', 'facecap.glb'), sha256: null, min: 300_000, label: 'facecap.glb' },
  {
    dest: pub('mediapipe', 'face_landmarker.task'),
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    min: 3_700_000,
    label: 'face_landmarker.task',
  },
]

/** Copied verbatim out of installed dependencies on every build. */
const FROM_MODULES = [
  // SIMD first (preferred), then the no-SIMD fallback, plus their JS glue.
  ['@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.js'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', 'mediapipe/wasm/vision_wasm_internal.wasm'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js', 'mediapipe/wasm/vision_wasm_nosimd_internal.js'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm', 'mediapipe/wasm/vision_wasm_nosimd_internal.wasm'],
  // KTX2 / Basis Universal transcoder for the rig's scanned albedo texture.
  ['three/examples/jsm/libs/basis/basis_transcoder.js', 'basis/basis_transcoder.js'],
  ['three/examples/jsm/libs/basis/basis_transcoder.wasm', 'basis/basis_transcoder.wasm'],
  // Draco decoder. Not needed for the bundled rig (it uses meshopt), but third-party
  // provider GLBs frequently are Draco-compressed, so it ships for the photo path.
  // GLTFLoader only requests these files when it actually meets a Draco mesh, so
  // they never land on the critical path of the default experience.
  ['three/examples/jsm/libs/draco/gltf/draco_decoder.js', 'draco/draco_decoder.js'],
  ['three/examples/jsm/libs/draco/gltf/draco_decoder.wasm', 'draco/draco_decoder.wasm'],
  ['three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js', 'draco/draco_wasm_wrapper.js'],
]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const human = (n) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(2)} MB`)

async function ensureDir(p) {
  await mkdir(dirname(p), { recursive: true })
}

async function stageLocal() {
  let total = 0
  for (const asset of LOCAL) {
    if (!existsSync(asset.dest)) {
      throw new Error(
        `Missing vendored asset ${asset.label} at ${asset.dest}.\n` +
          `Run "node scripts/fetch-assets.mjs --download" to fetch it (needs GITHUB_TOKEN).`,
      )
    }
    const buf = await readFile(asset.dest)
    if (buf.length < asset.min) {
      throw new Error(`${asset.label} looks truncated (${human(buf.length)}).`)
    }
    const digest = sha256(buf)
    if (asset.sha256 && digest !== asset.sha256) {
      throw new Error(
        `${asset.label} failed integrity check.\n  expected ${asset.sha256}\n  actual   ${digest}`,
      )
    }
    total += buf.length
    console.log(`  ✓ ${asset.label.padEnd(26)} ${human(buf.length).padStart(9)}  sha256:${digest.slice(0, 16)}…`)
  }
  return total
}

async function fetchRemote() {
  // Only used to (re)acquire the two vendored binaries on a fresh clone.
  const targets = [
    {
      dest: pub('models', 'facecap.glb'),
      repo: 'mrdoob/three.js',
      path: 'examples/models/gltf/facecap.glb',
    },
    {
      dest: pub('mediapipe', 'face_landmarker.task'),
      repo: 'shreyash1234566/autiscreen',
      path: 'android/app/src/main/assets/face_landmarker.task',
    },
  ]
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  for (const t of targets) {
    if (existsSync(t.dest)) {
      console.log(`  · keeping existing ${t.dest}`)
      continue
    }
    const meta = await fetch(`https://api.github.com/repos/${t.repo}/contents/${t.path}`, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).then((r) => r.json())
    if (!meta?.sha) throw new Error(`Could not resolve ${t.repo}/${t.path}: ${JSON.stringify(meta).slice(0, 200)}`)
    const res = await fetch(`https://api.github.com/repos/${t.repo}/git/blobs/${meta.sha}`, {
      headers: { Accept: 'application/vnd.github.raw', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (!res.ok) throw new Error(`Blob fetch failed for ${t.path}: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await ensureDir(t.dest)
    await writeFile(t.dest, buf)
    console.log(`  ↓ ${t.path} → ${human(buf.length)}`)
  }
}

async function stageFromModules() {
  let total = 0
  for (const [src, relDest] of FROM_MODULES) {
    const from = nm(src)
    const to = pub(relDest)
    if (!existsSync(from)) throw new Error(`Dependency file missing: ${from} (run npm install)`)
    await ensureDir(to)
    await copyFile(from, to)
    total += (await stat(to)).size
  }
  console.log(`  ✓ mediapipe wasm + basis transcoder            ${human(total).padStart(9)}`)
  return total
}

async function main() {
  if (process.argv.includes('--download')) await fetchRemote()
  console.log('\nVendoring runtime assets into public/\n')
  const vendored = await stageLocal()
  const modules = await stageFromModules()
  console.log(
    `\nDone. ${human(vendored + modules)} of assets staged.\n` +
      `Live-mode payload is lazy + runtime-cached (see vite.config.ts workbox notes).\n`,
  )
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`)
  process.exit(1)
})
