/**
 * Realism before/after probe.
 *
 * Renders the bust twice through the offline rasteriser: once with the lighting and
 * material constants as they were before the realism pass, once with the values the app
 * ships now. This exists because the environment has no browser, and "skin looks more
 * like skin now" is not a claim that can be supported by a diff of two numbers alone.
 *
 * The "after" preset is not a copy of the constants — it imports them:
 *
 *   - lights, ambient, environment intensity and exposure  from src/render/lighting.ts
 *   - skin / eye / teeth material response                 from the real materials that
 *     src/avatar/local/buildHead.ts constructs, read off the live instances
 *   - hair                                                 from the hair mesh the probe
 *     built with buildHair()
 *
 * So if someone edits lighting.ts and forgets this file, the render changes with the app.
 * The "before" preset is frozen at commit feb7732 and cannot drift, by design.
 *
 * Usage: node tools/realism-probe.mjs
 *
 * Writes tools/out/realism-{before,after,compare}.png. The compare sheet is the two
 * renders blitted side by side; before is on the left.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as THREE from 'three'
import { Renderer } from './lib/raster.mjs'
import { distanceAttenuation } from './lib/shade.mjs'
import { loadBust, PROBE_COLORS, ROOT, W, H } from './lib/bust.mjs'

// --- the app's own numbers -------------------------------------------------
const lighting = await import('../src/render/lighting.ts')
const { createSkinMaterial, createEyeMaterial, createTeethMaterial } = await import(
  '../src/avatar/local/buildHead.ts'
)
const { HEAD_HEIGHT_METRES } = await import('../src/avatar/constants.ts')

const linear = (color) => [color.r, color.g, color.b]

/**
 * Diffuse reflectance of medium human skin, linear.
 *
 * The probe paints flat colour instead of sampling an albedo map, so this number does the
 * same job the skin texture does in the app. Getting it from the literature rather than
 * from taste matters: at 0.82 (the value the geometry probe uses, chosen for legibility in
 * a flat-lit render) the face clips under a 2.45 key and every comparison looks like a
 * comparison of two blown highlights.
 */
const SKIN_ALBEDO = [0.46, 0.32, 0.27]

/**
 * The pre-pass preset, frozen from commit feb7732 — the last commit before the realism
 * pass. Values transcribed from that revision of src/render/lighting.ts and
 * src/avatar/local/buildHead.ts. Never update these; that is the point of them.
 */
const BEFORE = {
  label: 'before',
  commit: 'feb7732',
  intensity: { key: 2.15, fill: 0.85, rim: 1.45, bounce: 0.35, ambient: 0.32 },
  colors: {
    key: [0.956, 0.878, 0.769],
    fill: [0.827, 0.902, 1.0],
    rim: [0.478, 0.706, 1.0],
    bounce: [1.0, 0.706, 0.529],
    ambient: [0.022, 0.028, 0.049],
  },
  envIntensity: 0.55,
  exposure: 0.94,
  lights: ['key', 'fill', 'rim', 'bounce'],
  /** As shipped pre-pass: a point light with decay 2, 0.6 m cutoff, ~0.18 m from the chest. */
  bounce: { distance: 0.6, decay: 2 },
  materials: {
    head: { albedo: SKIN_ALBEDO, roughness: 0.62, specularIntensity: 1, sheen: 0.55, sheenColor: [1.0, 0.276, 0.167], clearcoat: 0.16, clearcoatRoughness: 0.35 },
    bust: { albedo: SKIN_ALBEDO, roughness: 0.62, specularIntensity: 1, sheen: 0.55, sheenColor: [1.0, 0.276, 0.167], clearcoat: 0.16, clearcoatRoughness: 0.35 },
    eye: { roughness: 0.08, specularIntensity: 1, sheen: 0.2, sheenColor: [1, 1, 1], clearcoat: 1, clearcoatRoughness: 0.02 },
  },
}

const AFTER = {
  label: 'after',
  commit: 'working tree',
  intensity: lighting.INTENSITY,
  colors: {
    key: linear(lighting.STUDIO_COLORS.key),
    fill: linear(lighting.STUDIO_COLORS.fill),
    rim: linear(lighting.STUDIO_COLORS.rim),
    bounce: linear(lighting.STUDIO_COLORS.bounce),
    ambient: linear(lighting.STUDIO_COLORS.ambient),
    top: linear(lighting.STUDIO_COLORS.top),
    catchlight: linear(lighting.STUDIO_COLORS.catchlight),
  },
  envIntensity: lighting.ENV_INTENSITY,
  exposure: lighting.EXPOSURE,
  lights: ['key', 'fill', 'rim', 'bounce', 'top', 'catchlight'],
  bounce: lighting.BOUNCE,
}

/** Read a live three material's response parameters, in the shape shade.mjs wants. */
const readMaterial = (mat) => ({
  roughness: mat.roughness,
  specularIntensity: mat.specularIntensity ?? 1,
  sheen: mat.sheen ?? 0,
  sheenColor: mat.sheenColor ? linear(mat.sheenColor) : [1, 1, 1],
  clearcoat: mat.clearcoat ?? 0,
  clearcoatRoughness: mat.clearcoatRoughness ?? 0.05,
})

async function main() {
  const outDir = join(ROOT, 'tools', 'out')
  await mkdir(outDir, { recursive: true })

  const bust = await loadBust()
  const { m, hair, drawShot } = bust
  const unitToMetres = HEAD_HEIGHT_METRES / (m.height * scaleOf(bust))

  // --- the materials, as the app constructs them -------------------------
  const skin = createSkinMaterial()
  const eye = createEyeMaterial()
  const teeth = createTeethMaterial()
  const hairMat = hair.mesh.material

  const liveAfter = {
    head: { ...readMaterial(skin), albedo: SKIN_ALBEDO },
    bust: { ...readMaterial(skin), albedo: SKIN_ALBEDO },
    eye: readMaterial(eye),
    teeth: readMaterial(teeth),
    hair: readMaterial(hairMat),
  }
  const beforeHair = { roughness: 0.4, specularIntensity: 1, sheen: 0.9, sheenColor: [0.41, 0.33, 0.29], clearcoat: 0.3, clearcoatRoughness: 0.4 }

  console.log('Live material response (read from the app\'s own materials):')
  for (const [name, mat] of Object.entries(liveAfter)) {
    console.log(
      `  ${name.padEnd(6)} roughness=${mat.roughness.toFixed(2)} spec=${mat.specularIntensity.toFixed(2)} ` +
        `sheen=${mat.sheen.toFixed(2)} clearcoat=${mat.clearcoat.toFixed(2)}/${mat.clearcoatRoughness.toFixed(2)}`,
    )
  }
  console.log(`  eye envMapIntensity=${eye.envMapIntensity.toFixed(2)} ior=${eye.ior.toFixed(3)}`)
  console.log(`  skin ior=${skin.ior.toFixed(3)} normalScale=${skin.normalScale.x}`)

  /** Turn a preset + the scene's unit scale into rasteriser light records. */
  const buildLights = (preset, materials) => {
    const positions = lighting.studioLightPositions(HEAD_HEIGHT_METRES)
    const lights = []
    for (const name of preset.lights) {
      const dir = positions[name] // already scaled to metres by headSize
      const color = preset.colors[name]
      const intensity = preset.intensity[name]
      if (name === 'bounce') {
        lights.push({ kind: 'point', position: dir, color, intensity, ...preset.bounce })
      } else {
        lights.push({ kind: 'directional', dir, color, intensity })
      }
    }
    // Positions are in metres; the rasteriser works in head-height units, so tell it the
    // conversion rather than pre-scaling, so the `distance` cutoff keeps its meaning.
    return { lights, materials }
  }

  const render = (preset, { yaw = 0, morph = null, zoom = 1 } = {}) => {
    const materials = preset === BEFORE ? { ...BEFORE.materials, hair: beforeHair, teeth: BEFORE.materials.head } : { ...liveAfter }
    const { lights } = buildLights(preset, materials)
    const r = new Renderer(W, H)
    r.exposure = preset.exposure
    r.lightScale = unitToMetres
    drawShot(r, yaw, {
      morph,
      zoom,
      shading: {
        lights,
        ambientLight: { color: preset.colors.ambient, intensity: preset.intensity.ambient },
        envIntensity: preset.envIntensity,
        materials,
      },
    })
    return r
  }

  // --- quantitative check -------------------------------------------------
  // Point-light irradiance at the distance that actually matters (the light sits ~0.18 m
  // off the chest), so the sheet below is not the only evidence that the numbers changed.
  const REFERENCE_DISTANCE = 0.18
  console.log('\nPoint-light irradiance at the chest, 180 mm from the light:')
  for (const preset of [BEFORE, AFTER]) {
    const b = preset.bounce
    const att = distanceAttenuation(REFERENCE_DISTANCE, b.distance, b.decay)
    console.log(
      `  ${preset.label.padEnd(6)} bounce=${preset.intensity.bounce.toFixed(2)} decay=${b.decay} cutoff=${b.distance} m` +
        ` -> attenuation ${att.toFixed(2)}, irradiance ${(preset.intensity.bounce * att).toFixed(2)}`,
    )
  }

  const SMILE = { mouthSmile_L: 0.35, mouthSmile_R: 0.35 }

  const shots = [
    ['realism-after-3q', AFTER, { yaw: -28, morph: SMILE }],
    ['realism-after', AFTER, {}],
    ['realism-before', BEFORE, {}],
    ['realism-before-3q', BEFORE, { yaw: -28, morph: SMILE }],
    // Close-ups. At this crop the things the pass actually changed are visible: the
    // specular lobe on the forehead and nose, the sheen at the jaw's grazing angle, and
    // the corneal highlights.
    ['realism-face-after', AFTER, { yaw: -18, morph: SMILE, zoom: 1.9 }],
    ['realism-face-before', BEFORE, { yaw: -18, morph: SMILE, zoom: 1.9 }],
  ]

  const rendered = {}
  console.log('\nRenders:')
  for (const [name, preset, opts] of shots) {
    const r = render(preset, opts)
    rendered[name] = r
    const bytes = r.toPng()
    await writeFile(join(outDir, `${name}.png`), bytes)
    console.log(`  → tools/out/${name}.png  (${(bytes.length / 1024).toFixed(0)} KB)`)
  }

  // --- side-by-side sheets -------------------------------------------------
  for (const [name, left, right] of [
    ['realism-compare', rendered['realism-before'], rendered['realism-after']],
    ['realism-compare-3q', rendered['realism-before-3q'], rendered['realism-after-3q']],
    ['realism-compare-face', rendered['realism-face-before'], rendered['realism-face-after']],
  ]) {
    const sheet = new Renderer(W * 2 + 4, H)
    sheet.exposure = 1
    sheet.blit(left, 0, 0)
    sheet.fillColumn(W, 4, [0.5, 0.5, 0.55])
    sheet.blit(right, W + 4, 0)
    const bytes = sheet.toPng()
    await writeFile(join(outDir, `${name}.png`), bytes)
    console.log(`  → tools/out/${name}.png  (${(bytes.length / 1024).toFixed(0)} KB)  [before | after]`)
  }

  console.log('\nRealism probe complete.\n')
}

/** Recover the framing scale the probe applied, so metres-per-unit is exact. */
function scaleOf(bust) {
  // loadBust() derives the scale from the measured head; recompute it the same way rather
  // than exporting another number that could drift.
  const { m } = bust
  const verticalExtent = 2 * 3.1 * Math.tan(((32 * Math.PI) / 180) / 2)
  const viewTop = m.crownY + 0.14 * m.height
  const viewBottom = m.chinY - 1.05 * m.height
  return (0.985 * verticalExtent) / (viewTop - viewBottom)
}

main().catch((e) => {
  console.error(`\n✗ ${e.stack ?? e.message}\n`)
  process.exit(1)
})
