/**
 * Scene assembly for the offline probes.
 *
 * Lifted out of `build-probe.mjs` unchanged, so that the realism before/after render and
 * the geometry probe frame the head identically: two renders are only comparable if the
 * camera, the crop and the morph state are provably the same code.
 *
 * There is no browser in this environment, so this builds the *real* geometry by calling
 * the app's own `buildHead.ts` under Node — the neck/shoulders/hair here are the shipped
 * meshes, not a mock-up.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { stripTextures } from './strip.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
register(new URL('../../scripts/ts-loader.mjs', import.meta.url).href)

export const ROOT = root
export const W = 520
export const H = 640
const FOV_DEG = 32
const CAMERA_Z = 3.1
const VERTICAL_EXTENT = 2 * CAMERA_Z * Math.tan(((FOV_DEG * Math.PI) / 180) / 2)

/**
 * buildHead.ts rasterises the hair mask with a 2D canvas. Node has no DOM, so provide the
 * smallest possible shim. Pixel output is irrelevant here — only the topology and the
 * per-vertex scalp weights matter, and both are computed in JS.
 */
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

globalThis.document ??= {
  createElement: (tag) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => new StubContext() } : {}),
}

/** Colours the probes paint each part with, in linear space. */
export const PROBE_COLORS = {
  bust: [0.66, 0.50, 0.44],
  head: [0.80, 0.64, 0.57],
  hair: [0.10, 0.075, 0.055],
  teeth: [0.86, 0.84, 0.79],
  /** The model's iris/sclera textures are stripped offline, so eyes get a flat iris tone. */
  eye: [0.30, 0.36, 0.44],
}

/**
 * Load the scanned head, build the procedural bust, and return a `drawShot` that renders
 * one yaw/morph combination into a given Renderer.
 */
export async function loadBust() {
  const { measureHead, buildNeckAndShoulders, buildHair } = await import('../../src/avatar/local/buildHead.ts')

  const ab = stripTextures(await readFile(join(root, 'public', 'models', 'facecap.glb')))
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej))
  const scene = gltf.scene
  scene.updateMatrixWorld(true)

  const headMesh = scene.getObjectByName('head').children.find((c) => c.isMesh)
  const m = measureHead(headMesh)

  const bustGeo = buildNeckAndShoulders(m)
  const hair = buildHair(headMesh, m, { fullness: 0.85 })
  // The shell is authored in the HEAD MESH's LOCAL space, so it must be parented to the
  // mesh ITSELF. Parenting it to the mesh's parent looks equivalent but is not: this rig's
  // mesh node carries its own dequantisation translation+scale (KHR_mesh_quantization),
  // and skipping that transform renders the hair a factor of ~1000 too large.
  headMesh.add(hair.mesh)
  scene.updateMatrixWorld(true)

  // --- framing ------------------------------------------------------------
  // Portrait crop: a little air above the crown, and the shoulders running off the bottom
  // edge. Derived from the measured head rather than hard-coded.
  const viewTop = m.crownY + 0.14 * m.height
  const viewBottom = m.chinY - 1.05 * m.height
  const viewHeight = viewTop - viewBottom
  const scale = (0.985 * VERTICAL_EXTENT) / viewHeight
  const centreY = (viewTop + viewBottom) / 2

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
      modelMatrix: frame(opts.yaw ?? 0, obj, opts.zoom ?? 1),
      baseColor: opts.color,
      alpha: opts.alpha ?? null,
      alphaTest: opts.alphaTest ?? 0,
      ...(opts.lightDir ? { lightDir: opts.lightDir } : {}),
      ...(opts.shading ?? {}),
    })
  }

  /**
   * @param {object} r     a Renderer
   * @param {number} yaw   degrees
   * @param {object} opts  { withHair, morph, shading }
   *
   * `zoom` scales the framing about the head centre, for close-ups.
   *
   * `shading` is the lighting/material block handed to the rasteriser's physical path. It
   * may carry a single `material`, or a `materials` map keyed by part (bust, head, hair,
   * eye, teeth) — the head and the eyes do not respond to light the same way, and a
   * comparison that pretended they did would be hiding the very thing being compared.
   */
  const drawShot = (r, yaw, { withHair = true, morph = null, shading = null, zoom = 1 } = {}) => {
    headMesh.morphTargetInfluences.fill(0)
    if (morph) {
      for (const [name, v] of Object.entries(morph)) {
        const i = headMesh.morphTargetDictionary[name]
        if (i !== undefined) headMesh.morphTargetInfluences[i] = v
      }
    }
    const forPart = (part) => {
      if (!shading) return {}
      const material = shading.materials?.[part] ?? shading.material
      // A material may carry its own `albedo`: the app's skin is a texture, and the probe
      // paints flat colour, so the flat colour has to be a plausible skin reflectance or
      // the render is comparing lighting on chalk.
      const albedo = material?.albedo ? { color: material.albedo } : {}
      return { shading: { ...shading, materials: undefined, material }, zoom, ...albedo }
    }
    // Bust first (already in avatar-root space => identity object).
    drawMesh(r, { geometry: bustGeo }, identity, { yaw, color: PROBE_COLORS.bust, ...forPart('bust') })
    // Head, with morphs.
    drawMesh(r, headMesh, headMesh, { yaw, color: PROBE_COLORS.head, ...forPart('head') })
    if (withHair) {
      drawMesh(r, hair.mesh, hair.mesh, {
        yaw,
        color: PROBE_COLORS.hair,
        alpha: hair.coverage,
        alphaTest: 0.28,
        ...forPart('hair'),
      })
    }
    // Eyes and teeth, honouring their current pivots.
    scene.updateMatrixWorld(true)
    for (const n of ['eyeLeft', 'eyeRight', 'teeth']) {
      const node = scene.getObjectByName(n)
      if (!node) continue
      const mesh = node.isMesh ? node : node.children.find((c) => c.isMesh)
      if (!mesh) continue
      drawMesh(r, mesh, mesh, {
        yaw,
        color: n === 'teeth' ? PROBE_COLORS.teeth : PROBE_COLORS.eye,
        ...forPart(n === 'teeth' ? 'teeth' : 'eye'),
      })
    }
  }

  return { m, scene, headMesh, bustGeo, hair, drawShot, drawMesh, frame }
}
