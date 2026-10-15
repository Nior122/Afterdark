import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

const buf = await readFile(new URL('../public/models/facecap.glb', import.meta.url))
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
await new Promise((res, rej) => {
  loader.parse(ab, '', (gltf) => {
    const root = gltf.scene
    console.log('=== hierarchy ===')
    root.traverse((o) => {
      const g = o
      const extra = g.isMesh ? ` [mesh verts=${g.geometry.attributes.position.count} morphs=${g.morphTargetInfluences?.length ?? 0}]` : ''
      console.log('  '.repeat(depth(root,o)) + `${o.type} "${o.name}"${extra}`)
    })
    function depth(r,n){let d=0,c=n;while(c.parent&&c!==r){d++;c=c.parent}return d}
    root.updateMatrixWorld(true)
    console.log('=== morph target names on head mesh ===')
    root.traverse((o)=>{ if(o.isMesh && o.morphTargetDictionary){ console.log(' mesh', o.name, Object.keys(o.morphTargetDictionary).length, 'targets'); console.log(' ', JSON.stringify(Object.keys(o.morphTargetDictionary))) } })
    console.log('=== world bboxes ===')
    root.traverse((o)=>{
      if(!o.isMesh) return
      const b=new THREE.Box3().setFromObject(o)
      const s=b.getSize(new THREE.Vector3()), c=b.getCenter(new THREE.Vector3())
      console.log(`  ${o.name||'(unnamed)'} size=${s.x.toFixed(4)},${s.y.toFixed(4)},${s.z.toFixed(4)} center=${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)}`)
    })
    console.log('=== node pivots ===')
    for(const n of ['head','grp_eyeLeft','grp_eyeRight','grp_transform','grp_scale','Empty','teeth','eyeLeft','eyeRight']){
      const o=root.getObjectByName(n)
      if(o){const p=o.getWorldPosition(new THREE.Vector3());const q=o.getWorldQuaternion(new THREE.Quaternion())
        console.log(`  ${n}: pos=${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)} quat=${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)},${q.w.toFixed(3)}`)}
      else console.log(`  ${n}: MISSING`)
    }
    console.log('materials:', gltf.scene.children.flatMap(c=>[]).length)
    root.traverse(o=>{ if(o.isMesh){ const m=o.material; console.log(`  mat on ${o.name}: ${m.type} map=${m.map?'yes':'no'} metal=${m.metalness} rough=${m.roughness} side=${m.side}`)}})
    res()
  }, rej)
})
console.log('OK: three GLTFLoader works headlessly under Node')
