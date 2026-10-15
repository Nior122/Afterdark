import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
const { stripTextures } = await import('./lib/strip.mjs')
const raw = await readFile('public/models/facecap.glb')
const ab = stripTextures(raw)
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
const gltf = await new Promise((res,rej)=>loader.parse(ab,'',res,rej))
const scene = gltf.scene; scene.updateMatrixWorld(true)
const box = new THREE.Box3()
for (const name of ['head','eyeLeft','eyeRight','teeth']) {
  const o = scene.getObjectByName(name); const m = o.isMesh?o:o.children.find(c=>c.isMesh)
  const g = m.geometry; 
  for(let i=0;i<g.attributes.position.count;i++){
    const v = new THREE.Vector3(g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)).applyMatrix4(m.matrixWorld)
    box.expandByPoint(v)
  }
}
const s=box.getSize(new THREE.Vector3()), c=box.getCenter(new THREE.Vector3())
console.log('DEQUANTISED world bbox size :', s.x.toFixed(4), s.y.toFixed(4), s.z.toFixed(4))
console.log('DEQUANTISED world center    :', c.x.toFixed(4), c.y.toFixed(4), c.z.toFixed(4))
console.log('head height as fraction of a 0.235m head:', (s.y/0.235).toFixed(2), 'units per real head')
console.log('=> required root scale      :', (0.235/s.y).toFixed(5))
// eye pivots world
for (const n of ['head','grp_eyeLeft','grp_eyeRight','teeth']) {
  const o = scene.getObjectByName(n)
  const p = o.getWorldPosition(new THREE.Vector3())
  console.log(`  ${n.padEnd(14)} world pos = ${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)}`)
}
