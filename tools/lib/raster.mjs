/**
 * Offline software rasteriser for verification.
 *
 * This is NOT part of the app. It exists because the build environment has no
 * browser, and "does the avatar face the camera?", "did the ARKit channel mapping
 * land on the right morph target?", and "is the UV seam in the right place?" are
 * questions that need eyes, not assertions.
 *
 * It implements just enough of a forward renderer to be legible: z-buffered
 * perspective rasterisation of indexed triangles with per-vertex normals, optional
 * texture sampling, and an optional morph-target blend.
 *
 * Two shading paths exist. The default is the original single Lambert light plus a rim
 * term. Passing `lights` switches to the multi-light physical model in `shade.mjs`,
 * which is what the realism before/after render uses — see that file for exactly what it
 * does and does not model.
 */
import { encodePng } from './png.mjs'
import { shadePhysically } from './shade.mjs'

const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export class Renderer {
  constructor(width, height) {
    this.width = width
    this.height = height
    /** Linear multiplier applied before the tone curve, mirroring ACESFilmicToneMapping. */
    this.exposure = 1
    /** Metres per world unit, for the physical path's point lights. */
    this.lightScale = 1
    this.color = new Float32Array(width * height * 3)
    this.depth = new Float32Array(width * height).fill(Infinity)
    // Two-layer background: a soft vertical gradient standing in for the studio.
    for (let y = 0; y < height; y++) {
      const t = y / (height - 1)
      const top = [0.10, 0.11, 0.13]
      const bot = [0.045, 0.048, 0.055]
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3
        this.color[i] = top[0] + (bot[0] - top[0]) * t
        this.color[i + 1] = top[1] + (bot[1] - top[1]) * t
        this.color[i + 2] = top[2] + (bot[2] - top[2]) * t
      }
    }
  }

  /**
   * Attribute inputs are BufferAttribute-shaped objects (they need `count`,
   * `itemSize` and `getX/getY/getZ`). That is deliberate: facecap.glb is stored
   * with KHR_mesh_quantization, so its normals are normalised BYTE and its
   * positions are raw USHORT that the node matrix dequantises. Reading `.array`
   * directly yields garbage; `getX()` applies exactly the denormalisation the
   * vertex shader would see.
   *
   * @param {object} opts
   * @param {{count:number,getX:Function,getY:Function,getZ:Function}} opts.position
   * @param {{count:number,getX:Function,getY:Function,getZ:Function}} [opts.normal]
   * @param {{count:number,itemSize:number,getX:Function,getY:Function}} [opts.uv]
   * @param {{array:ArrayLike<number>,count:number}} opts.index
   * @param {Array} [opts.morphs]     array of position-like attributes
   * @param {number[]} [opts.influences]  matching weights, 0..1
   * @param {number[]} [opts.modelMatrix] column-major 16
   * @param {{data:Uint8Array,width:number,height:number}} [opts.texture]
   * @param {Array} [opts.lights]        switches to the physical path; see shade.mjs
   * @param {{color:number[],intensity:number}} [opts.ambientLight]
   * @param {number} [opts.envIntensity]
   * @param {object} [opts.material]     { roughness, specularIntensity, sheen, sheenColor, clearcoat, clearcoatRoughness }
   */
  draw({
    position,
    normal = null,
    uv = null,
    index,
    morphs = null,
    influences = null,
    /** Per-vertex coverage in 0..1, plus `alphaTest`. Mirrors the GPU's alpha test so
     *  masked materials (the hair shell) do not render as a speckled mess. */
    alpha = null,
    alphaTest = 0,
    modelMatrix = null,
    texture = null,
    doubleSided = true,
    baseColor = [0.82, 0.68, 0.60],
    lightDir = norm([-0.45, 0.55, 0.7]),
    ambient = 0.28,
    rimColor = [0.55, 0.68, 0.95],
    rimStrength = 0.75,
    lights = null,
    ambientLight = null,
    envIntensity = 0,
    material = null,
  }) {
    const W = this.width
    const H = this.height
    const aspect = W / H
    const fov = 32 * (Math.PI / 180)
    const f = 1 / Math.tan(fov / 2)
    // three.js convention: the camera sits on the +Z axis looking toward -Z, which
    // is the direction a face should point if it is to face the viewer.
    const cameraDist = 3.1

    const vertCount = position.count
    const view = new Float32Array(vertCount * 3)
    const vnorm = new Float32Array(vertCount * 3)
    // Kept only for the physical path: point lights need the surface position, and the
    // projected coordinates cannot be inverted reliably enough for it.
    const wpos = lights ? new Float32Array(vertCount * 3) : null

    for (let i = 0; i < vertCount; i++) {
      let x = position.getX(i)
      let y = position.getY(i)
      let z = position.getZ(i)

      // Apply morph target displacements in the same (quantised) space the GPU uses.
      if (morphs && influences) {
        for (let t = 0; t < morphs.length; t++) {
          const w = influences[t]
          if (!w) continue
          x += morphs[t].getX(i) * w
          y += morphs[t].getY(i) * w
          z += morphs[t].getZ(i) * w
        }
      }

      let nx = normal ? normal.getX(i) : 0
      let ny = normal ? normal.getY(i) : 0
      let nz = normal ? normal.getZ(i) : 0

      if (modelMatrix) {
        const m = modelMatrix
        const tx = m[0] * x + m[4] * y + m[8] * z + m[12]
        const ty = m[1] * x + m[5] * y + m[9] * z + m[13]
        const tz = m[2] * x + m[6] * y + m[10] * z + m[14]
        x = tx
        y = ty
        z = tz
        // Normals use the upper 3x3. The transforms here are rotation + uniform
        // scale, so no inverse-transpose is needed.
        const ux = m[0] * nx + m[4] * ny + m[8] * nz
        const uy = m[1] * nx + m[5] * ny + m[9] * nz
        const uz = m[2] * nx + m[6] * ny + m[10] * nz
        nx = ux
        ny = uy
        nz = uz
      }

      if (wpos) {
        wpos[i * 3] = x
        wpos[i * 3 + 1] = y
        wpos[i * 3 + 2] = z
      }

      // Perspective: depth is measured from the camera plane, so dz > 0 in front.
      const dz = cameraDist - z
      const iz = 1 / Math.max(dz, 1e-4)
      view[i * 3] = ((x * f) / aspect) * iz
      view[i * 3 + 1] = y * f * iz
      view[i * 3 + 2] = dz
      const l = Math.hypot(nx, ny, nz) || 1
      vnorm[i * 3] = nx / l
      vnorm[i * 3 + 1] = ny / l
      vnorm[i * 3 + 2] = nz / l
    }

    const indices = index.array
    const light = lightDir
    const toPx = (ndc) => ((ndc + 1) * 0.5) * W
    const toPy = (ndc) => ((1 - ndc) * 0.5) * H

    for (let t = 0; t < indices.length; t += 3) {
      const ia = indices[t]
      const ib = indices[t + 1]
      const ic = indices[t + 2]

      const ax = view[ia * 3]
      const ay = view[ia * 3 + 1]
      const az = view[ia * 3 + 2]
      const bx = view[ib * 3]
      const by = view[ib * 3 + 1]
      const bz = view[ib * 3 + 2]
      const cx = view[ic * 3]
      const cy = view[ic * 3 + 1]
      const cz = view[ic * 3 + 2]

      // Alpha test: drop triangles the material would discard entirely. Doing it per
      // triangle rather than per fragment is a fine approximation for a diagnostic
      // render, and it removes the z-fighting speckle where a masked shell is
      // exactly coincident with the surface underneath it.
      if (alpha) {
        const a = (alpha[ia] + alpha[ib] + alpha[ic]) / 3
        if (a < alphaTest) continue
      }

      const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
      if (area === 0) continue
      if (!doubleSided && area > 0) continue

      const minX = Math.max(0, Math.floor(toPx(Math.min(ax, bx, cx))))
      const maxX = Math.min(W - 1, Math.ceil(toPx(Math.max(ax, bx, cx))))
      const minY = Math.max(0, Math.floor(toPy(Math.max(ay, by, cy))))
      const maxY = Math.min(H - 1, Math.ceil(toPy(Math.min(ay, by, cy))))
      if (minX > maxX || minY > maxY) continue

      const invArea = 1 / area

      for (let py = minY; py <= maxY; py++) {
        const sy = 1 - ((py + 0.5) / H) * 2
        for (let px = minX; px <= maxX; px++) {
          const sx = ((px + 0.5) / W) * 2 - 1
          const w0 = ((bx - ax) * (sy - ay) - (sx - ax) * (by - ay)) * invArea
          const w1 = ((sx - ax) * (cy - ay) - (cx - ax) * (sy - ay)) * invArea
          const w2 = 1 - w0 - w1
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue

          const depth = w2 * az + w1 * bz + w0 * cz
          const di = py * W + px
          if (depth >= this.depth[di]) continue
          this.depth[di] = depth

          let nx = w2 * vnorm[ia * 3] + w1 * vnorm[ib * 3] + w0 * vnorm[ic * 3]
          let ny = w2 * vnorm[ia * 3 + 1] + w1 * vnorm[ib * 3 + 1] + w0 * vnorm[ic * 3 + 1]
          let nz = w2 * vnorm[ia * 3 + 2] + w1 * vnorm[ib * 3 + 2] + w0 * vnorm[ic * 3 + 2]
          const nl = Math.hypot(nx, ny, nz) || 1
          nx /= nl
          ny /= nl
          nz /= nl
          // Shade with the normal facing the camera so back faces do not go black.
          if (nz < 0) {
            nx = -nx
            ny = -ny
            nz = -nz
          }

          let r = baseColor[0]
          let g = baseColor[1]
          let b = baseColor[2]

          if (texture && uv) {
            const u = w2 * uv.getX(ia) + w1 * uv.getX(ib) + w0 * uv.getX(ic)
            // three.js UV origin is bottom-left; texture storage is top-left.
            const v = 1 - (w2 * uv.getY(ia) + w1 * uv.getY(ib) + w0 * uv.getY(ic))
            const tx = Math.min(texture.width - 1, Math.max(0, Math.floor(u * texture.width)))
            const ty = Math.min(texture.height - 1, Math.max(0, Math.floor(v * texture.height)))
            const ti = (ty * texture.width + tx) * 4
            r = texture.data[ti] / 255
            g = texture.data[ti + 1] / 255
            b = texture.data[ti + 2] / 255
          }

          if (lights) {
            // Recover the fragment's world position from the interpolated view coords,
            // then hand it to the physical model. Affine, like everything else here.
            const fx = (w2 * view[ia * 3] + w1 * view[ib * 3] + w0 * view[ic * 3]) * depth * aspect / f
            const fy = (w2 * view[ia * 3 + 1] + w1 * view[ib * 3 + 1] + w0 * view[ic * 3 + 1]) * depth / f
            const fz = cameraDist - depth
            let vx = -fx
            let vy = -fy
            let vz = cameraDist - fz
            const vl = Math.hypot(vx, vy, vz) || 1
            vx /= vl
            vy /= vl
            vz /= vl

            // Point-light falloff is physical, so it needs physical distances: the
            // caller states how many metres one of its world units is worth.
            const toMetres = this.lightScale ?? 1
            const shaded = shadePhysically({
              albedo: [r, g, b],
              normal: [nx, ny, nz],
              viewDir: [vx, vy, vz],
              position: [fx * toMetres, fy * toMetres, fz * toMetres],
              lights,
              ambientColor: ambientLight ? ambientLight.color : [0, 0, 0],
              ambientIntensity: ambientLight ? ambientLight.intensity : 0,
              envIntensity,
              material: material ?? {},
            })
            this.color[di * 3] = shaded[0]
            this.color[di * 3 + 1] = shaded[1]
            this.color[di * 3 + 2] = shaded[2]
            continue
          }

          const ndl = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2])
          const ndv = Math.max(0, nz) // camera looks along -Z, so ndv == nz
          const rim = Math.pow(1 - ndv, 3) * rimStrength
          const lambert = ambient + ndl * 0.95

          this.color[di * 3] = r * lambert + rimColor[0] * rim * r
          this.color[di * 3 + 1] = g * lambert + rimColor[1] * rim * g
          this.color[di * 3 + 2] = b * lambert + rimColor[2] * rim * b
        }
      }
    }
  }

  /**
   * Copy another render's pixels into this one, at an offset.
   *
   * Both renders are already float buffers, so a comparison sheet does not need a PNG
   * decoder — the probe renders each pass and blits them side by side.
   */
  blit(other, dx, dy) {
    for (let y = 0; y < other.height; y++) {
      const ty = y + dy
      if (ty < 0 || ty >= this.height) continue
      for (let x = 0; x < other.width; x++) {
        const tx = x + dx
        if (tx < 0 || tx >= this.width) continue
        const si = (y * other.width + x) * 3
        const ti = (ty * this.width + tx) * 3
        this.color[ti] = other.color[si]
        this.color[ti + 1] = other.color[si + 1]
        this.color[ti + 2] = other.color[si + 2]
      }
    }
  }

  /** A vertical band of a flat colour, for the divider in a comparison sheet. */
  fillColumn(x, width, rgb) {
    for (let px = x; px < Math.min(this.width, x + width); px++) {
      for (let py = 0; py < this.height; py++) {
        const i = (py * this.width + px) * 3
        this.color[i] = rgb[0]
        this.color[i + 1] = rgb[1]
        this.color[i + 2] = rgb[2]
      }
    }
  }

  /** Simple ACES-ish tonemap + sRGB encode, then PNG. */
  toPng() {
    const out = new Uint8Array(this.width * this.height * 4)
    for (let i = 0; i < this.width * this.height; i++) {
      for (let c = 0; c < 3; c++) {
        let v = this.color[i * 3 + c] * this.exposure
        v = Math.max(0, v)
        // Narkowicz ACES approximation, then gamma.
        v = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)
        v = Math.min(1, Math.max(0, v))
        out[i * 4 + c] = Math.round(Math.pow(v, 1 / 2.2) * 255)
      }
      out[i * 4 + 3] = 255
    }
    return encodePng(out, this.width, this.height)
  }
}
