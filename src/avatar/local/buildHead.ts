/**
 * Procedurally extend a scanned head into a head-and-shoulders bust, and add hair.
 *
 * facecap.glb is a bald head with no neck and no shoulders; the product needs all
 * three. This module builds them from the head's own measured proportions rather
 * than hand-tuned constants.
 *
 * ## Frames of reference (read this before changing anything)
 *
 * Rig hierarchies put surprising rotations in the chain. facecap.glb's root carries
 * a 90-degree rotation about X and a 0.01 scale, so `grp_transform`'s LOCAL +Y is
 * the world's +Z. Building geometry in that local space — the obvious first
 * approach — produces a neck that grows out of the back of the skull.
 *
 * So:
 *  - `measureHead()` reports WORLD-space metrics.
 *  - `buildNeckAndShoulders()` emits geometry in the AVATAR-ROOT's space, which is
 *    identity at build time. The caller parents it to the avatar root.
 *  - `NeckSkin` therefore rotates about a world-space pivot using the head's WORLD
 *    quaternion.
 *  - `buildHair()` emits geometry in the head MESH's local space (so it can simply
 *    be added as a child and inherit head rotation), and expresses its scalp test
 *    as linear functionals of the world transform, so the hairline lands in the
 *    right place regardless of how the rig is nested.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,

  Quaternion,
  RepeatWrapping,
  Vector2,
  Vector3,
} from 'three'

/** Proportional facts about the head, all in WORLD units. */
export interface HeadMetrics {
  /** Half-width across the cheekbones. */
  halfWidth: number
  /** Chin to crown. */
  height: number
  /** Front to back. */
  depth: number
  /** World-space centre of the head's bounding box. */
  center: Vector3
  /** Lowest point of the chin. */
  chinY: number
  /** Highest point of the crown. */
  crownY: number
  /** Which world Z direction the face points: +1 for +Z, -1 for -Z. */
  forwardSign: 1 | -1
  /** World-space most-protruding point (the nose). */
  nose: Vector3
  /** Uniform world scale of the head mesh (used to convert world offsets to local). */
  worldScale: number
}

/**
 * Measure a head mesh in WORLD space.
 *
 * Positions are read with `getX()` rather than from `.array`, because a rig stored
 * with KHR_mesh_quantization holds raw integers there (facecap.glb uses USHORT) and
 * `getX()` is what applies the dequantisation the vertex shader would see.
 */
export function measureHead(headMesh: Mesh): HeadMetrics {
  headMesh.updateWorldMatrix(true, false)
  const pos = headMesh.geometry.attributes.position
  const world = headMesh.matrixWorld
  const v = new Vector3()

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(world)
    if (v.x < minX) minX = v.x
    if (v.x > maxX) maxX = v.x
    if (v.y < minY) minY = v.y
    if (v.y > maxY) maxY = v.y
    if (v.z < minZ) minZ = v.z
    if (v.z > maxZ) maxZ = v.z
  }

  const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)

  // The most horizontally-protruding vertex of a head is the nose tip, so the
  // direction from the vertical axis to that vertex is the facing direction.
  let noseDist = -1
  const nose = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(world)
    const dx = v.x - center.x
    const dz = v.z - center.z
    const d = Math.hypot(dx, dz)
    if (d > noseDist) {
      noseDist = d
      nose.copy(v)
    }
  }

  // Uniform scale factor of the head's world matrix (the length of its X basis).
  const e = world.elements
  const worldScale = Math.hypot(e[0], e[1], e[2])

  return {
    halfWidth: (maxX - minX) / 2,
    height: maxY - minY,
    depth: maxZ - minZ,
    center,
    chinY: minY,
    crownY: maxY,
    forwardSign: nose.z >= center.z ? 1 : -1,
    nose,
    worldScale,
  }
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------
// Neck + shoulders
// ---------------------------------------------------------------------------

interface ProfilePoint {
  /** Distance BELOW THE CHIN, in head-heights. */
  t: number
  /** Half-width, as a multiple of the head's half-width. */
  rx: number
  /** Half-depth, as a multiple of the head's half-width. */
  rz: number
  /** Section-centre offset along the facing axis, in head depths. */
  dz: number
}

/**
 * Cross-sections from inside the jaw down past the chest.
 *
 * Proportions are standard adult anthropometry expressed relatively:
 *  - neck width ~0.80x head half-width, depth ~0.76x (a neck is a rounded
 *    rectangle, wider than it is deep, and its front is flatter than its back)
 *  - the neck leans slightly forward at the top: the cervical spine curves
 *  - the trapezius flares hard from about half a head below the chin, and the
 *    shoulders reach ~2.4 head half-widths each side by the time they leave frame
 *  - depth grows with the flare, because shoulders are deep as well as wide
 */
const NECK_PROFILE: ProfilePoint[] = [
  // Anthropometric basis for an average adult, expressed relative to the head:
  //   head width (bizygomatic) ~14 cm  ->  half = 7 cm  (our unit of rx/rz)
  //   neck circumference        ~35 cm ->  half-width 0.80 of head half-width
  //   neck depth                ~10 cm ->  half-depth 0.74 (a neck is a rounded
  //                                       rectangle: clearly wider than deep)
  //   chin to shoulder line     ~12 cm ->  0.52 head-heights
  //   shoulder width            ~40 cm ->  half = 2.86 x head half-width
  { t: -0.36, rx: 0.52, rz: 0.50, dz: -0.02 }, // deep inside the skull; never visible
  { t: 0.00, rx: 0.63, rz: 0.60, dz: 0.004 }, // chin level, still filling under the jaw
  { t: 0.06, rx: 0.79, rz: 0.735, dz: 0.010 }, // the neck reaches full width here
  { t: 0.14, rx: 0.795, rz: 0.735, dz: 0.013 }, // slight forward lean (cervical curve)
  { t: 0.22, rx: 0.80, rz: 0.73, dz: 0.013 },
  { t: 0.30, rx: 0.82, rz: 0.725, dz: 0.012 },
  { t: 0.38, rx: 0.87, rz: 0.73, dz: 0.010 }, // trapezius begins to flare
  { t: 0.46, rx: 0.95, rz: 0.75, dz: 0.007 },
  { t: 0.54, rx: 1.10, rz: 0.79, dz: 0.003 },
  { t: 0.62, rx: 1.35, rz: 0.85, dz: -0.002 }, // shoulder line
  { t: 0.70, rx: 1.70, rz: 0.93, dz: -0.008 },
  { t: 0.78, rx: 2.10, rz: 1.02, dz: -0.014 },
  { t: 0.87, rx: 2.45, rz: 1.10, dz: -0.020 },
  { t: 0.97, rx: 2.72, rz: 1.16, dz: -0.025 },
  { t: 1.10, rx: 2.92, rz: 1.20, dz: -0.030 },
  { t: 1.28, rx: 3.05, rz: 1.23, dz: -0.034 },
  { t: 1.52, rx: 3.12, rz: 1.25, dz: -0.038 }, // runs off the bottom of the frame
]

const RADIAL_SEGMENTS = 32
/** Rings in the loft. More rings = a smoother trapezius flare; 32 costs ~1k tris. */
const RINGS = 32

/** Catmull-Rom through the key profile, so the neck-to-shoulder flare is smooth. */
function sampleProfile(u: number): ProfilePoint {
  const n = NECK_PROFILE.length
  const x = u * (n - 1)
  const i = Math.min(n - 2, Math.floor(x))
  const f = x - i
  const p0 = NECK_PROFILE[Math.max(0, i - 1)]
  const p1 = NECK_PROFILE[i]
  const p2 = NECK_PROFILE[i + 1]
  const p3 = NECK_PROFILE[Math.min(n - 1, i + 2)]

  const cr = (a: number, b: number, c: number, d: number) => {
    const f2 = f * f
    const f3 = f2 * f
    return 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3)
  }

  return {
    t: cr(p0.t, p1.t, p2.t, p3.t),
    rx: Math.max(0.02, cr(p0.rx, p1.rx, p2.rx, p3.rx)),
    rz: Math.max(0.02, cr(p0.rz, p1.rz, p2.rz, p3.rz)),
    dz: cr(p0.dz, p1.dz, p2.dz, p3.dz),
  }
}

/**
 * Loft the neck/shoulder profile into a quad-grid surface.
 *
 * Sections are superellipses rather than ellipses: a chest and neck have flatter
 * fronts with rounded corners, which is exactly what a superellipse gives and what
 * makes the clavicle/trapezius silhouette read correctly.
 *
 * Output geometry is in the AVATAR ROOT's coordinate space (identity at build time).
 */
export function buildNeckAndShoulders(metrics: HeadMetrics, squareness = 1.3): BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const weights: number[] = []
  const indices: number[] = []

  const chin = metrics.chinY
  const unitH = metrics.height
  const hw = metrics.halfWidth
  const depthUnit = metrics.depth

  for (let r = 0; r < RINGS; r++) {
    const p = sampleProfile(r / (RINGS - 1))
    // t increases DOWNWARD from the chin.
    const y = chin - p.t * unitH
    const rx = p.rx * hw
    // rz is expressed in half-widths so the silhouette scales with the head, but
    // nudged by how deep this particular scan actually is.
    const rz = p.rz * hw * (0.88 + 0.12 * (depthUnit / (2 * hw)))
    const cz = metrics.center.z + p.dz * depthUnit * metrics.forwardSign

    // Skinning weight: 1 at the top of the neck (fully follows the head), 0 once
    // the trapezius flares (stays put). It DECREASES as t grows, and reaches zero
    // before the shoulder line so the trapezius never shears.
    const w = 1 - smoothstep(0.10, 0.44, p.t)

    for (let s = 0; s <= RADIAL_SEGMENTS; s++) {
      const a = (s / RADIAL_SEGMENTS) * Math.PI * 2
      const cx = Math.cos(a)
      const sz = Math.sin(a)
      const ex = Math.sign(cx) * Math.pow(Math.abs(cx), 2 / squareness)
      const ez = Math.sign(sz) * Math.pow(Math.abs(sz), 2 / squareness)
      positions.push(metrics.center.x + ex * rx, y, cz + ez * rz)
      uvs.push(s / RADIAL_SEGMENTS, p.t / 1.6)
      weights.push(w)
    }
  }

  for (let r = 0; r < RINGS - 1; r++) {
    for (let s = 0; s < RADIAL_SEGMENTS; s++) {
      const a = r * (RADIAL_SEGMENTS + 1) + s
      const b = a + 1
      const c = a + RADIAL_SEGMENTS + 1
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geo.setAttribute('skinWeight', new Float32BufferAttribute(weights, 1))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/**
 * CPU-blended skinning for the neck.
 *
 * A real three.js Skeleton would work, but this mesh is ~550 vertices and the blend
 * is a single scalar per vertex, so doing it on the CPU keeps the shader untouched.
 * That matters: it means the bust can share the exact skin material with the head,
 * which is what stops a visible seam at the jaw.
 *
 * Each vertex rotates about the neck base by `slerp(identity, headRotation, w)` —
 * linear blend skinning with two bones, where the second bone never moves.
 */
export class NeckSkin {
  private readonly geometry: BufferGeometry
  private readonly rest: Float32Array
  private readonly restNormals: Float32Array
  private readonly weights: Float32Array
  private readonly pivot: Vector3
  private readonly scratch = new Quaternion()

  constructor(geometry: BufferGeometry, pivot: Vector3) {
    this.geometry = geometry
    this.pivot = pivot
    const pos = geometry.attributes.position as BufferAttribute
    const nrm = geometry.attributes.normal as BufferAttribute
    const w = geometry.attributes.skinWeight as BufferAttribute
    this.rest = Float32Array.from(pos.array as ArrayLike<number>)
    this.restNormals = Float32Array.from(nrm.array as ArrayLike<number>)
    this.weights = new Float32Array(w.count)
    for (let i = 0; i < w.count; i++) this.weights[i] = w.getX(i)
  }

  /**
   * @param headWorldRotation the head bone's WORLD quaternion, relative to its rest
   *   pose. Pass identity to return the neck to rest.
   */
  update(headWorldRotation: Quaternion): void {
    const pos = this.geometry.attributes.position as BufferAttribute
    const nrm = this.geometry.attributes.normal as BufferAttribute
    const arr = pos.array as Float32Array
    const narr = nrm.array as Float32Array
    const { rest, restNormals: rn, weights, pivot } = this
    const count = pos.count

    for (let i = 0; i < count; i++) {
      const w = weights[i]
      const i3 = i * 3
      if (w <= 0.0005) {
        // Fully static: restore rest values directly (cheap, and cannot drift).
        arr[i3] = rest[i3]
        arr[i3 + 1] = rest[i3 + 1]
        arr[i3 + 2] = rest[i3 + 2]
        continue
      }

      // Partial rotation: slerp from identity toward the head rotation.
      const q = this.scratch.identity().slerp(headWorldRotation, w)
      const qx = q.x
      const qy = q.y
      const qz = q.z
      const qw = q.w

      // Rotate the position about the pivot by q (quaternion sandwich, expanded).
      const px = rest[i3] - pivot.x
      const py = rest[i3 + 1] - pivot.y
      const pz = rest[i3 + 2] - pivot.z

      const ix = qw * px + qy * pz - qz * py
      const iy = qw * py + qz * px - qx * pz
      const iz = qw * pz + qx * py - qy * px
      const iw = -qx * px - qy * py - qz * pz

      arr[i3] = ix * qw + iw * -qx + iy * -qz - iz * -qy + pivot.x
      arr[i3 + 1] = iy * qw + iw * -qy + iz * -qx - ix * -qz + pivot.y
      arr[i3 + 2] = iz * qw + iw * -qz + ix * -qy - iy * -qx + pivot.z

      // Rotate the normal by the same partial rotation.
      const nx = rn[i3]
      const ny = rn[i3 + 1]
      const nz = rn[i3 + 2]

      const jx = qw * nx + qy * nz - qz * ny
      const jy = qw * ny + qz * nx - qx * nz
      const jz = qw * nz + qx * ny - qy * nx
      const jw = -qx * nx - qy * ny - qz * nz

      narr[i3] = jx * qw + jw * -qx + jy * -qz - jz * -qy
      narr[i3 + 1] = jy * qw + jw * -qy + jz * -qx - jx * -qz
      narr[i3 + 2] = jz * qw + jw * -qz + jx * -qy - jy * -qx
    }

    pos.needsUpdate = true
    nrm.needsUpdate = true
  }

  /** Base of the cervical spine: everything rotates about this point. */
  get basePoint(): Vector3 {
    return this.pivot
  }
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

export interface HairOptions {
  /** Base colour. */
  color?: Color | number
  /** Shell thickness, in head-height units. */
  thickness?: number
  /** 0 = cropped, 1 = fuller. Scales shell offset and noise. */
  fullness?: number
  /** Resolution of the generated alpha mask. */
  maskSize?: number
  /** Fraction of head-height above the chin where the hairline sits. ~0.80 typical. */
  hairlineFraction?: number
  /** How much lower the hairline sits at the nape, in head-heights. */
  napeDrop?: number
}

function hash3(x: number, y: number, z: number): number {
  let h = x * 374761393 + y * 668265263 + z * 1274126177
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const w = zf * zf * (3 - 2 * zf)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  )
}

function fbm(x: number, y: number, z: number, octaves = 3): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, z * freq) * amp
    amp *= 0.5
    freq *= 2.07
  }
  return sum
}

export interface HairResult {
  mesh: Mesh
  /** Fraction of head vertices classified as scalp — a quick sanity readout. */
  scalpFraction: number
  /**
   * Per-vertex coverage (0..1) of the hair shell. Exposed for diagnostics; the
   * material masks with the rasterised UV-space alpha map, not this array.
   */
  coverage: Float32Array
}

/**
 * Build a hair shell by duplicating the head geometry, pushing the scalp region
 * outward along its normals, and masking the rest away with an alpha map
 * rasterised in the head's own UV space.
 *
 * This is the shell/tube approach mobile games use: one extra draw call, no strand
 * simulation, and it reads convincingly at phone resolution because the silhouette
 * follows the skull exactly.
 *
 * Output geometry is in the head mesh's LOCAL space, so the caller adds it as a
 * child of the head and it inherits head rotation for free.
 */
export function buildHair(headMesh: Mesh, metrics: HeadMetrics, options: HairOptions = {}): HairResult {
  headMesh.updateWorldMatrix(true, false)
  const src = headMesh.geometry
  const pos = src.attributes.position
  const nrm = src.attributes.normal
  const uv = src.attributes.uv
  const count = pos.count

  // Express the scalp test as linear functionals of the world transform, so the
  // hairline lands correctly no matter how the rig is nested. For a world matrix
  // with linear part A and translation t:
  //     worldY(p) = A_row1 . p + t.y
  //     worldZ(p) = A_row3 . p + t.z
  const e = headMesh.matrixWorld.elements
  const rowY = new Vector3(e[1], e[5], e[9])
  const worldScale = Math.hypot(e[0], e[1], e[2]) || 1

  const localScale = 1 / worldScale
  const thickness = (options.thickness ?? 0.020) * metrics.height * localScale
  const fullness = options.fullness ?? 0.8
  const hairlineY = metrics.chinY + metrics.height * (options.hairlineFraction ?? 0.775)
  const napeDrop = (options.napeDrop ?? 0.30) * metrics.height

  const hairPos = new Float32Array(count * 3)
  const hairUv = new Float32Array(count * 2)
  const scalp = new Float32Array(count)
  const v = new Vector3()
  const n = new Vector3()

  let scalpCount = 0

  for (let i = 0; i < count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
    v.applyMatrix4(headMesh.matrixWorld) // to world, for classification only
    const worldY = v.y
    const worldZ = v.z
    // Back to local for geometry output.
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i))

    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).normalize()

    // frontness: 0 at the back of the head, 1 at the front
    const dz = (worldZ - metrics.center.z) / Math.max(metrics.depth, 1e-6)
    const frontness = Math.max(0, Math.min(1, (dz + 0.4) * 0.7))
    // The hairline is high at the brow and lower at the nape and temples.
    const threshold = hairlineY - napeDrop * (1 - frontness)

    let s = smoothstep(threshold - 0.05 * metrics.height, threshold + 0.07 * metrics.height, worldY)

    // Receding temples: pull the hairline back above the eyes. Only applies toward
    // the front, so the sides and back stay full.
    const lateral = Math.min(1, Math.abs(v.x * worldScale - metrics.center.x) / Math.max(metrics.halfWidth, 1e-6))
    s *= 1 - 0.5 * smoothstep(0.5, 1.0, lateral) * frontness

    // Normals must point outward/upward: excludes the underside of the jaw and the
    // inside of the eye sockets, both of which would otherwise be "scalp".
    const upness = rowY.dot(n) / Math.max(rowY.length(), 1e-6)
    s *= smoothstep(-0.5, 0.05, upness)

    scalp[i] = s
    if (s > 0.5) scalpCount++

    // Displace outward along the normal. Fine noise gives strand-level variation;
    // the lower-frequency term breaks an otherwise perfectly spherical silhouette.
    const h1 = fbm(v.x * 0.9, v.y * 0.9, v.z * 0.9, 3)
    const h2 = fbm(v.x * 0.33 + 11, v.y * 0.33, v.z * 0.33 + 5, 2)
    // Base shell plus two noise octaves: the base keeps the hair from z-fighting the
    // scalp, the low-frequency term gives the silhouette some volume, and the fine
    // term reads as clumping at phone resolution.
    const offset = thickness * (0.45 + 1.15 * fullness) * (0.55 + 0.55 * h2 + 0.35 * h1) * s
    hairPos[i * 3] = v.x + n.x * offset
    hairPos[i * 3 + 1] = v.y + n.y * offset
    hairPos[i * 3 + 2] = v.z + n.z * offset
    hairUv[i * 2] = uv.getX(i)
    hairUv[i * 2 + 1] = uv.getY(i)
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(hairPos, 3))
  geo.setAttribute('uv', new BufferAttribute(hairUv, 2))
  geo.setAttribute('normal', new BufferAttribute(Float32Array.from(src.attributes.normal.array as ArrayLike<number>), 3))
  if (src.index) geo.setIndex(src.index.clone())
  geo.computeVertexNormals()

  const alphaMap = buildHairAlphaMap(geo, scalp, options.maskSize ?? 1024)

  const color = new Color(options.color ?? 0x241a12)
  const material = new MeshPhysicalMaterial({
    color,
    roughness: 0.4,
    metalness: 0,
    sheen: 0.9,
    sheenRoughness: 0.45,
    sheenColor: new Color(color).lerp(new Color(0xffffff), 0.4),
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    alphaMap,
    alphaTest: 0.28,
    // The shell is open along the hairline, so both faces are visible there.
    side: 2,
    depthWrite: true,
  })
  material.name = 'hair'

  const mesh = new Mesh(geo, material)
  mesh.name = 'hairShell'
  mesh.castShadow = true
  mesh.receiveShadow = false
  mesh.renderOrder = 1
  mesh.frustumCulled = false

  return { mesh, scalpFraction: scalpCount / count, coverage: scalp }
}

/**
 * Rasterise the per-vertex scalp weight into the head's UV space, then feather it.
 *
 * Masking in UV space (rather than with vertex colours) costs no extra vertex
 * bandwidth, and the blur gives a smooth anti-aliased hairline instead of a
 * polygon-edged one.
 */
function buildHairAlphaMap(geometry: BufferGeometry, scalp: Float32Array, size: number): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable — cannot build the hair mask.')

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)

  const uv = geometry.attributes.uv
  const index = geometry.index
  if (!index) throw new Error('Hair geometry needs an index buffer.')

  const triangleCount = index.count / 3
  for (let t = 0; t < triangleCount; t++) {
    const a = index.getX(t * 3)
    const b = index.getX(t * 3 + 1)
    const c = index.getX(t * 3 + 2)
    const sAvg = (scalp[a] + scalp[b] + scalp[c]) / 3
    if (sAvg <= 0.01) continue

    // Flip V: three.js UV origin is bottom-left, canvas is top-left.
    const ax = uv.getX(a) * size
    const ay = (1 - uv.getY(a)) * size
    const bx = uv.getX(b) * size
    const by = (1 - uv.getY(b)) * size
    const cx = uv.getX(c) * size
    const cy = (1 - uv.getY(c)) * size

    ctx.fillStyle = `rgba(255,255,255,${sAvg.toFixed(3)})`
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.lineTo(cx, cy)
    ctx.closePath()
    ctx.fill()
  }

  // Feather the boundary via a second canvas. Drawing a blurred canvas onto itself
  // self-composites and produces banding.
  const blurred = document.createElement('canvas')
  blurred.width = size
  blurred.height = size
  const bctx = blurred.getContext('2d')
  if (bctx) {
    bctx.filter = `blur(${Math.max(2, Math.round(size / 90))}px)`
    bctx.drawImage(canvas, 0, 0)
    bctx.filter = 'none'
    ctx.drawImage(blurred, 0, 0)
  }

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  // Deliberately left in the default (linear) colour space: this is a mask, not
  // colour data, and decoding it as sRGB would crush the feathered hairline.
  texture.needsUpdate = true
  return texture
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface SkinMaterialOptions {
  map?: import('three').Texture | null
  normalMap?: import('three').Texture | null
  roughnessMap?: import('three').Texture | null
  color?: number
  /** 0..1 — how much fake subsurface warmth to add at grazing angles. */
  subsurface?: number
  /** Lite mode drops the costly extras. */
  lite?: boolean
}

/**
 * Skin material.
 *
 * MeshPhysicalMaterial gives us the sheen lobe (the single biggest reason skin
 * stops looking like plastic) plus a light clearcoat for the oily specular of the
 * forehead and nose.
 *
 * Real subsurface scattering needs a transmission pass that is far too expensive
 * for a mid-range Android GPU, so we approximate the perceptual cue — warmth
 * bleeding through thin, grazing-angle regions such as nostrils, ears and eyelids —
 * with a wrap-lighting term injected into the physical shader.
 */
export function createSkinMaterial(options: SkinMaterialOptions = {}): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({
    color: new Color(options.color ?? 0xffffff),
    map: options.map ?? null,
    normalMap: options.normalMap ?? null,
    roughnessMap: options.roughnessMap ?? null,
    // Skin is noticeably rougher than plastic but never flat: 0.55 puts the specular
    // lobe where a forehead under a softbox actually puts it.
    roughness: 0.55,
    metalness: 0,
    // 1.4 is the measured IOR of human skin; the default 1.5 gives a glassier edge.
    ior: 1.4,
    // Dials the dielectric specular to the roughly 4% a dry stratum corneum reflects.
    specularIntensity: 0.6,
    sheen: options.lite ? 0.18 : 0.62,
    sheenRoughness: 0.38,
    // Warm, not white: the sheen lobe stands in for light scattering inside flesh.
    sheenColor: new Color(0xff9d78),
    clearcoat: options.lite ? 0.06 : 0.2,
    clearcoatRoughness: 0.3,
    normalScale: new Vector2(0.6, 0.6),
  })
  mat.name = 'skin'

  const subsurface = options.subsurface ?? 1
  if (subsurface > 0 && !options.lite) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSubsurface = { value: subsurface }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSubsurface;')
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
           {
             // Wrap lighting shifts the lambert term so light bleeds past the
             // terminator, then the wrapped energy is tinted with haemoglobin red.
             float wrap = clamp( dot( normal, normalize( vViewPosition ) ) * 0.5 + 0.5, 0.0, 1.0 );
             float thin = pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 2.0 );
             reflectedLight.indirectDiffuse +=
               uSubsurface * vec3( 0.94, 0.32, 0.28 ) * wrap * thin * 0.26 * diffuseColor.rgb;
             // A little warmth survives even where the skin is flat-lit. Without this,
             // the areas the key does not reach read as matte grey rather than as flesh.
             reflectedLight.indirectDiffuse +=
               uSubsurface * vec3( 0.38, 0.15, 0.13 ) * pow( wrap, 3.0 ) * 0.12 * diffuseColor.rgb;
           }`,
        )
      mat.userData.shader = shader
    }
  }
  return mat
}

/** Eye material: wet sclera/cornea with a strong clearcoat highlight. */
export function createEyeMaterial(map?: import('three').Texture | null): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({
    map: map ?? null,
    color: map ? new Color(0xffffff) : new Color(0xdedad2),
    // The sclera itself is not the wet part: the tear film over the cornea is. A slightly
    // rough base plus a near-mirror clearcoat reproduces that two-layer look, which a
    // single low-roughness surface cannot (it turns the whole eyeball into a marble).
    roughness: 0.14,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    // 1.376 is the IOR of the cornea, and it is what shapes the refracted catchlight.
    ior: 1.376,
    specularIntensity: 1,
    sheen: 0.12,
    sheenColor: new Color(0xfff3ea),
  })
  mat.name = 'eye'
  // The corneal highlight is the strongest single cue that an eye is wet, so the eye
  // takes more of the environment than anything else on the head.
  mat.envMapIntensity = 2.1
  return mat
}

/** Teeth: off-white, faintly translucent enamel. */
export function createTeethMaterial(): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({
    color: new Color(0xf3efe6),
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
    sheen: 0.3,
    sheenColor: new Color(0xffffff),
  })
  mat.name = 'teeth'
  return mat
}

/** Fallback material for a rig we cannot identify. */
export function createFallbackMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: new Color(0xb9a89c), roughness: 0.7 })
  mat.name = 'fallback'
  return mat
}

export { smoothstep, Matrix4 }
