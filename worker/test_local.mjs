/**
 * Local test harness for worker.js — no Cloudflare or Telegram account needed.
 * Run:  node worker/test_local.mjs
 * Mocks KV storage and the Telegram Bot API, then drives the worker through
 * the full publish flow (claim ownership -> forward video -> feed -> stream).
 */
import worker from './worker.js'

const TOKEN = 'TESTTOKEN'
const SECRET = 's3cr3t'
const MP4 = new TextEncoder().encode('0123456789ABCDEFGHIJ') // fake video bytes
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

let sentMessages = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  if (u === `https://api.telegram.org/bot${TOKEN}/sendMessage`) {
    sentMessages.push(JSON.parse(opts.body))
    return Response.json({ ok: true, result: {} })
  }
  if (u === `https://api.telegram.org/bot${TOKEN}/getFile`) {
    const { file_id } = JSON.parse(opts.body)
    return Response.json({ ok: true, result: { file_path: `files/${file_id}` } })
  }
  if (u.startsWith(`https://api.telegram.org/file/bot${TOKEN}/files/`)) {
    const fileId = u.split('/files/')[1]
    const bytes = fileId.startsWith('thumb') ? JPG : MP4
    const range = opts.headers?.Range || opts.headers?.range
    if (range) {
      const [start, end] = range.replace('bytes=', '').split('-').map(Number)
      const slice = bytes.slice(start, (end || bytes.length - 1) + 1)
      return new Response(slice, {
        status: 206,
        headers: {
          'Content-Type': fileId.startsWith('thumb') ? 'image/jpeg' : 'video/mp4',
          'Content-Length': String(slice.length),
          'Content-Range': `bytes ${start}-${start + slice.length - 1}/${bytes.length}`,
        },
      })
    }
    return new Response(bytes, {
      headers: {
        'Content-Type': fileId.startsWith('thumb') ? 'image/jpeg' : 'video/mp4',
        'Content-Length': String(bytes.length),
      },
    })
  }
  return realFetch(url, opts)
}

class MockKV {
  constructor() { this.map = new Map() }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null }
  async put(k, v) { this.map.set(k, String(v)) }
  async delete(k) { this.map.delete(k) }
}

function makeCtx() {
  const pending = []
  return { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})) }, flush: () => Promise.all(pending.splice(0)) }
}

async function call(env, url, opts = {}) {
  const ctx = makeCtx()
  const res = await worker.fetch(new Request(url, opts), env, ctx)
  await ctx.flush()
  return res
}

function webhook(env, update, secret = SECRET) {
  return call(env, 'https://worker.test/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(update),
  })
}

const msg = (fromId, extra) => ({ message: { message_id: 1, date: 0, chat: { id: fromId, type: 'private' }, from: { id: fromId }, ...extra } })
const videoMsg = (fromId, uniq, over = {}) => msg(fromId, {
  caption: 'My Clip #POV #big_ass',
  video: {
    file_id: `vid-${uniq}`, file_unique_id: uniq, file_name: 'clip.mp4',
    duration: 74, width: 720, height: 1280, file_size: 5 * 1048576,
    thumbnail: { file_id: `thumb-${uniq}` }, ...over,
  },
})

let passed = 0, failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name} ${extra}`) }
}
const lastText = () => sentMessages.at(-1)?.text || ''

async function main() {
  const env = { BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET, VIDEOS: new MockKV() }

  console.log('— basics')
  check('health ok', (await call(env, 'https://worker.test/health')).status === 200)
  check('bad webhook secret -> 401', (await webhook(env, msg(111, { text: '/start' }), 'wrong')).status === 401)

  console.log('— ownership')
  await webhook(env, msg(111, { text: '/start' }))
  check('first /start claims ownership', lastText().includes('now the owner'))
  await webhook(env, msg(222, { text: '/id' }))
  check('/id reports user id', lastText().includes('222'))
  await webhook(env, videoMsg(222, 'stranger1'))
  check('stranger video denied', lastText().includes('not authorised'))
  let feed = await (await call(env, 'https://worker.test/api/videos')).json()
  check('feed still empty', feed.videos.length === 0)

  console.log('— publishing')
  await webhook(env, videoMsg(111, 'uniqA'))
  check('owner video posted', lastText().includes('Posted to the website') && lastText().includes('1:14'), lastText())
  feed = await (await call(env, 'https://worker.test/api/videos')).json()
  const v = feed.videos[0] || {}
  check('feed has 1 video', feed.videos.length === 1)
  check('title from caption', v.title === 'My Clip', JSON.stringify(v))
  check('category from hashtag', v.category === 'POV')
  check('tags parsed', v.tags?.includes('Big Ass') && v.tags?.includes('Telegram'), JSON.stringify(v.tags))
  check('stream/thumb urls', v.streamUrl?.endsWith('/stream.mp4') && v.thumbUrl?.endsWith('/thumb.jpg'))
  check('no token/file_id in feed', !JSON.stringify(feed).includes(TOKEN) && !('fileId' in v))

  await webhook(env, videoMsg(111, 'uniqA'))
  check('duplicate detected', lastText().includes('already on the website'))
  feed = await (await call(env, 'https://worker.test/api/videos')).json()
  check('feed still 1 after duplicate', feed.videos.length === 1)

  await webhook(env, videoMsg(111, 'uniqBig', { file_size: 25 * 1048576 }))
  check('oversize warned', lastText().includes('20 MB'))
  feed = await (await call(env, 'https://worker.test/api/videos')).json()
  check('oversize not in feed', feed.videos.length === 1)

  console.log('— streaming')
  const id = feed.videos[0].id
  const ranged = await call(env, `https://worker.test/api/videos/${id}/stream.mp4`, { headers: { Range: 'bytes=2-5' } })
  const rangedBody = await ranged.text()
  check('range -> 206 + slice + content-range', ranged.status === 206 && rangedBody === '2345' && !!ranged.headers.get('content-range'))
  const full = await call(env, `https://worker.test/api/videos/${id}/stream.mp4`)
  check('full stream ok', full.status === 200 && (await full.text()) === '0123456789ABCDEFGHIJ')
  check('no token in stream headers', ![...full.headers.values()].join(' ').includes(TOKEN))
  const thumb = await call(env, `https://worker.test/api/videos/${id}/thumb.jpg`)
  check('thumb ok', thumb.status === 200 && thumb.headers.get('content-type') === 'image/jpeg')
  check('unknown id -> 404', (await call(env, 'https://worker.test/api/videos/tg-nope/stream.mp4')).status === 404)

  console.log('— channel posts')
  const chanPost = { channel_post: { message_id: 9, date: 0, chat: { id: -100123, type: 'channel', title: 'My Channel' }, caption: 'Chan vid', video: { file_id: 'vid-chan', file_unique_id: 'chan1', duration: 10, file_size: 1000 } } }
  sentMessages = []
  await webhook(env, chanPost)
  check('unknown channel -> owner DM with instructions', lastText().includes('auto-posting is off') && lastText().includes('-100123'))
  await webhook(env, chanPost)
  check('channel DM throttled', sentMessages.length === 1)

  console.log('— list & remove')
  await webhook(env, msg(111, { text: '/list' }))
  check('/list shows videos incl oversize mark', lastText().includes('My Clip') && lastText().includes('over 20 MB'))
  await webhook(env, msg(111, { text: `/remove ${id}` }))
  check('removed', lastText().includes('Removed'))
  feed = await (await call(env, 'https://worker.test/api/videos')).json()
  check('feed empty after remove', feed.videos.length === 0)

  console.log('— allowlist env mode')
  const env2 = { BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET, VIDEOS: new MockKV(), ALLOWED_USER_IDS: '999', ALLOWED_CHANNEL_IDS: '-100123' }
  await webhook(env2, msg(111, { text: '/start' }))
  check('allowlist: 111 does not claim', !lastText().includes('now the owner'))
  await webhook(env2, videoMsg(999, 'uniqZ'))
  check('allowlisted user posts', lastText().includes('Posted to the website'))
  await webhook(env2, chanPost)
  const feed2 = await (await call(env2, 'https://worker.test/api/videos')).json()
  check('approved channel auto-posts', feed2.videos.some((x) => x.title === 'Chan vid'), JSON.stringify(feed2.videos.map((x) => x.title)))

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
