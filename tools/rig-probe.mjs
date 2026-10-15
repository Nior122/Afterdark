/**
 * Headless rig verification.
 *
 * Loads public/models/facecap.glb with three.js's own GLTFLoader (no browser
 * needed — we strip the KTX2 texture reference so only geometry is parsed), then:
 *
 *   1. prints the node hierarchy, pivots and world bounding boxes
 *   2. resolves the ARKit blendshape mapping using the app's real code
 *   3. software-renders PNGs so orientation and morph targets can be eyeballed
 *
 * Usage: node tools/rig-probe.mjs [outDir]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Renderer } from './lib/raster.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Rebuild a GLB with all texture/material-image references removed. */
function stripTextures(glbBuffer) {
  const buf = Buffer.from(glbBuffer)
  const total = buf.readUInt32LE(8)
  let offset = 12
  let json = null
  const binChunks = []
  while (offset < total) {
    const chunkLen = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    const body = buf.subarray(offset + 8, offset + 8 + chunkLen)
    if (chunkType === 0x4e4f534a) json = JSON.parse(body.toString('utf8'))
    else binChunks.push(Buffer.from(body))
    offset += 8 + chunkLen
  }
  json.images = []
  json.textures = []
  json.samplers = []
  for (const mat of json.materials ?? []) {
    if (mat.pbrMetallicRoughness) delete mat.pbrMetallicRoughness.baseColorTexture
    delete mat.normalTexture
    delete mat.occlusionTexture
    delete mat.emissiveTexture
    delete mat.extensions?.KHR_texture_transform
  }
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(
    (e) => e !== 'KHR_texture_basisu' && e !== 'KHR_texture_transform',
  )

  const jsonStr = JSON.stringify(json)
  const jsonBuf = Buffer.from(jsonStr, 'utf8')
  const jsonPad = Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)
  const binLen = binChunks.reduce((a, b) => a + b.length, 0)
  const binBuf = Buffer.concat(binChunks)
  const binPad = Buffer.alloc((4 - (binLen % 4)) % 4, 0)

  const chunks = [
    Buffer.concat([jsonBuf, jsonPad]),
    Buffer.concat([binBuf, binPad]),
  ]
  const header = Buffer.alloc(12)
  const totalLen = 12 + chunks.reduce((a, c) => a + 8 + c.length, 0)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLen, 8)

  const parts = [header]
  const types = [0x4e4f534a, 0x004e4942]
  chunks.forEach((c, i) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(c.length, 0)
    h.writeUInt32LE(types[i], 4)
    parts.push(h, c)
  })
  return Buffer.concat(parts)
}

async function loadScene(glbPath) {
  const raw = await readFile(glbPath)
  const stripped = stripTextures(raw)
  const ab = stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength)
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  return new Promise((res, rej) => {
    loader.parse(ab, '', (gltf) => res(gltf), rej)
  })
}

function heading(text) {
  console.log(`\n${text}\n${'─'.repeat(text.length)}`)
}

async function main() {
  const outDir = resolve(process.argv[2] ?? join(root, 'tools', 'out'))
  await mkdir(outDir, { recursive: true })

  const gltf = await loadScene(join(root, 'public', 'models', 'facecap.glb'))
  const scene = gltf.scene

  heading('Node hierarchy')
  const walk = (o, d = 0) => {
    const bits = []
    if (o.isMesh) {
      bits.push(`verts=${o.geometry.attributes.position.count}`)
      bits.push(`tris=${(o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3}`)
      bits.push(`morphs=${o.morphTargetInfluences?.length ?? 0}`)
      bits.push(`uv=${o.geometry.attributes.uv ? 'yes' : 'no'}`)
    }
    console.log(`${'  '.repeat(d)}${o.type}${o.name ? ` "${o.name}"` : ''}${bits.length ? ` [${bits.join(' ')}]` : ''}`)
    o.children.forEach((c) => walk(c, d + 1))
  }
  walk(scene)
  scene.updateMatrixWorld(true)

  heading('Morph target dictionary (head mesh)')
  let headMesh = null
  scene.traverse((o) => {
    if (o.isMesh && o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length > 5) headMesh = o
  })
  if (!headMesh) throw new Error('No mesh with ARKit morph targets found')
  const targetNames = Object.keys(headMesh.morphTargetDictionary)
  console.log(`${targetNames.length} targets:`)
  console.log(`  ${targetNames.join(', ')}`)

  // --- run the app's own mapping resolution -------------------------------
  const { register } = await import('node:module')
  register(new URL('../scripts/ts-loader.mjs', import.meta.url).href)
  const { resolveMapping, FACECAP_MAPPING } = await import('../src/avatar/blendshapeMap.ts')

  heading('ARKit mapping resolution')
  const { mapping, missing, coverage } = resolveMapping(headMesh.morphTargetDictionary)
  console.log(`coverage: ${(coverage * 100).toFixed(1)}%  (${52 - missing.length}/52 channels)`)
  if (missing.length) console.log(`missing : ${missing.join(', ')}`)
  const usingFacecap = Object.keys(mapping).length === Object.keys(FACECAP_MAPPING).length
  console.log(`mapping selected: ${usingFacecap ? 'FACECAP_MAPPING' : 'partial/other'}`)

  heading('World-space geometry')
  const box = new THREE.Box3()
  scene.traverse((o) => {
    if (o.isMesh) box.expandByObject(o)
  })
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  console.log(`full scene size  : ${size.x.toFixed(4)} x ${size.y.toFixed(4)} x ${size.z.toFixed(4)}`)
  console.log(`full scene center: ${center.x.toFixed(4)}, ${center.y.toFixed(4)}, ${center.z.toFixed(4)}`)

  const headBox = new THREE.Box3().setFromObject(headMesh)
  const headSize = headBox.getSize(new THREE.Vector3())
  const headCenter = headBox.getCenter(new THREE.Vector3())
  console.log(`head mesh size   : ${headSize.x.toFixed(4)} x ${headSize.y.toFixed(4)} x ${headSize.z.toFixed(4)}`)
  console.log(`head mesh center : ${headCenter.x.toFixed(4)}, ${headCenter.y.toFixed(4)}, ${headCenter.z.toFixed(4)}`)

  heading('Named pivots (world)')
  for (const name of ['head', 'teeth', 'grp_eyeLeft', 'grp_eyeRight', 'eyeLeft', 'eyeRight', 'grp_transform', 'grp_scale', 'Empty']) {
    const o = scene.getObjectByName(name)
    if (!o) {
      console.log(`  ${name.padEnd(14)} MISSING`)
      continue
    }
    const p = o.getWorldPosition(new THREE.Vector3())
    console.log(`  ${name.padEnd(14)} pos=(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`)
  }

  // --- determine which way the face points ---------------------------------
  // The nose is the point of maximum protrusion in the horizontal plane, so the
  // direction from the head's vertical axis to the farthest vertex IS the facing
  // direction. (An earlier version of this heuristic compared aggregate Z offsets
  // and got the answer exactly backwards.)
  heading('Facing-direction analysis')
  const headGeo = headMesh.geometry.attributes.position
  const hv = new THREE.Vector3()
  let nosePoint = null
  let noseDist = -1
  const axisX = headCenter.x
  const axisZ = headCenter.z
  for (let i = 0; i < headGeo.count; i++) {
    hv.fromBufferAttribute(headGeo, i).applyMatrix4(headMesh.matrixWorld)
    const dx = hv.x - axisX
    const dz = hv.z - axisZ
    const d = Math.hypot(dx, dz)
    if (d > noseDist) {
      noseDist = d
      nosePoint = { x: hv.x, y: hv.y, z: hv.z }
    }
  }
  const faceDir = new THREE.Vector3(nosePoint.x - axisX, 0, nosePoint.z - axisZ).normalize()
  const facingAngle = THREE.MathUtils.radToDeg(Math.atan2(faceDir.x, faceDir.z))
  console.log(`most protruding vertex: (${nosePoint.x.toFixed(3)}, ${nosePoint.y.toFixed(3)}, ${nosePoint.z.toFixed(3)})`)
  console.log(`head centre           : (${axisX.toFixed(3)}, ±, ${axisZ.toFixed(3)})`)
  console.log(`facing direction      : (${faceDir.x.toFixed(3)}, 0, ${faceDir.z.toFixed(3)})`)
  console.log(`=> the face points toward ${facingAngle.toFixed(1)}° about Y (0° = +Z, toward the default camera)`)
  const needsYaw = Math.abs(facingAngle) > 45
  console.log(`=> default rig yaw correction needed: ${needsYaw ? `${(facingAngle > 0 ? -facingAngle : -facingAngle).toFixed(1)}°` : 'none'}`)

  // --- renders -------------------------------------------------------------
  const W = 520
  const H = 640
  // Frame so the head fills a good part of the viewport. With a 32-degree vertical
// FOV at 3.1 units the visible height at z=0 is 2*3.1*tan(16deg) = 1.777 units,
// so this makes the head about 60% of the frame height.
  const scale = (0.60 * 1.777) / headSize.y

  /**
   * Build the transform chain for the rasteriser:
   *   yaw -> normalise scale -> recentre on the head -> the mesh's own world matrix.
   * The mesh's world matrix matters: facecap.glb's root carries a 90-degree X
   * rotation, so skipping it lays the head on its back.
   */
  const makeMatrix = (yawDeg, sceneObject, extraScale = 1) => {
    const s = scale * extraScale
    const recenter = new THREE.Matrix4().makeTranslation(-headCenter.x, -headCenter.y + 0.02, -headCenter.z)
    return new THREE.Matrix4()
      .makeRotationY(THREE.MathUtils.degToRad(yawDeg))
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(recenter)
      .multiply(sceneObject.matrixWorld)
      .toArray()
  }

  const flat = (name, yawDeg, morph = null, extraScale = 1) => {
    // Reset all influences, then apply the requested morph by name.
    headMesh.morphTargetInfluences.fill(0)
    if (morph) {
      for (const [target, value] of Object.entries(morph)) {
        const idx = headMesh.morphTargetDictionary[target]
        if (idx === undefined) throw new Error(`morph target "${target}" not found`)
        headMesh.morphTargetInfluences[idx] = value
      }
    }
    const r = new Renderer(W, H)
    r.draw({
      position: headMesh.geometry.attributes.position,
      normal: headMesh.geometry.attributes.normal,
      uv: headMesh.geometry.attributes.uv,
      index: headMesh.geometry.index,
      morphs: headMesh.geometry.morphAttributes.position,
      influences: headMesh.morphTargetInfluences,
      modelMatrix: makeMatrix(yawDeg, headMesh, extraScale),
    })
    // The eyes and teeth are separate meshes with their own pivots; include them so
    // the render shows the whole head, and so gaze/blink changes are visible.
    for (const eyeName of ['eyeLeft', 'eyeRight', 'teeth']) {
      const node = scene.getObjectByName(eyeName)
      if (!node) continue
      const m = node.isMesh ? node : node.children.find((c) => c.isMesh)
      if (!m) continue
      // Keep whatever pose the eye pivot currently has (set by the caller).
      scene.updateMatrixWorld(true)
      r.draw({
        position: m.geometry.attributes.position,
        normal: m.geometry.attributes.normal,
        uv: m.geometry.attributes.uv,
        index: m.geometry.index,
        modelMatrix: makeMatrix(yawDeg, m, extraScale),
        baseColor: eyeName === 'teeth' ? [0.88, 0.86, 0.82] : [0.72, 0.76, 0.80],
      })
    }
    const bytes = r.toPng()
    const path = join(outDir, `${name}.png`)
    return writeFile(path, bytes).then(() => console.log(`  → ${path.replace(root + '/', '')}  (${(bytes.length / 1024).toFixed(0)} KB)`))
  }

  heading('Renders')
  await flat('01-neutral-front', 0)
  await flat('02-neutral-yaw40', 40)
  await flat('03-neutral-yaw-40', -40)
  await flat('04-neutral-yaw90', 90)
  await flat('05-blink-left', 0, { eyeBlink_L: 1 })
  await flat('06-blink-right', 0, { eyeBlink_R: 1 })
  await flat('07-jaw-open', 0, { jawOpen: 1 })
  await flat('08-smile-left', 0, { mouthSmile_L: 1 })
  await flat('09-eye-look-in-left', 0, { eyeLookIn_L: 1, eyeLookIn_R: 1 })

  // Eye meshes rendered alone, to confirm they pivot correctly.
  const renderEyes = async (name, yawDeg) => {
    const r = new Renderer(W, H)
    for (const eyeName of ['eyeLeft', 'eyeRight']) {
      const eye = scene.getObjectByName(eyeName)
      if (!eye) continue
      const g = eye.isMesh ? eye : eye.children.find((c) => c.isMesh)
      if (!g) continue
      r.draw({
        position: g.geometry.attributes.position,
        normal: g.geometry.attributes.normal,
        uv: g.geometry.attributes.uv,
        index: g.geometry.index,
        modelMatrix: makeMatrix(yawDeg, g),
        baseColor: [0.20, 0.30, 0.50],
      })
    }
    const bytes = r.toPng()
    const path = join(outDir, `${name}.png`)
    await writeFile(path, bytes)
    console.log(`  → ${path.replace(root + '/', '')}  (${(bytes.length / 1024).toFixed(0)} KB)`)
  }
  await renderEyes('10-eyes-only', 0)

  console.log('\nRig probe complete.\n')
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack ?? err.message}\n`)
  process.exit(1)
})
