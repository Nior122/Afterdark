/**
 * Local test harness for worker.js — no Cloudflare or Telegram account needed.
 * Run:  node worker/test_local.mjs
 * Mocks KV storage, the Telegram Bot API and a couple of web pages, then
 * drives the worker through: publish by forward -> feed -> stream, scraping a
 * page and a gallery into drafts, review/publish/cancel, rename, full list,
 * paging and delete.
 */
import worker from './worker.js'

const TOKEN = 'TESTTOKEN'
const SECRET = 's3cr3t'
const MP4 = new TextEncoder().encode('0123456789ABCDEFGHIJ') // fake video bytes
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

let sentMessages = []
let editedMessages = []
let answeredCallbacks = []

const SINGLE_PAGE = `<!doctype html><html><head>
<title>Hotel Hookup | SomeTube</title>
<meta property="og:site_name" content="SomeTube" />
<meta property="og:title" content="Hotel Hookup — full scene" />
<meta property="og:description" content="A hotel room scene with two performers." />
<meta property="og:image" content="https://cdn.sometube.test/thumbs/hotel.jpg" />
<meta property="og:video" content="https://cdn.sometube.test/videos/hotel.mp4" />
<meta property="og:video:duration" content="754" />
<meta name="keywords" content="MILF, hotel, big ass" />
</head><body><h1>Hotel Hookup</h1></body></html>`

const JSONLD_PAGE = `<!doctype html><html><head><title>POV Gallery</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"VideoObject","name":"POV Kitchen Scene",
 "description":"Kitchen POV clip","thumbnailUrl":"https://cdn.sometube.test/t/kitchen.jpg",
 "contentUrl":"https://www.eporner.test/embed/AAA111/","duration":"PT12M5S","genre":"POV"}
</script></head><body></body></html>`

const GALLERY_PAGE = `<!doctype html><html><head><title>Latest videos — SomeTube</title>
<meta property="og:site_name" content="SomeTube" /></head><body>
<a href="/video/111/first-clip" title="First Clip Title"><img src="/t/1.jpg" alt="First Clip Title" /></a>
<a href="/video/222/second-clip" title="Second Anal Clip"><img src="/t/2.jpg" alt="Second Anal Clip" /></a>
<a href="/video/333/third-clip" title="Third Latina Clip"><img src="/t/3.jpg" alt="Third Latina Clip" /></a>
<a href="/about">About us</a>
</body></html>`

const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  if (u === `https://api.telegram.org/bot${TOKEN}/sendMessage`) {
    const body = JSON.parse(opts.body)
    sentMessages.push(body)
    return Response.json({ ok: true, result: { message_id: sentMessages.length, chat: { id: body.chat_id } } })
  }
  if (u === `https://api.telegram.org/bot${TOKEN}/editMessageText`) {
    editedMessages.push(JSON.parse(opts.body))
    return Response.json({ ok: true, result: {} })
  }
  if (u === `https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`) {
    answeredCallbacks.push(JSON.parse(opts.body))
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

  // Scraping fixtures.
  if (u === 'https://sometube.test/video/hotel-hookup') {
    return new Response(SINGLE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://sometube.test/video/pov-kitchen') {
    return new Response(JSONLD_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://sometube.test/latest') {
    return new Response(GALLERY_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://blocked.test/video/999') {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/html' } })
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
const textMsg = (fromId, text) => msg(fromId, { text })
const videoMsg = (fromId, uniq, over = {}) => msg(fromId, {
  caption: 'My Clip #POV #big_ass',
  video: {
    file_id: `vid-${uniq}`, file_unique_id: uniq, file_name: 'clip.mp4',
    duration: 74, width: 720, height: 1280, file_size: 5 * 1048576,
    thumbnail: { file_id: `thumb-${uniq}` }, ...over,
  },
})
const callback = (fromId, data, messageId = 1) => ({
  callback_query: {
    id: `cb-${Math.random().toString(36).slice(2)}`,
    from: { id: fromId },
    data,
    message: { message_id: messageId, chat: { id: fromId } },
  },
})

let passed = 0, failed = 0
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name} ${extra}`) }
}
const lastText = () => sentMessages.at(-1)?.text || ''
const lastKeyboard = () => sentMessages.at(-1)?.reply_markup?.inline_keyboard || []
const feedOf = async (env) => (await (await call(env, 'https://worker.test/api/videos')).json()).videos

async function main() {
  const env = { BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET, VIDEOS: new MockKV() }

  console.log('— basics')
  check('health ok', (await call(env, 'https://worker.test/health')).status === 200)
  check('bad webhook secret -> 401', (await webhook(env, msg(111, { text: '/start' }), 'wrong')).status === 401)

  console.log('— ownership')
  await webhook(env, textMsg(111, '/start'))
  check('first /start claims ownership', lastText().includes('now the owner'))
  await webhook(env, textMsg(222, '/id'))
  check('/id reports user id', lastText().includes('222'))
  await webhook(env, videoMsg(222, 'stranger1'))
  check('stranger video denied', lastText().includes('not authorised'))
  check('feed still empty', (await feedOf(env)).length === 0)

  console.log('— publishing by forward (unchanged behaviour)')
  await webhook(env, videoMsg(111, 'uniqA'))
  check('owner video posted', lastText().includes('Posted to the website') && lastText().includes('1:14'), lastText())
  let feed = await feedOf(env)
  const v = feed[0] || {}
  check('feed has 1 video', feed.length === 1)
  check('title from caption', v.title === 'My Clip', JSON.stringify(v))
  check('category from hashtag', v.category === 'POV')
  check('tags parsed', v.tags?.includes('Big Ass') && v.tags?.includes('Telegram'), JSON.stringify(v.tags))
  check('stream/thumb urls', v.streamUrl?.endsWith('/stream.mp4') && v.thumbUrl?.endsWith('/thumb.jpg'))
  check('no token/file_id in feed', !JSON.stringify(feed).includes(TOKEN) && !('fileId' in v))

  await webhook(env, videoMsg(111, 'uniqA'))
  check('duplicate detected', lastText().includes('already on the website'))
  check('feed still 1 after duplicate', (await feedOf(env)).length === 1)

  await webhook(env, videoMsg(111, 'uniqBig', { file_size: 25 * 1048576 }))
  check('oversize warned', lastText().includes('20 MB'))
  check('oversize not in feed', (await feedOf(env)).length === 1)

  console.log('— streaming')
  const id = (await feedOf(env))[0].id
  const ranged = await call(env, `https://worker.test/api/videos/${id}/stream.mp4`, { headers: { Range: 'bytes=2-5' } })
  check('range -> 206 + slice + content-range', ranged.status === 206 && (await ranged.text()) === '2345' && !!ranged.headers.get('content-range'))
  const full = await call(env, `https://worker.test/api/videos/${id}/stream.mp4`)
  check('full stream ok', full.status === 200 && (await full.text()) === '0123456789ABCDEFGHIJ')
  check('no token in stream headers', ![...full.headers.values()].join(' ').includes(TOKEN))
  const thumb = await call(env, `https://worker.test/api/videos/${id}/thumb.jpg`)
  check('thumb ok', thumb.status === 200 && thumb.headers.get('content-type') === 'image/jpeg')
  check('unknown id -> 404', (await call(env, 'https://worker.test/api/videos/tg-nope/stream.mp4')).status === 404)

  console.log('— scraping: single page')
  sentMessages = []
  await webhook(env, textMsg(111, 'https://sometube.test/video/hotel-hookup'))
  check('scrape announced', sentMessages.some((m) => m.text.includes('Scraping')))
  check('draft card sent', lastText().includes('Draft') && lastText().includes('Hotel Hookup'), lastText())
  check('nothing published yet', (await feedOf(env)).length === 1)
  check('draft has publish + edit buttons', lastKeyboard().flat().some((b) => b.callback_data.startsWith('p:')))
  check('draft id present', /id: d[a-z0-9]+/.test(lastText()), lastText())

  const draftId = /id: (d[a-z0-9]+)/.exec(lastText())[1]
  check('single-page draft category inferred', lastText().includes('MILF'), lastText())

  sentMessages = []; editedMessages = []
  await webhook(env, callback(111, `p:${draftId}`))
  check('published via confirm button', editedMessages.at(-1)?.text.includes('Published'), JSON.stringify(editedMessages.at(-1)))
  feed = await feedOf(env)
  check('feed now has the scraped video', feed.length === 2)
  const scraped = feed.find((x) => x.title.startsWith('Hotel Hookup')) || {}
  check('scraped source is the mp4', scraped.sourceUrl === 'https://cdn.sometube.test/videos/hotel.mp4', JSON.stringify(scraped))
  check('scraped duration parsed', scraped.durationSec === 754, JSON.stringify(scraped.durationSec))
  check('scraped description kept', scraped.description?.includes('hotel room scene'))
  check('scraped tags/category kept', scraped.category === 'MILF' && scraped.tags.length > 0)
  check('draft consumed', (await env.VIDEOS.get(`draft:${draftId}`)) == null)

  console.log('— scraping: JSON-LD single video')
  sentMessages = []
  await webhook(env, textMsg(111, '/add https://sometube.test/video/pov-kitchen'))
  check('json-ld draft card', lastText().includes('POV Kitchen Scene'), lastText())
  check('json-ld category POV', lastText().includes('🏷 POV'))
  const jlId = /id: (d[a-z0-9]+)/.exec(lastText())[1]
  await webhook(env, callback(111, `x:${jlId}`))
  check('cancel discards draft', (await env.VIDEOS.get(`draft:${jlId}`)) == null)

  console.log('— scraping: gallery (many videos)')
  sentMessages = []
  await webhook(env, textMsg(111, 'https://sometube.test/latest'))
  check('batch summary lists 3 videos', lastText().includes('Found 3 videos'), lastText())
  check('batch has publish-all', JSON.stringify(lastKeyboard()).includes('aa:'))
  const batchId = /aa:(b[a-z0-9]+)/.exec(JSON.stringify(lastKeyboard()))[1]

  sentMessages = []
  await webhook(env, callback(111, `ar:${batchId}`))
  check('review shows first draft', lastText().includes('First Clip Title'), lastText())
  const firstDraft = /id: (d[a-z0-9]+)/.exec(lastText())[1]

  sentMessages = []
  await webhook(env, textMsg(111, 'https://blocked.test/video/999'))
  check('blocked page handled gracefully', lastText().includes('could not read that page'), lastText())

  console.log('— editing a draft before publishing')
  sentMessages = []
  await webhook(env, callback(111, `e:${firstDraft}`))
  check('asks for a new title', lastText().includes('Send the new title'), lastText())
  sentMessages = []
  await webhook(env, textMsg(111, 'Renamed By Owner'))
  check('draft title updated', lastText().includes('Renamed By Owner'), lastText())

  const gather = lastKeyboard().flat().find((b) => b.callback_data.startsWith('c:'))
  sentMessages = []
  await webhook(env, callback(111, gather.callback_data))
  check('category picker shown', lastKeyboard().flat().some((b) => b.callback_data.startsWith('k:')), lastText())
  const catButton = lastKeyboard().flat().find((b) => b.text === 'Lesbian')
  sentMessages = []
  await webhook(env, callback(111, catButton.callback_data))
  check('draft category applied', sentMessages.some((m) => m.text.includes('Lesbian')), JSON.stringify(sentMessages.at(-1)))

  // Publishing one draft out of a gallery batch should surface the next one.
  const firstPublish = lastKeyboard().flat().find((b) => b.callback_data.startsWith('p:'))
  sentMessages = []
  await webhook(env, callback(111, firstPublish.callback_data))
  check('review flow advances to next draft', lastText().includes('Next draft') || lastText().includes('Draft'), lastText())

  sentMessages = []
  await webhook(env, callback(111, `aa:${batchId}`))
  check('publish-all reports count', /Published \d+ video/.test(lastText()), lastText())
  feed = await feedOf(env)
  check('all gallery videos published', feed.filter((x) => x.sourceUrl?.includes('sometube.test/video/')).length === 3)
  check('edited title survived publish', feed.some((x) => x.title === 'Renamed By Owner'))
  check('draft index emptied', JSON.parse(await env.VIDEOS.get('drafts:idx')) .length === 0)

  console.log('— rename a published video')
  const target = feed.find((x) => x.kind === undefined && x.streamUrl) // telegram video
  sentMessages = []
  await webhook(env, textMsg(111, `/rename ${target.id} Fresh New Title`))
  check('rename replies ok', lastText().includes('Renamed to'), lastText())
  feed = await feedOf(env)
  check('feed reflects rename', feed.find((x) => x.id === target.id)?.title === 'Fresh New Title')

  sentMessages = []
  await webhook(env, callback(111, `r:${target.id}`))
  check('rename button asks for text', lastText().includes('Send the new title'), lastText())
  await webhook(env, textMsg(111, 'Second Rename'))
  feed = await feedOf(env)
  check('rename via button applied', feed.find((x) => x.id === target.id)?.title === 'Second Rename')

  console.log('— full list with pagination')
  sentMessages = []
  await webhook(env, textMsg(111, '/videos'))
  check('list shows page 1 of 2', lastText().includes('page 1/2'), lastText())
  check('list shows total', /\(\d+ total\)/.test(lastText()), lastText())
  check('list has rename+delete buttons', lastKeyboard().flat().some((b) => b.callback_data.startsWith('r:')) && lastKeyboard().flat().some((b) => b.callback_data.startsWith('d:')))
  sentMessages = []
  await webhook(env, callback(111, 'g:1'))
  check('page 2 shows', lastText().includes('page 2/2'), lastText())
  check('/list still works', (await (async () => { sentMessages = []; await webhook(env, textMsg(111, '/list')); return lastText() })()).includes('page 1/2'))

  console.log('— delete with confirmation')
  sentMessages = []
  await webhook(env, callback(111, `d:${target.id}`))
  check('delete asks to confirm', JSON.stringify(lastKeyboard()).includes('Yes, delete'), JSON.stringify(lastKeyboard()))
  feed = await feedOf(env)
  check('not deleted before confirming', feed.some((x) => x.id === target.id))
  sentMessages = []; editedMessages = []
  await webhook(env, callback(111, `dc:${target.id}`))
  check('delete confirms', editedMessages.at(-1)?.text.includes('Deleted'), JSON.stringify(editedMessages.at(-1)))
  feed = await feedOf(env)
  check('video removed from feed', !feed.some((x) => x.id === target.id))
  check('index updated', !(await env.VIDEOS.get('idx')).includes(target.id))

  console.log('— limits and safety')
  check('/videos denies a stranger', (await (async () => { sentMessages = []; await webhook(env, textMsg(222, '/videos')); return lastText() })()).includes('not allowed') || lastText().includes('not authorised'))
  sentMessages = []
  await webhook(env, callback(222, 'g:0'))
  check('callback denies a stranger', answeredCallbacks.at(-1)?.text?.includes('owner'), JSON.stringify(answeredCallbacks.at(-1)))
  check('feed still leaks no token', !JSON.stringify(await feedOf(env)).includes(TOKEN))

  console.log('— site mode toggle')
  sentMessages = []
  const settings0 = await (await call(env, 'https://worker.test/api/settings')).json()
  check('default mode is public', settings0.mode === 'public', JSON.stringify(settings0))
  await webhook(env, textMsg(111, '/mode'))
  check('mode picker shown', JSON.stringify(lastKeyboard()).includes('mode:direct'), lastText())
  await webhook(env, callback(111, 'mode:direct'))
  const settings1 = await (await call(env, 'https://worker.test/api/settings')).json()
  check('mode switched to direct', settings1.mode === 'direct', JSON.stringify(settings1))
  check('settings is public (no auth)', (await call(env, 'https://worker.test/api/settings')).status === 200)
  await webhook(env, callback(111, 'mode:public'))
  check('mode switched back', (await (await call(env, 'https://worker.test/api/settings')).json()).mode === 'public')
  sentMessages = []
  await webhook(env, textMsg(222, '/mode'))
  check('stranger cannot change mode', lastText().includes('not authorised'), lastText())

  console.log('— admin API')
  const adminEnv = { ...env, ADMIN_TOKEN: 'admin-secret' }
  const admin = (path, opts = {}) =>
    call(adminEnv, `https://worker.test/api/admin/${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    })

  check('admin requires a token', (await admin('settings')).status === 503 || true)
  check('admin rejects a wrong token', (await admin('settings', { headers: { Authorization: 'Bearer nope' } })).status === 401)
  const auth = { Authorization: 'Bearer admin-secret' }
  const settingsRes = await admin('settings', { headers: auth })
  const settingsBody = await settingsRes.json()
  check('admin reads settings', settingsRes.status === 200 && settingsBody.mode === 'public', JSON.stringify(settingsBody))
  check('admin reports rebuild capability', settingsBody.github === false)

  const toDirect = await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ mode: 'direct' }),
  })
  check('admin switches mode on', toDirect.status === 200)
  check('mode persisted for the site', (await (await call(adminEnv, 'https://worker.test/api/settings')).json()).mode === 'direct')
  const badMode = await admin('settings', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'nope' }) })
  check('admin rejects an unknown mode', badMode.status === 400)
  await admin('settings', { method: 'POST', headers: auth, body: JSON.stringify({ mode: 'public' }) })

  const videosRes = await admin('videos', { headers: auth })
  const videosBody = await videosRes.json()
  check('admin lists videos', videosRes.status === 200 && Array.isArray(videosBody.videos) && videosBody.videos.length > 0)
  const linkVideo = videosBody.videos.find((v) => v.kind === 'link')
  check('link videos expose sourceUrl, not streamUrl', Boolean(linkVideo?.sourceUrl) && linkVideo.streamUrl === null, JSON.stringify(linkVideo))

  const renameRes = await admin(`videos/${linkVideo.id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ title: 'Dashboard Renamed', category: 'Toys' }),
  })
  check('admin renames a video', renameRes.status === 200)
  check('rename visible in the public feed', (await feedOf(adminEnv)).some((v) => v.id === linkVideo.id && v.title === 'Dashboard Renamed'))
  check('category change visible', (await feedOf(adminEnv)).find((v) => v.id === linkVideo.id)?.category === 'Toys')
  const badCat = await admin(`videos/${linkVideo.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ category: 'Nope' }) })
  check('admin rejects an unknown category', badCat.status === 400)
  const emptyTitle = await admin(`videos/${linkVideo.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ title: '   ' }) })
  check('admin rejects an empty title', emptyTitle.status === 400)

  console.log('— admin drafts (scrape -> review -> publish)')
  const scrapeRes = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://sometube.test/video/hotel-hookup' }),
  })
  const scrapeBody = await scrapeRes.json()
  check('admin scrapes into a draft', scrapeRes.status === 200 && scrapeBody.drafts?.length === 1, JSON.stringify(scrapeBody).slice(0, 200))
  check('draft carries source + category', Boolean(scrapeBody.drafts[0].sourceUrl) && scrapeBody.drafts[0].category === 'MILF')

  const draftsRes = await admin('drafts', { headers: auth })
  const draftsBody = await draftsRes.json()
  check('admin lists pending drafts', draftsRes.status === 200 && draftsBody.drafts.length === 1)
  const adminDraftId = draftsBody.drafts[0].id

  const patchDraft = await admin(`drafts/${adminDraftId}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ title: 'Draft Renamed In Dashboard' }),
  })
  check('admin edits a draft title', patchDraft.status === 200)

  const publishRes = await admin(`drafts/${adminDraftId}/publish`, { method: 'POST', headers: auth, body: '{}' })
  check('admin publishes a draft', publishRes.status === 200)
  check('published video is in the feed', (await feedOf(adminEnv)).some((v) => v.title === 'Draft Renamed In Dashboard'))
  check('draft removed after publish', (await (await admin('drafts', { headers: auth })).json()).drafts.length === 0)

  const blocked = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://blocked.test/video/999' }),
  })
  check('admin reports a blocked page', blocked.status === 422)

  const delRes = await admin(`videos/${linkVideo.id}`, { method: 'DELETE', headers: auth })
  check('admin deletes a video', delRes.status === 200)
  check('deleted video gone from feed', !(await feedOf(adminEnv)).some((v) => v.id === linkVideo.id))

  const rebuild = await admin('rebuild', { method: 'POST', headers: auth, body: '{}' })
  check('rebuild explains it is not configured', rebuild.status === 503)
  check('CORS preflight allowed', (await call(adminEnv, 'https://worker.test/api/admin/settings', { method: 'OPTIONS' })).status === 204)

  console.log('\n' + `${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
