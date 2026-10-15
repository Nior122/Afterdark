/**
 * Render the assembled bust (scanned head + procedural neck/shoulders/hair) to PNG
 * so the procedural geometry can be judged visually rather than merely compiled.
 *
 * Usage: node tools/build-probe.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { Renderer } from './lib/raster.mjs'
import { stripTextures } from './lib/strip.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
register(new URL('../scripts/ts-loader.mjs', import.meta.url).href)

// buildHead.ts rasterises the hair mask with a 2D canvas. Node has no DOM, so
// provide the smallest possible shim. Pixel output is irrelevant here — we only
// need the topology and per-vertex scalp weights, both of which are computed in JS.
class StubContext {
  constructor() {
    this.fillStyle = '#000'
    this.filter = 'none'
    this.globalAlpha = 1
  }
  fillRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  fill() {}
  drawImage() {}
}
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => new StubContext() } : {}),
}

const { measureHead, buildNeckAndShoulders, buildHair } = await import('../src/avatar/local/buildHead.ts')

const W = 520
const H = 640
const FOV_DEG = 32
const CAMERA_Z = 3.1
const VERTICAL_EXTENT = 2 * CAMERA_Z * Math.tan(((FOV_DEG * Math.PI) / 180) / 2)

async function main() {
  const outDir = join(root, 'tools', 'out')
  await mkdir(outDir, { recursive: true })

  const ab = stripTextures(await readFile(join(root, 'public', 'models', 'facecap.glb')))
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej))
  const scene = gltf.scene
  scene.updateMatrixWorld(true)

  const headMesh = scene.getObjectByName('head').children.find((c) => c.isMesh)

  // --- measure in WORLD space ---------------------------------------------
  const m = measureHead(headMesh)
  console.log('Head metrics (WORLD space):')
  console.log(`  halfWidth  : ${m.halfWidth.toFixed(4)}`)
  console.log(`  height     : ${m.height.toFixed(4)}`)
  console.log(`  depth      : ${m.depth.toFixed(4)}`)
  console.log(`  center     : ${m.center.x.toFixed(4)}, ${m.center.y.toFixed(4)}, ${m.center.z.toFixed(4)}`)
  console.log(`  chin / crown: ${m.chinY.toFixed(4)} / ${m.crownY.toFixed(4)}`)
  console.log(`  forward    : ${m.forwardSign > 0 ? '+Z' : '-Z'}`)
  console.log(`  worldScale : ${m.worldScale.toFixed(5)}  -> real-world scale would be ${(0.235 / m.height).toFixed(4)}`)

  // --- neck + shoulders (emitted in the avatar root's space) --------------
  const bustGeo = buildNeckAndShoulders(m)
  const bbox = new THREE.Box3().setFromBufferAttribute(bustGeo.attributes.position)
  const bs = bbox.getSize(new THREE.Vector3())
  console.log(`\nBust: ${bustGeo.attributes.position.count} verts, ${bustGeo.index.count / 3} tris`)
  console.log(`  size          : ${bs.x.toFixed(3)} x ${bs.y.toFixed(3)} x ${bs.z.toFixed(3)}`)
  console.log(`  shoulder span : ${(bs.x / (2 * m.halfWidth)).toFixed(2)}x head width`)
  console.log(`  vertical drop : ${(bs.y / m.height).toFixed(2)} head-heights`)
  console.log(`  bust y range  : ${bbox.min.y.toFixed(3)} .. ${bbox.max.y.toFixed(3)}  (chin ${m.chinY.toFixed(3)}, crown ${m.crownY.toFixed(3)})`)

  // --- hair ---------------------------------------------------------------
  const hair = buildHair(headMesh, m, { fullness: 0.85 })
  // The shell is authored in the HEAD MESH's LOCAL space, so it must be parented
  // to the mesh ITSELF. Parenting it to the mesh's parent looks equivalent but is
  // not: this rig's mesh node carries its own dequantisation translation+scale
  // (KHR_mesh_quantization), and skipping that transform renders the hair a
  // factor of ~1000 too large.
  headMesh.add(hair.mesh)
  scene.updateMatrixWorld(true)
  console.log(`\nHair shell: ${hair.mesh.geometry.attributes.position.count} verts, scalpFraction=${(hair.scalpFraction * 100).toFixed(1)}%`)
  console.log(`  parented to: ${hair.mesh.parent.name || hair.mesh.parent.type}`)

  // --- framing ------------------------------------------------------------
  // Portrait crop: a little air above the crown, and the shoulders running off the
  // bottom edge. Derived from the measured head rather than hard-coded.
  const viewTop = m.crownY + 0.14 * m.height
  const viewBottom = m.chinY - 1.05 * m.height
  const viewHeight = viewTop - viewBottom
  const scale = (0.985 * VERTICAL_EXTENT) / viewHeight
  const centreY = (viewTop + viewBottom) / 2
  console.log(`\nFraming: view ${viewBottom.toFixed(3)}..${viewTop.toFixed(3)} (${viewHeight.toFixed(3)} units), scale=${scale.toFixed(4)}, centreY=${centreY.toFixed(3)}`)

  const identity = new THREE.Object3D()
  identity.updateMatrixWorld(true)

  const frame = (yawDeg, obj, extraScale = 1) => {
    const s = scale * extraScale
    return new THREE.Matrix4()
      .makeRotationY(THREE.MathUtils.degToRad(yawDeg))
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(new THREE.Matrix4().makeTranslation(-m.center.x, -centreY, -m.center.z))
      .multiply(obj.matrixWorld)
      .toArray()
  }

  const drawMesh = (r, mesh, obj, opts = {}) => {
    r.draw({
      position: mesh.geometry.attributes.position,
      normal: mesh.geometry.attributes.normal,
      uv: mesh.geometry.attributes.uv ?? null,
      index: mesh.geometry.index,
      morphs: mesh.geometry.morphAttributes.position ?? null,
      influences: mesh.morphTargetInfluences ?? null,
      modelMatrix: frame(opts.yaw ?? 0, obj),
      baseColor: opts.color,
      alpha: opts.alpha ?? null,
      alphaTest: opts.alphaTest ?? 0,
      ...(opts.lightDir ? { lightDir: opts.lightDir } : {}),
    })
  }

  const drawAll = (r, yaw, { withHair = true, morph = null } = {}) => {
    headMesh.morphTargetInfluences.fill(0)
    if (morph) {
      for (const [name, v] of Object.entries(morph)) {
        const i = headMesh.morphTargetDictionary[name]
        if (i !== undefined) headMesh.morphTargetInfluences[i] = v
      }
    }
    // Bust first (already in avatar-root space => identity object).
    drawMesh(r, { geometry: bustGeo }, identity, { yaw, color: [0.66, 0.50, 0.44] })
    // Head, with morphs.
    drawMesh(r, headMesh, headMesh, { yaw, color: [0.80, 0.64, 0.57] })
    if (withHair) {
      drawMesh(r, hair.mesh, hair.mesh, {
        yaw,
        color: [0.10, 0.075, 0.055],
        alpha: hair.coverage,
        alphaTest: 0.28,
      })
    }
    // Eyes and teeth, honouring their current pivots.
    scene.updateMatrixWorld(true)
    for (const n of ['eyeLeft', 'eyeRight', 'teeth']) {
      const node = scene.getObjectByName(n)
      if (!node) continue
      const mesh = node.isMesh ? node : node.children.find((c) => c.isMesh)
      if (!mesh) continue
      drawMesh(r, mesh, mesh, { yaw, color: n === 'teeth' ? [0.86, 0.84, 0.79] : [0.30, 0.36, 0.44] })
    }
  }

  const shots = [
    ['bust-01-front', 0, {}],
    ['bust-02-yaw40', 40, {}],
    ['bust-03-yaw-40', -40, {}],
    ['bust-04-side', 78, {}],
    ['bust-05-no-hair', 0, { withHair: false }],
    ['bust-06-smile', 0, { morph: { mouthSmile_L: 0.9, mouthSmile_R: 0.9, cheekSquint_L: 0.5, cheekSquint_R: 0.5 } }],
    ['bust-07-jawopen', 0, { morph: { jawOpen: 0.8 } }],
  ]

  console.log('\nRenders:')
  for (const [name, yaw, opts] of shots) {
    const r = new Renderer(W, H)
    drawAll(r, yaw, opts)
    const bytes = r.toPng()
    await writeFile(join(outDir, `${name}.png`), bytes)
    console.log(`  → tools/out/${name}.png  (${(bytes.length / 1024).toFixed(0)} KB)`)
  }
  console.log('\nBuild probe complete.\n')
}

main().catch((e) => {
  console.error(`\n✗ ${e.stack ?? e.message}\n`)
  process.exit(1)
})
