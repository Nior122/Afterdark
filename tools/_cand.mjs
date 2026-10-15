import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

const files = [
  ['Michelle.glb','/tmp/tj/examples/models/gltf/Michelle.glb'],
  ['Xbot.glb','/tmp/tj/examples/models/gltf/Xbot.glb'],
  ['tennyson-bust.glb','/tmp/tj/examples/models/gltf/tennyson-bust.glb'],
  ['venice_mask.glb','/tmp/tj/examples/models/gltf/venice_mask.glb'],
  ['kira.glb','/tmp/tj/examples/models/gltf/kira.glb'],
  ['nemetona.glb','/tmp/tj/examples/models/gltf/nemetona.glb'],
  ['Soldier.glb','/tmp/tj/examples/models/gltf/Soldier.glb'],
]
for (const [label, path] of files) {
  try {
    const raw = await readFile(path)
    const b = Buffer.from(raw); const total = b.readUInt32LE(8); let off=12, json=null
    while(off<total){const cl=b.readUInt32LE(off),ct=b.readUInt32LE(off+4);
      if(ct===0x4e4f534a) json=JSON.parse(b.subarray(off+8,off+8+cl).toString('utf8')); off+=8+cl}
    const allTargets = new Set()
    let nodeNames=[]
    for (const m of json.meshes??[]) for (const p of m.primitives??[]) {
      const names = m.extras?.targetNames ?? []
      names.forEach(n=>allTargets.add(n))
      if(p.targets) allTargets.add(`<${p.targets.length} unnamed targets>`)
    }
    const extras = json.meshes?.flatMap(m=>m.extras?.targetNames??[]) ?? []
    extras.forEach(n=>{allTargets.delete('<'+ (json.meshes[0].primitives[0].targets?.length) +' unnamed targets>')})
    nodeNames = (json.nodes??[]).map(n=>n.name).filter(Boolean)
    const hasSkin = !!json.skins
    const isArk = extras.some(n=>/^(eyeBlinkLeft|jawOpen|browDownLeft|mouthSmileLeft)$/.test(n))
    console.log(`${label.padEnd(20)} meshes=${(json.meshes??[]).length} skins=${hasSkin?json.skins.length:0} anims=${(json.animations??[]).length} morphNames=${extras.length} ARKitLike=${isArk}`)
    if (extras.length && extras.length<60) console.log('   targets:', extras.slice(0,12).join(',')+(extras.length>12?'…':''))
    const interesting = nodeNames.filter(n=>/hair|head|neck|shoulder|spine|torso|body|eye|teeth|tongue|jaw/i.test(n))
    if (interesting.length) console.log('   nodes:', interesting.slice(0,14).join(', '))
  } catch (e) { console.log(`${label.padEnd(20)} ERROR ${e.message.slice(0,60)}`) }
}
