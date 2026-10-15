/**
 * Render the assembled bust (scanned head + procedural neck/shoulders/hair) to PNG
 * so the procedural geometry can be judged visually rather than merely compiled.
 *
 * Usage: node tools/build-probe.mjs
 *
 * Scene assembly lives in tools/lib/bust.mjs, shared with tools/realism-probe.mjs.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Renderer } from './lib/raster.mjs'
import { loadBust, ROOT, W, H } from './lib/bust.mjs'

async function main() {
  const outDir = join(ROOT, 'tools', 'out')
  await mkdir(outDir, { recursive: true })

  const { m, headMesh, bustGeo, hair, drawShot } = await loadBust()

  console.log('Head metrics (WORLD space):')
  console.log(`  halfWidth  : ${m.halfWidth.toFixed(4)}`)
  console.log(`  height     : ${m.height.toFixed(4)}`)
  console.log(`  depth      : ${m.depth.toFixed(4)}`)
  console.log(`  center     : ${m.center.x.toFixed(4)}, ${m.center.y.toFixed(4)}, ${m.center.z.toFixed(4)}`)
  console.log(`  chin / crown: ${m.chinY.toFixed(4)} / ${m.crownY.toFixed(4)}`)
  console.log(`  forward    : ${m.forwardSign > 0 ? '+Z' : '-Z'}`)
  console.log(`  worldScale : ${m.worldScale.toFixed(5)}  -> real-world scale would be ${(0.235 / m.height).toFixed(4)}`)

  const pos = bustGeo.attributes.position
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ
  console.log(`\nBust: ${pos.count} verts, ${bustGeo.index.count / 3} tris`)
  console.log(`  size          : ${sx.toFixed(3)} x ${sy.toFixed(3)} x ${sz.toFixed(3)}`)
  console.log(`  shoulder span : ${(sx / (2 * m.halfWidth)).toFixed(2)}x head width`)
  console.log(`  vertical drop : ${(sy / m.height).toFixed(2)} head-heights`)
  console.log(`  bust y range  : ${minY.toFixed(3)} .. ${maxY.toFixed(3)}  (chin ${m.chinY.toFixed(3)}, crown ${m.crownY.toFixed(3)})`)
  console.log(`\nHair shell: ${hair.mesh.geometry.attributes.position.count} verts, scalpFraction=${(hair.scalpFraction * 100).toFixed(1)}%`)
  console.log(`  parented to: ${hair.mesh.parent.name || hair.mesh.parent.type}`)
  console.log(`  morph targets on the head mesh: ${Object.keys(headMesh.morphTargetDictionary ?? {}).length}`)

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
    drawShot(r, yaw, opts)
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
