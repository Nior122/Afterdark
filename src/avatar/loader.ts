/**
 * Turn bytes into a renderable, drivable avatar.
 *
 * Everything model-specific lives here so the rest of the app can assume a uniform
 * result: real-world scale, origin at the head, consistent materials, and a neck
 * that bends. Providers hand over GLB bytes and optional hints; this module does the
 * rest.
 */
import type { BufferGeometry, Material, Object3D } from 'three'
import {
  Box3,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Matrix4,
  Mesh as ThreeMesh,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { AvatarAsset } from './types'
import { Rig, type RigDiagnostics } from './rig'
import {
  NeckSkin,
  buildHair,
  buildNeckAndShoulders,
  createEyeMaterial,
  createFallbackMaterial,
  createSkinMaterial,
  createTeethMaterial,
  measureHead,
  type HeadMetrics,
  type HairResult,
} from './local/buildHead'
import { generateSkinTextures, findSkinTone } from './local/skinTexture'
import { AppError, devLog, warn } from '../lib/util'
import { HEAD_HEIGHT_METRES } from './constants'

// Re-exported so existing call sites keep working; the value itself lives in a leaf
// module so importing it does not pull the loader (and three.js) into a bundle.
export { HEAD_HEIGHT_METRES } from './constants'

let sharedLoader: { gltf: GLTFLoader; draco: DRACOLoader; ktx2: KTX2Loader } | null = null

/**
 * Loaders are cached and shared: constructing a KTX2 transcoder spins up a Web
 * Worker, so doing it once per session matters on a low-end device.
 */
function getLoader(renderer?: unknown): { gltf: GLTFLoader; draco: DRACOLoader; ktx2: KTX2Loader } {
  if (sharedLoader) return sharedLoader

  const draco = new DRACOLoader().setDecoderPath('/draco/')
  const ktx2 = new KTX2Loader().setTranscoderPath('/basis/')
  if (renderer) {
    // detectSupport picks the best transcode target for this GPU.
    ktx2.detectSupport(renderer as Parameters<KTX2Loader['detectSupport']>[0])
  } else {
    ktx2.detectSupport({ capabilities: { isWebGL2: true }, extensions: { has: () => false } } as never)
  }

  const gltf = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder)
  sharedLoader = { gltf, draco, ktx2 }
  return sharedLoader
}

export function disposeLoaders(): void {
  sharedLoader?.draco.dispose()
  sharedLoader?.ktx2.dispose()
  sharedLoader = null
}

/**
 * Bake `KHR_texture_transform` into the UV attribute.
 *
 * facecap.glb stores UVs in a 0..4095 texel space (a 4096x4096 atlas) and relies on
 * a texture transform with scale ~1/4096 to bring them into 0..1. Any texture we
 * supply ourselves would therefore tile thousands of times across the face. Baking
 * the transform once at load time means every downstream consumer — procedural
 * maps, the scanned atlas, and the photo projection — can assume plain 0..1 UVs.
 */
function bakeTextureTransform(mesh: ThreeMesh): void {
  const material = mesh.material as Material & { map?: Texture | null }
  const map = material.map
  if (!map) return

  const needs =
    map.repeat.x !== 1 ||
    map.repeat.y !== 1 ||
    map.offset.x !== 0 ||
    map.offset.y !== 0 ||
    map.rotation !== 0
  if (!needs) return

  if (map.rotation !== 0) {
    warn('texture rotation in KHR_texture_transform is not baked; UVs may be off')
  }

  const uv = mesh.geometry.attributes.uv
  if (!uv) return
  const baked = new Float32Array(uv.count * 2)
  for (let i = 0; i < uv.count; i++) {
    baked[i * 2] = uv.getX(i) * map.repeat.x + map.offset.x
    baked[i * 2 + 1] = uv.getY(i) * map.repeat.y + map.offset.y
  }
  // Clone the geometry first: a shared vertex buffer must never be mutated
  // underneath a sibling mesh that still expects the old UVs.
  mesh.geometry = mesh.geometry.clone()
  // A plain Float32 attribute is what every downstream consumer expects; the rig's
  // own UVs are normalised USHORT, ours are not.
  mesh.geometry.setAttribute('uv', new Float32BufferAttribute(baked, 2))

  map.repeat.set(1, 1)
  map.offset.set(0, 0)
  map.center.set(0, 0)
  map.rotation = 0
  map.needsUpdate = true
}

export interface LoadAvatarOptions {
  /** A renderer, so KTX2 can pick the right transcode target. */
  renderer?: unknown
  /** Build the procedural neck/shoulders/hair when the rig lacks them. */
  buildBust?: boolean
  buildHairShell?: boolean
  /** Overrides for the generated micro-detail resolution. */
  textureSize?: number
  /** Base skin tone, used for the bust and as a fallback for the head. */
  skinTone?: string
  /** Micro-detail micro-detail toggle for Lite quality. */
  lite?: boolean
}

export interface LoadedAvatar {
  /** Add this to the scene. Already normalised: head centred at the origin. */
  root: Group
  rig: Rig
  metrics: HeadMetrics
  headMesh: ThreeMesh
  hair: HairResult | null
  neckSkin: NeckSkin | null
  diagnostics: RigDiagnostics
  /** World height of the content after normalisation, for camera framing. */
  contentHeight: number
  vertexCount: number
  triangleCount: number
  dispose: () => void
}

const disposeMaterial = (m: Material): void => {
  const any = m as Material & Record<string, unknown>
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap', 'sheenColorMap', 'clearcoatMap']) {
    const tex = any[key] as Texture | null | undefined
    if (tex && typeof tex.dispose === 'function') tex.dispose()
  }
  m.dispose()
}

function collectGeometryStats(root: Object3D): { vertices: number; triangles: number } {
  let vertices = 0
  let triangles = 0
  root.traverse((o) => {
    const m = o as ThreeMesh
    if (!m.isMesh) return
    const pos = m.geometry.attributes.position
    vertices += pos.count
    triangles += m.geometry.index ? m.geometry.index.count / 3 : pos.count / 3
  })
  return { vertices, triangles }
}

/** Wrap ImageData in a three.js Texture with the right colour space. */
function imageDataToTexture(data: ImageData, colorSpace: string): DataTexture {
  const tex = new DataTexture(new Uint8Array(data.data.buffer.slice(0)), data.width, data.height, RGBAFormat)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = false
  tex.colorSpace = colorSpace as typeof SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/**
 * A 1x1 texture holding the average skin colour, used to tint the procedural bust so
 * it matches whichever albedo the head ended up with (the scanned atlas for the
 * sample avatar, the user's photo after Phase 4).
 */
function averageColorTexture(color: Color): DataTexture {
  const data = new Uint8Array([color.r * 255, color.g * 255, color.b * 255, 255])
  const tex = new DataTexture(data, 1, 1, RGBAFormat)
  tex.colorSpace = SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Average colour of an ImageData, returned in linear-ish sRGB bytes. */
function averageColor(image: ImageData, sampleStride = 7): Color {
  const d = image.data
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4 * sampleStride) {
    r += d[i]
    g += d[i + 1]
    b += d[i + 2]
    n++
  }
  return new Color(r / n / 255, g / n / 255, b / n / 255)
}

/**
 * Ambient-occlusion gradient for the bust.
 *
 * The strongest cue that the neck connects to the jaw rather than intersecting it is
 * a dark band in the shadow under the chin. Baking that gradient into vertex colours
 * costs nothing at runtime and hides any tone mismatch between the scanned head's
 * albedo and the procedural body.
 */
function applyBustOcclusion(geometry: BufferGeometry, metrics: HeadMetrics): void {
  const pos = geometry.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const chin = metrics.chinY
  const unit = metrics.height
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    // depth 0 at the chin, 1 a quarter of a head below it
    const depth = Math.min(1, Math.max(0, (chin - y) / (0.26 * unit)))
    // 0.42 in the deepest shadow, easing to 1.0
    const ao = 0.42 + 0.58 * Math.pow(depth, 0.75)
    colors[i * 3] = ao
    colors[i * 3 + 1] = ao
    colors[i * 3 + 2] = ao
  }
  geometry.setAttribute('color', new (geometry.attributes.position.constructor as new (a: Float32Array, s: number) => never)(colors, 3))
}

export async function loadAvatar(asset: AvatarAsset, options: LoadAvatarOptions = {}): Promise<LoadedAvatar> {
  const { gltf: loader } = getLoader(options.renderer)

  const gltf = await new Promise<{ scene: Group; animations: unknown[] }>((resolve, reject) => {
    loader.parse(
      asset.glb.slice(0),
      '',
      (result) => resolve(result as unknown as { scene: Group; animations: unknown[] }),
      (err) => reject(new AppError('parse-failed', `Could not read the avatar model: ${String(err)}`)),
    )
  })

  const original = gltf.scene
  original.updateMatrixWorld(true)

  // ---------------------------------------------------------------------------
  // Locate the parts we care about.
  // ---------------------------------------------------------------------------
  const byName = (...names: string[]): Object3D | null => {
    for (const n of names) {
      const found = original.getObjectByName(n)
      if (found) return found
    }
    return null
  }
  const meshUnder = (node: Object3D | null): ThreeMesh | null => {
    if (!node) return null
    if ((node as ThreeMesh).isMesh) return node as ThreeMesh
    let found: ThreeMesh | null = null
    node.traverse((o) => {
      if (!found && (o as ThreeMesh).isMesh) found = o as ThreeMesh
    })
    return found
  }

  const hints = asset.rigHints
  const eyeLeftNode: Object3D | null =
    (hints?.eyeLeftNode ? original.getObjectByName(hints.eyeLeftNode) : null) ??
    byName('grp_eyeLeft', 'eyeLeft', 'EyeLeft', 'LeftEye', 'eye_L')
  const eyeRightNode: Object3D | null =
    (hints?.eyeRightNode ? original.getObjectByName(hints.eyeRightNode) : null) ??
    byName('grp_eyeRight', 'eyeRight', 'EyeRight', 'RightEye', 'eye_R')
  const teethNode = byName('teeth', 'Teeth', 'tongue')

  // The face is whichever mesh carries the most morph targets.
  let headMesh: ThreeMesh | null = hints?.faceMesh ? meshUnder(original.getObjectByName(hints.faceMesh) ?? null) : null
  if (!headMesh) {
    let best: ThreeMesh | null = null
    let bestCount = 0
    original.traverse((o) => {
      const m = o as ThreeMesh
      if (!m.isMesh) return
      const count = m.morphTargetDictionary ? Object.keys(m.morphTargetDictionary).length : 0
      if (count > bestCount) {
        bestCount = count
        best = m
      }
    })
    headMesh = best
  }
  if (!headMesh) {
    throw new AppError(
      'no-face-mesh',
      'This model does not contain a face mesh we can animate.',
      'Try a different avatar provider, or use the built-in sample head.',
    )
  }
  const faceMesh: ThreeMesh = headMesh

  // Bake UV transforms before anything reads UVs.
  original.traverse((o) => {
    const m = o as ThreeMesh
    if (m.isMesh) bakeTextureTransform(m)
  })

  // The scanned atlas (if any) is reused as the head albedo. Grab a reference before
  // we start swapping materials about.
  const scannedAtlas = ((faceMesh.material as Material & { map?: Texture | null }).map ?? null) as Texture | null

  // ---------------------------------------------------------------------------
  // Normalise scale and origin.
  // ---------------------------------------------------------------------------
  const wrapper = new Group()
  wrapper.name = 'avatarRoot'
  wrapper.add(original)
  wrapper.updateMatrixWorld(true)

  const rawMetrics = measureHead(faceMesh)
  if (!(rawMetrics.height > 1e-6)) {
    throw new AppError('degenerate-model', 'The avatar model has no measurable head.')
  }
  const normalise = HEAD_HEIGHT_METRES / rawMetrics.height
  original.scale.multiplyScalar(normalise)
  wrapper.updateMatrixWorld(true)

  // Re-measure at real-world scale, then move the head's centre to the origin so the
  // camera can be fixed and every avatar frames identically.
  const metrics = measureHead(faceMesh)
  original.position.x -= metrics.center.x
  original.position.z -= metrics.center.z
  original.position.y -= metrics.center.y
  wrapper.updateMatrixWorld(true)

  const finalMetrics = measureHead(faceMesh)
  devLog('avatar normalised', {
    headHeight: finalMetrics.height.toFixed(4),
    chin: finalMetrics.chinY.toFixed(4),
    crown: finalMetrics.crownY.toFixed(4),
    forward: finalMetrics.forwardSign,
  })

  // ---------------------------------------------------------------------------
  // Materials.
  // ---------------------------------------------------------------------------
  const tone = findSkinTone(options.skinTone ?? (asset.metadata.notes?.includes('tone:fair') ? 'fair' : 'light'))
  const textureSize = options.textureSize ?? (options.lite ? 512 : 1024)

  let generated: ReturnType<typeof generateSkinTextures> | null = null
  try {
    generated = generateSkinTextures({
      size: textureSize,
      baseColor: tone.albedo,
      mottle: 0.5,
      freckles: 0.32,
      pores: options.lite ? 0.35 : 0.65,
      oiliness: 0.6,
      seed: 7,
    })
  } catch (err) {
    warn('procedural skin generation failed; falling back to flat skin', err)
  }

  const normalMap = generated ? imageDataToTexture(generated.normal, NoColorSpace) : null
  const roughnessMap = generated ? imageDataToTexture(generated.roughness, NoColorSpace) : null

  // A user-supplied face texture (from the photo pipeline) always wins over the
  // scanned atlas.
  let faceAlbedo: Texture | null = null
  if (asset.faceTextureBlob) {
    faceAlbedo = await loadBlobAsTexture(asset.faceTextureBlob)
  }
  const headAlbedo = faceAlbedo ?? scannedAtlas

  const skin = createSkinMaterial({
    map: headAlbedo,
    normalMap,
    roughnessMap,
    subsurface: 1,
    lite: options.lite,
  })
  // The scanned atlas is photographic, so it carries most of the realism; when we
  // supply our own albedo we lean more on the micro-detail maps.
  skin.normalScale.set(faceAlbedo ? 0.85 : 0.5, faceAlbedo ? 0.85 : 0.5)

  // Tint for the procedural body. If we generated the albedo ourselves we know its
  // average exactly; if we are using the scanned atlas we approximate from the tone
  // table, and the baked occlusion gradient hides the difference under the jaw.
  const bodyTint = faceAlbedo && generated ? averageColor(generated.albedo, 11) : new Color().setHex(tone.albedo)
  if (faceAlbedo) {
    // Darken slightly: the neck sits in the head's shadow far more than the cheeks do.
    bodyTint.multiplyScalar(0.94)
  }

  const eyeMaterial = createEyeMaterial(scannedAtlas)
  const teethMaterial = createTeethMaterial()

  // Apply to the head.
  faceMesh.material = skin
  faceMesh.castShadow = true
  faceMesh.receiveShadow = true

  const eyeL = meshUnder(eyeLeftNode)
  const eyeR = meshUnder(eyeRightNode)
  for (const eye of [eyeL, eyeR]) {
    if (!eye) continue
    eye.material = eyeMaterial
    // Eyes must not cast shadows: the socket already darkens them, and a cast shadow
    // from a 2 cm sphere just produces shadow acne on the lid.
    eye.castShadow = false
    eye.receiveShadow = false
  }
  const teeth = meshUnder(teethNode)
  if (teeth) {
    teeth.material = teethMaterial
    teeth.castShadow = false
    teeth.receiveShadow = true
  }

  // Any other mesh keeps a neutral material rather than its original.
  original.traverse((o) => {
    const m = o as ThreeMesh
    if (!m.isMesh) return
    if (m === faceMesh || m === eyeL || m === eyeR || m === teeth) return
    m.material = createFallbackMaterial()
  })

  // ---------------------------------------------------------------------------
  // Procedural bust and hair.
  // ---------------------------------------------------------------------------
  let neckSkin: NeckSkin | null = null
  let hair: HairResult | null = null

  const hasNeck = !!(hints?.neckNode ?? byName('neck', 'Neck', 'mixamorigNeck'))
  if (options.buildBust !== false && !hasNeck) {
    const bustGeo = buildNeckAndShoulders(finalMetrics)
    applyBustOcclusion(bustGeo, finalMetrics)

    // Reuse the exact skin material so the jaw junction cannot mismatch in shading.
    // A separate instance is needed only because the albedo differs from the face.
    const bustSkin = skin.clone()
    bustSkin.map = averageColorTexture(bodyTint)
    bustSkin.vertexColors = true
    bustSkin.color = new Color(0xffffff)
    // The bust has no UV detail worth sampling from the face atlas.
    bustSkin.roughness = 0.66
    bustSkin.name = 'skin-bust'

    const bustMesh = new ThreeMesh(bustGeo, bustSkin)
    bustMesh.name = 'proceduralBust'
    bustMesh.castShadow = true
    bustMesh.receiveShadow = true
    wrapper.add(bustMesh)

    // Pivot at the base of the cervical spine: a fifth of a head below the chin.
    const pivot = new Vector3(finalMetrics.center.x, finalMetrics.chinY - 0.06 * finalMetrics.height, finalMetrics.center.z)
    neckSkin = new NeckSkin(bustGeo, pivot)
  }

  if (options.buildHairShell !== false) {
    try {
      hair = buildHair(faceMesh, finalMetrics, {
        fullness: 0.85,
        color: 0x241a12,
        maskSize: options.lite ? 512 : 1024,
      })
      // MUST be parented to the mesh itself: the mesh node carries its own
      // dequantisation transform when KHR_mesh_quantization is in play.
      faceMesh.add(hair.mesh)
    } catch (err) {
      warn('hair shell generation failed; continuing without hair', err)
      hair = null
    }
  }

  wrapper.updateMatrixWorld(true)

  // ---------------------------------------------------------------------------
  // Rig.
  // ---------------------------------------------------------------------------
  const rig = new Rig(wrapper, {
    ...asset.rigHints,
    faceMesh: faceMesh.name || undefined,
  })

  const stats = collectGeometryStats(wrapper)
  const contentHeight = finalMetrics.crownY - finalMetrics.chinY + 1.05 * finalMetrics.height

  const dispose = (): void => {
    wrapper.traverse((o) => {
      const m = o as ThreeMesh
      if (!m.isMesh) return
      m.geometry.dispose()
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of mats) {
        // Shared materials must only be disposed once.
        if (mat === skin || mat === eyeMaterial || mat === teethMaterial) continue
        disposeMaterial(mat)
      }
    })
    setOfDisposables.forEach((d) => d())
    setOfDisposables.clear()
  }

  // Textures we created but that are not reachable through the scene graph.
  const setOfDisposables = new Set<() => void>()
  setOfDisposables.add(() => disposeMaterial(skin))
  setOfDisposables.add(() => disposeMaterial(eyeMaterial))
  setOfDisposables.add(() => disposeMaterial(teethMaterial))

  return {
    root: wrapper,
    rig,
    metrics: finalMetrics,
    headMesh: faceMesh,
    hair,
    neckSkin,
    diagnostics: rig.diagnostics,
    contentHeight,
    vertexCount: stats.vertices,
    triangleCount: Math.round(stats.triangles),
    dispose,
  }
}

/** Decode a blob (PNG/JPEG) into a three.js texture. */
export async function loadBlobAsTexture(blob: Blob): Promise<Texture> {
  const bitmap = await createImageBitmap(blob)
  const texture = new Texture(bitmap)
  texture.colorSpace = SRGBColorSpace
  // Canvas/ImageBitmap sources are already in top-left order, which matches how the
  // photo pipeline writes them; flipY would double-flip.
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/**
 * Convenience for the sample avatar: fetch the bundled rig from /models and wrap it
 * in an AvatarAsset. Kept here so the sample path and the provider path converge on
 * exactly the same loader.
 */
export async function loadSampleAsset(signal?: AbortSignal): Promise<AvatarAsset> {
  const res = await fetch('/models/facecap.glb', { signal, cache: 'force-cache' })
  if (!res.ok) throw new AppError('sample-missing', `Could not load the sample head (HTTP ${res.status}).`)
  const glb = await res.arrayBuffer()
  return {
    source: 'sample',
    glb,
    rigHints: {
      headNode: 'head',
      eyeLeftNode: 'grp_eyeLeft',
      eyeRightNode: 'grp_eyeRight',
      faceMesh: 'mesh_2',
      blendshapeMapping: undefined,
      headSize: HEAD_HEIGHT_METRES,
    },
    metadata: {
      provider: 'bundled sample (Face Cap scan, see MODEL_LICENSES.md)',
      generatedAt: new Date().toISOString(),
      bytes: glb.byteLength,
      notes: ['tone:fair', 'scanned albedo atlas included (72 KB KTX2)'],
    },
  }
}

export { Matrix4, Box3, PlaneGeometry }
