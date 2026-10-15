import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { stripTextures } from './lib/strip.mjs'
const ab = stripTextures(await readFile('public/models/facecap.glb'))
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
const gltf = await new Promise((r,j)=>loader.parse(ab,'',r,j))
for (const n of ['head','eyeLeft','eyeRight','teeth']) {
  const node = gltf.scene.getObjectByName(n); const m = node.children.find(c=>c.isMesh)
  const uv = m.geometry.attributes.uv
  let u0=1e9,u1=-1e9,v0=1e9,v1=-1e9
  for(let i=0;i<uv.count;i++){const u=uv.getX(i),v=uv.getY(i);if(u<u0)u0=u;if(u>u1)u1=u;if(v<v0)v0=v;if(v>v1)v1=v}
  console.log(`${n.padEnd(9)} uv u: ${u0.toFixed(4)} .. ${u1.toFixed(4)}   v: ${v0.toFixed(4)} .. ${v1.toFixed(4)}  normalized=${uv.normalized} type=${uv.array.constructor.name}`)
}
const mat = gltf.scene.getObjectByName('head').children.find(c=>c.isMesh).material
console.log('\nmaterial:', mat.type, 'map:', mat.map ? 'present' : 'none')
console.log('map repeat/offset:', mat.map && [mat.map.repeat.x, mat.map.repeat.y, mat.map.offset.x, mat.map.offset.y].map(v=>v.toExponential(3)).join(', '))
