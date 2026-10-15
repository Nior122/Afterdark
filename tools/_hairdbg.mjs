import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { register } from 'node:module'
import { stripTextures } from './lib/strip.mjs'
register(new URL('../scripts/ts-loader.mjs', import.meta.url).href)
class Ctx{constructor(){this.fillStyle='';this.filter='';this.globalAlpha=1}fillRect(){}beginPath(){}moveTo(){}lineTo(){}closePath(){}fill(){}drawImage(){}}
globalThis.document={createElement:(t)=>t==='canvas'?{width:0,height:0,getContext:()=>new Ctx()}:{}}
const { measureHead, buildHair } = await import('../src/avatar/local/buildHead.ts')
const ab = stripTextures(await readFile('public/models/facecap.glb'))
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
const gltf = await new Promise((r,j)=>loader.parse(ab,'',r,j))
const scene=gltf.scene; scene.updateMatrixWorld(true)
const headMesh = scene.getObjectByName('head').children.find(c=>c.isMesh)
const m = measureHead(headMesh)
console.log('chin', m.chinY.toFixed(3), 'crown', m.crownY.toFixed(3), 'hairlineY', (m.chinY+m.height*0.80).toFixed(3))
const hair = buildHair(headMesh, m, {fullness:0.85})
// world bbox of the hair, if parented like the app will do
headMesh.add(hair.mesh); scene.updateMatrixWorld(true)
const hb = new THREE.Box3().setFromObject(hair.mesh)
const kb = new THREE.Box3().setFromObject(headMesh)
console.log('head world bbox :', kb.min.toArray().map(v=>v.toFixed(3)).join(','), '->', kb.max.toArray().map(v=>v.toFixed(3)).join(','))
console.log('hair world bbox :', hb.min.toArray().map(v=>v.toFixed(3)).join(','), '->', hb.max.toArray().map(v=>v.toFixed(3)).join(','))
console.log('hair mesh matrixWorld det/scale:', hair.mesh.matrixWorld.determinant().toExponential(3))
// how much did vertices actually move?
const src = headMesh.geometry.attributes.position, dst = hair.mesh.geometry.attributes.position
let maxD=0, sumD=0, moved=0
for(let i=0;i<src.count;i++){
  const d=Math.hypot(dst.getX(i)-src.getX(i), dst.getY(i)-src.getY(i), dst.getZ(i)-src.getZ(i))
  if(d>1e-6) {moved++; sumD+=d} ; if(d>maxD)maxD=d
}
console.log(`vertices displaced: ${moved}/${src.count}  maxD=${maxD.toExponential(3)}  meanD=${(sumD/Math.max(moved,1)).toExponential(3)} (local units)`)
console.log('=> world-space max displacement:', (maxD*(m.worldScale||1)).toExponential(3))
// where are the displaced verts in world Y?
const v=new THREE.Vector3(); const ys=[]
for(let i=0;i<dst.count;i++){ if(scalpProbe(i)) { v.set(dst.getX(i),dst.getY(i),dst.getZ(i)).applyMatrix4(hair.mesh.matrixWorld); ys.push(v.y) } }
function scalpProbe(i){ const d=Math.hypot(dst.getX(i)-src.getX(i),dst.getY(i)-src.getY(i),dst.getZ(i)-src.getZ(i)); return d>1e-6 }
if(ys.length){ console.log('displaced world Y range:', Math.min(...ys).toFixed(3), '->', Math.max(...ys).toFixed(3)) }
console.log('material:', hair.mesh.material.type, 'alphaTest', hair.mesh.material.alphaTest, 'alphaMap', !!hair.mesh.material.alphaMap, 'side', hair.mesh.material.side)
