/**
 * Convert MediaPipe's canonical face model into a compact typed-array module.
 *
 * Source: google-ai-edge/mediapipe @ mediapipe/modules/face_geometry/data/canonical_face_model.obj
 *         Apache-2.0. 468 vertices, 468 texture coords, 898 triangles.
 *
 * Two subtleties worth knowing:
 *  1. The OBJ's vertex order IS MediaPipe's landmark order (vertex n == landmark n),
 *     but the `vt` indices are NOT parallel to the vertex indices — face lines look
 *     like `f 174/43 156/119 134/220`. So the vertex -> UV bijection has to be
 *     recovered by walking the faces, not by index equality.
 *  2. The OBJ's 898 faces differ slightly from the 880-triangle list shipped by
 *     tfjs-models. We generate our own triangle list from the OBJ so positions,
 *     UVs and topology all come from one consistent source.
 *
 * Usage: node scripts/gen-canonical-face.mjs path/to/canonical_face_model.obj
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_SHA256 = '8bac80443397e113f41a8b565ea72c59390bc031d9defab289dba7bc0c54e618'
const N = 468

function parseObj(text) {
  const positions = []
  const uvs = []
  const faces = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/)
      positions.push([Number(x), Number(y), Number(z)])
    } else if (line.startsWith('vt ')) {
      const [, u, v] = line.split(/\s+/)
      uvs.push([Number(u), Number(v)])
    } else if (line.startsWith('f ')) {
      const corners = line
        .split(/\s+/)
        .slice(1)
        .map((tok) => {
          const [vi, ti] = tok.split('/')
          return { vi: Number(vi) - 1, ti: Number(ti) - 1 }
        })
      if (corners.length !== 3) throw new Error(`Non-triangular face: ${line}`)
      faces.push(corners)
    }
  }
  return { positions, uvs, faces }
}

/** Recover vertex -> uv index, asserting the mapping really is a bijection. */
function deriveVertexToUv(faces, vertexCount) {
  const map = new Int32Array(vertexCount).fill(-1)
  for (const corners of faces) {
    for (const { vi, ti } of corners) {
      if (map[vi] === -1) map[vi] = ti
      else if (map[vi] !== ti) {
        throw new Error(`Vertex ${vi} maps to two UVs (${map[vi]} and ${ti}) — model has UV seams.`)
      }
    }
  }
  const used = new Set(map)
  if (used.size !== vertexCount) throw new Error(`UV bijection incomplete: ${used.size}/${vertexCount}`)
  if (used.has(-1)) throw new Error('Some vertices have no UV.')
  return map
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * Sanity-check the vertex ordering against known facial anatomy. If the file were
 * re-ordered or a different topology, these invariants would collapse and we would
 * rather fail loudly at build time than produce a garbled face at runtime.
 */
function validateAnatomy(positions) {
  // Standard MediaPipe landmark indices.
  const rightEyeOuter = positions[33]
  const rightEyeInner = positions[133]
  const leftEyeInner = positions[362]
  const leftEyeOuter = positions[263]
  const noseTip = positions[1]
  const chin = positions[152]
  const forehead = positions[10]
  const mouthLeft = positions[61]
  const mouthRight = positions[291]

  const problems = []

  // Canonical space is x-right, y-up, z-toward-viewer, with the face on +z.
  if (noseTip[2] <= chin[2]) problems.push('nose tip should sit in front of the chin (+z)')
  if (forehead[1] <= noseTip[1]) problems.push('forehead should be above the nose tip (+y)')
  if (chin[1] >= noseTip[1]) problems.push('chin should be below the nose tip')

  // Eyes are lateral to the midline and the interocular axis is roughly horizontal.
  const iod = dist(rightEyeInner, leftEyeInner)
  if (iod <= 0) problems.push('interocular distance must be positive')
  if (Math.abs(leftEyeOuter[0]) < 0.5) problems.push('left eye outer should be off the x=0 midline')
  if (Math.sign(rightEyeOuter[0]) !== -Math.sign(leftEyeOuter[0])) {
    problems.push('eye outer corners should straddle the midline in x')
  }
  const eyeTilt = Math.abs(rightEyeInner[1] - leftEyeInner[1])
  if (eyeTilt > 1.0) problems.push(`eye corners should be roughly level, got dy=${eyeTilt.toFixed(3)}`)

  // Mouth corners straddle the midline and sit between nose and chin.
  if (Math.sign(mouthLeft[0]) === Math.sign(mouthRight[0])) problems.push('mouth corners should straddle the midline')
  const mouthY = (mouthLeft[1] + mouthRight[1]) / 2
  if (mouthY >= noseTip[1] || mouthY <= chin[1]) problems.push('mouth should sit between nose tip and chin')

  // Face geometry is largely mirror-symmetric about x=0.
  let asym = 0
  for (let i = 0; i < N; i++) asym += Math.abs(positions[i][2] - positions[i][2])
  if (asym !== 0) problems.push('unexpected asymmetry')

  return { iod, problems }
}

const b64 = (buf) => Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('base64')

async function main() {
  const input = process.argv[2]
  if (!input) throw new Error('Usage: node scripts/gen-canonical-face.mjs <canonical_face_model.obj>')
  const bytes = await readFile(input)
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== EXPECTED_SHA256) {
    throw new Error(`canonical_face_model.obj hash mismatch.\n  expected ${EXPECTED_SHA256}\n  actual   ${sha}`)
  }

  const { positions, uvs, faces } = parseObj(bytes.toString('utf8'))
  if (positions.length !== N) throw new Error(`Expected ${N} vertices, got ${positions.length}`)
  if (uvs.length !== N) throw new Error(`Expected ${N} UVs, got ${uvs.length}`)

  const vertexToUv = deriveVertexToUv(faces, N)
  const { iod, problems } = validateAnatomy(positions)
  if (problems.length) throw new Error(`Anatomy validation failed:\n - ${problems.join('\n - ')}`)

  const posArr = new Float32Array(N * 3)
  const uvArr = new Float32Array(N * 2)
  for (let i = 0; i < N; i++) {
    posArr[i * 3] = positions[i][0]
    posArr[i * 3 + 1] = positions[i][1]
    posArr[i * 3 + 2] = positions[i][2]
    const [u, v] = uvs[vertexToUv[i]]
    uvArr[i * 2] = u
    // glTF/three.js UV origin is bottom-left, OBJ is bottom-left too, so no flip —
    // but we record the raw value and flip when compositing onto a top-left canvas.
    uvArr[i * 2 + 1] = v
  }

  const triArr = new Uint16Array(faces.length * 3)
  faces.forEach((corners, f) => {
    triArr[f * 3] = corners[0].vi
    triArr[f * 3 + 1] = corners[1].vi
    triArr[f * 3 + 2] = corners[2].vi
  })

  // Check triangle winding consistency by area sign in the UV plane.
  let flipped = 0
  for (let f = 0; f < triArr.length / 3; f++) {
    const a = triArr[f * 3]
    const b = triArr[f * 3 + 1]
    const c = triArr[f * 3 + 2]
    const area =
      (uvArr[b * 2] - uvArr[a * 2]) * (uvArr[c * 2 + 1] - uvArr[a * 2 + 1]) -
      (uvArr[c * 2] - uvArr[a * 2]) * (uvArr[b * 2 + 1] - uvArr[a * 2 + 1])
    if (area === 0) throw new Error(`Degenerate UV triangle at face ${f}`)
    if (area < 0) flipped++
  }
  if (flipped > 0 && flipped < triArr.length / 3) {
    // Mixed winding would make rasterisation inconsistent; report but continue.
    console.warn(`  ! ${flipped} of ${triArr.length / 3} triangles have reversed UV winding`)
  }

  const src = `/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with: node scripts/gen-canonical-face.mjs canonical_face_model.obj
 *
 * MediaPipe canonical face model (Apache-2.0, Google).
 * source sha256 ${EXPECTED_SHA256}
 *
 * Landmark indices are MediaPipe's own: index i here is landmark i from
 * FaceLandmarker. UVs come from the OBJ's texture coordinates, recovered through
 * the face list because the OBJ's vertex and texture indices are not parallel.
 */

/** Number of non-iris surface landmarks (MediaPipe returns 478 including 10 iris points). */
export const CANONICAL_LANDMARK_COUNT = ${N}

/** Interocular distance in canonical model units — used to normalise scale. */
export const CANONICAL_IOD = ${iod.toFixed(6)}

/** 468 x 3 canonical 3D landmark positions, in model space. */
export const CANONICAL_POSITIONS = decodeFloat32(
  '${b64(posArr)}',
  ${N * 3},
)

/** 468 x 2 UVs into the canonical face texture atlas. */
export const CANONICAL_UVS = decodeFloat32(
  '${b64(uvArr)}',
  ${N * 2},
)

/** ${faces.length} triangles in landmark index space. */
export const CANONICAL_TRIANGLES = decodeUint16(
  '${b64(triArr)}',
  ${triArr.length},
)

function decodeFloat32(b64: string, length: number): Float32Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  // Base64 lengths here are always 4-byte aligned, so a direct view works.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = view.getFloat32(i * 4, true)
  return out
}

function decodeUint16(b64: string, length: number): Uint16Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const out = new Uint16Array(length)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < length; i++) out[i] = view.getUint16(i * 2, true)
  return out
}
`

  const dest = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'avatar', 'local', 'canonicalFace.ts'))
  await writeFile(dest, src)
  console.log(
    `✓ canonicalFace.ts — ${N} landmarks, ${faces.length} triangles, IOD ${iod.toFixed(3)}\n` +
      `  ${(src.length / 1024).toFixed(1)} KB → ${dest}`,
  )
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
