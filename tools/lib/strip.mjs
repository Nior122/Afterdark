/** Rebuild a GLB with texture/image references removed so it parses headlessly. */
export function stripTextures(glbBuffer) {
  const buf = Buffer.from(glbBuffer)
  const total = buf.readUInt32LE(8)
  let offset = 12, json = null
  const bin = []
  while (offset < total) {
    const len = buf.readUInt32LE(offset), type = buf.readUInt32LE(offset + 4)
    const body = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8')); else bin.push(Buffer.from(body))
    offset += 8 + len
  }
  json.images = []; json.textures = []; json.samplers = []
  for (const m of json.materials ?? []) {
    if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture
    if (m.extensions?.KHR_texture_transform) delete m.extensions.KHR_texture_transform
  }
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => e !== 'KHR_texture_basisu' && e !== 'KHR_texture_transform')
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const jPad = Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)
  const binBuf = Buffer.concat(bin)
  const bPad = Buffer.alloc((4 - (binBuf.length % 4)) % 4, 0)
  const chunks = [Buffer.concat([jsonBuf, jPad]), Buffer.concat([binBuf, bPad])]
  const header = Buffer.alloc(12)
  const totalLen = 12 + chunks.reduce((a, c) => a + 8 + c.length, 0)
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(totalLen, 8)
  const parts = [header]
  chunks.forEach((c, i) => {
    const h = Buffer.alloc(8); h.writeUInt32LE(c.length, 0); h.writeUInt32LE(i === 0 ? 0x4e4f534a : 0x004e4942, 4)
    parts.push(h, c)
  })
  const out = Buffer.concat(parts)
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}
