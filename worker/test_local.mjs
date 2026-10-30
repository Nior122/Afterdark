/**
 * Local test harness for worker.js — no Cloudflare or Telegram account needed.
 * Run:  node worker/test_local.mjs
 * Mocks KV storage, the Telegram Bot API and a few web pages, then drives the
 * worker through: publish by forward -> feed -> stream, scraping pages and
 * galleries into drafts (with duplicate detection for the bulk scrape),
 * review/publish/cancel, rename, full list, paging and delete, the site
 * settings (mode, redirect, ads incl. per-slot enable and preview), view
 * counting with per-session dedupe, and the bulk admin endpoints
 * (videos/bulk-delete, videos/bulk-patch, drafts/discard-all).
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

// A public t.me post page: no og:video tags at all — duration and aspect live
// only in the widget markup (overlay badge + padding-bottom on the player).
const TME_POST_PAGE = `<!doctype html><html><head>
<meta property="og:title" content="Eden 🌿" /><meta property="og:site_name" content="Telegram" />
</head><body><div class="tgme_widget_message">
<figure class="tgme_widget_message_video_wrap">
<div class="tgme_widget_message_video js-message_video" style="padding-bottom: 177.78%;">
  <a href="#" class="tgme_widget_message_video_thumb" style="background-image: url('https://cdn4.telesco.pe/file/eden_t.jpg')">
    <span class="tgme_widget_message_video_duration"><b>41:05</b></span>
  </a>
</div>
</figure>
<div class="tgme_widget_message_footer"><span>600 views</span></div>
</div></body></html>`

// WordPress-style page with a JS-configured player: no og:video, no <video>
// tag — the file lives inside a fluidPlayer() config object only. The
// og:title carries a raw &amp; entity the scraped title must decode.
const FLUID_PAGE = `<!doctype html><html><head>
<meta property="og:site_name" content="BlogTube" />
<meta property="og:title" content="Trending Clip &amp; More XXX video" />
<meta property="og:image" content="https://blog.test/wp/uploads/clip-400x225.jpg" />
<script>
  fluidPlayer("mvp-flash-player", {
    media: { sources: [{ file: "https://videos.blog.test/wp/uploads/2026/08/Trending-Clip.mp4" }], image: "https://blog.test/wp/uploads/clip-400x225.jpg" },
  });
</script>
</head><body><div id="mvp-flash-player"></div></body></html>`

// Lazy-loader page: no og: tags, no player config — the file sits in a
// data-src attribute as a site-relative path.
const DATASRC_PAGE = `<!doctype html><html><head><title>Site Clip Only</title></head>
<body><div class="vp-player" data-src="/wp/uploads/2026/09/site-clip.mp4"></div></body></html>`

// The darknaija pattern: a JSON-LD VideoObject that only points at the page
// itself (so the structured pass marks it unplayable), while the real file
// sits in a cross-host DOWNLOAD anchor. The page-item rescue pass must find
// the download link the JSON-LD pass shadowed.
const SHADOW_DL_PAGE = `<!doctype html><html><head><title>Street Baddie</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"Street Baddie","url":"https://blog.test/shadow-dl/"}</script>
</head><body><a class="btn" href="https://cdn.blog.test/uploads/2026/street-baddie.mp4">DOWNLOAD VIDEO</a></body></html>`

// The mzansi pattern: the post embeds a tube player in a protocol-relative
// iframe. Resolving it must yield the tube's watch URL, which maps to a
// known embeddable player.
const FRAME_PAGE = `<!doctype html><html><head><title>Tiny Amateur GF Made A Sex Tape</title></head>
<body><iframe src="//www.iceporn.com/video/2229757/tiny-african-amateur" allowfullscreen></iframe></body></html>`

// An embeddable tube's page with no parseable player markup at all: the URL
// salvage must still turn it into the tube's stable embed.
const BAR_EPORNER_PAGE = `<!doctype html><html><head><title>Some Other Clip</title></head>
<body><div class="nojs-player">loading…</div></body></html>`

const GALLERY_PAGE = `<!doctype html><html><head><title>Latest videos — SomeTube</title>
<meta property="og:site_name" content="SomeTube" /></head><body>
<a href="/video/111/first-clip" title="First Clip Title"><img src="/t/1.jpg" alt="First Clip Title" /></a>
<a href="/video/222/second-clip" title="Second Anal Clip"><img src="/t/2.jpg" alt="Second Anal Clip" /></a>
<a href="/video/333/third-clip" title="Third Latina Clip"><img src="/t/3.jpg" alt="Third Latina Clip" /></a>
<a href="/about">About us</a>
</body></html>`

// A second listing used by the bulk-scrape tests (kept disjoint from the
// gallery above so published-source dedupe does not swallow these).
const GALLERY_PAGE_2 = `<!doctype html><html><head><title>More videos — SomeTube</title>
<meta property="og:site_name" content="SomeTube" /></head><body>
<a href="/clip/444/bulk-one" title="Bulk One Clip"><img src="/t/4.jpg" alt="Bulk One Clip" /></a>
<a href="/clip/555/bulk-two" title="Bulk Two Clip"><img src="/t/5.jpg" alt="Bulk Two Clip" /></a>
<a href="/clip/666/bulk-three" title="Bulk Three Clip"><img src="/t/6.jpg" alt="Bulk Three Clip" /></a>
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
  if (u === 'https://t.me/testchannel/1343') {
    return new Response(TME_POST_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://blog.test/trending-clip') {
    return new Response(FLUID_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://blog.test/datasrc-clip') {
    return new Response(DATASRC_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://sometube.test/latest') {
    return new Response(GALLERY_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://sometube.test/more') {
    return new Response(GALLERY_PAGE_2, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://blocked.test/video/999') {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/html' } })
  }
  if (u === 'https://blog.test/shadow-dl/') {
    return new Response(SHADOW_DL_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://mzansi.test/tiny-gf-sex-tape') {
    return new Response(FRAME_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://www.eporner.com/video-CqzTB8dIhZD/viral-couple/') {
    // Eporner's anti-bot wall: the worker never gets the player config.
    return new Response('Just a moment...', { status: 403, headers: { 'Content-Type': 'text/html' } })
  }
  if (u === 'https://www.eporner.com/video-ABC123xyz/some-other-clip/') {
    return new Response(BAR_EPORNER_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
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

  console.log('— scraping: t.me post (duration + aspect from widget markup)')
  sentMessages = []
  await webhook(env, textMsg(111, 'https://t.me/testchannel/1343'))
  check('t.me draft card shows the real duration', lastText().includes('41:05'), lastText())
  const tmeId = /id: (d[a-z0-9]+)/.exec(lastText())[1]
  const draftsList = await call({ ...env, ADMIN_TOKEN: 'admin-secret' }, 'https://worker.test/api/admin/drafts', {
    headers: { Authorization: 'Bearer admin-secret', 'Content-Type': 'application/json' },
  })
  const tmeDraft = (await draftsList.json()).drafts.find((d) => d.id === tmeId) || {}
  check('dashboard draft echo carries duration + shape', tmeDraft.durationSec === 2465 && tmeDraft.width === 400 && tmeDraft.height === 711, JSON.stringify(tmeDraft).slice(0, 140))
  sentMessages = []
  editedMessages = []
  await webhook(env, callback(111, `p:${tmeId}`))
  feed = await feedOf(env)
  const tmeVideo = feed.find((x) => x.title?.includes('Eden')) || {}
  check('t.me duration scraped to seconds', tmeVideo.durationSec === 2465, JSON.stringify(tmeVideo.durationSec))
  check('t.me portrait aspect recorded', tmeVideo.width === 400 && tmeVideo.height === 711, JSON.stringify({ w: tmeVideo.width, h: tmeVideo.height }))
  check('t.me post link kept as source', tmeVideo.sourceUrl === 'https://t.me/testchannel/1343', JSON.stringify(tmeVideo.sourceUrl))

  console.log('— scraping: JS-player config page (file only in script, no tags)')
  sentMessages = []
  await webhook(env, textMsg(111, 'https://blog.test/trending-clip'))
  check('fluid page draft carries the title', lastText().includes('Trending Clip'), lastText())
  const fluidId = /id: (d[a-z0-9]+)/.exec(lastText())[1]
  await webhook(env, callback(111, `p:${fluidId}`))
  feed = await feedOf(env)
  const fluidVideo = feed.find((x) => x.title?.includes('Trending Clip')) || {}
  check(
    'js-config mp4 becomes the playable source',
    fluidVideo.sourceUrl === 'https://videos.blog.test/wp/uploads/2026/08/Trending-Clip.mp4',
    JSON.stringify(fluidVideo).slice(0, 200),
  )
  check(
    'scraped titles decode html entities',
    !fluidVideo.title.includes('&amp;') && fluidVideo.title.includes('Trending Clip & More'),
    JSON.stringify(fluidVideo.title),
  )

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
  const tmeListed = videosBody.videos.find((v) => v.durationSec === 2465) || {}
  check('admin video list exposes media dimensions', tmeListed.width === 400 && tmeListed.height === 711, JSON.stringify({ w: tmeListed.width, h: tmeListed.height }))

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
  // Hotel Hookup is already published at this point, so scrape a fresh page.
  const scrapeRes = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://sometube.test/video/pov-kitchen' }),
  })
  const scrapeBody = await scrapeRes.json()
  check('admin scrapes into a draft', scrapeRes.status === 200 && scrapeBody.drafts?.length === 1, JSON.stringify(scrapeBody).slice(0, 200))
  check('draft carries source + category', Boolean(scrapeBody.drafts[0].sourceUrl) && scrapeBody.drafts[0].category === 'POV')
  check('first scrape sees no duplicates', scrapeBody.duplicates === 0, JSON.stringify(scrapeBody))

  const rescan = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://sometube.test/video/pov-kitchen' }),
  })
  const rescanBody = await rescan.json()
  check('re-scrape returns no drafts', rescan.status === 200 && rescanBody.drafts.length === 0, JSON.stringify(rescanBody))
  check('re-scrape reports the duplicate', rescanBody.duplicates === 1, JSON.stringify(rescanBody))

  // Private Telegram links must be refused on the spot — the point is to never
  // attempt an outbound fetch for them (that is what used to hang the panel).
  const privRes = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://t.me/c/1234567890/42' }),
  })
  const privBody = await privRes.json()
  check('private t.me/c link rejected with guidance', privRes.status === 422 && /private Telegram link/i.test(privBody.message), JSON.stringify(privBody).slice(0, 160))
  check('private rejection names the re-copy fix', /RE-COPY|re-copy/i.test(privBody.message))
  const inviteRes = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://t.me/+AbCdEf1234567890' }),
  })
  check('invite-hash links rejected the same way', inviteRes.status === 422 && /private Telegram link/i.test((await inviteRes.json()).message))
  const joinRes = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://t.me/joinchat/AAAAAE-legacy' }),
  })
  check('legacy joinchat links rejected too', joinRes.status === 422 && /private Telegram link/i.test((await joinRes.json()).message))

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

  // Lazy-loader page: the file hides in a data-src attribute as a
  // site-relative path — the extractor must find it and absolutise it.
  const relScrape = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://blog.test/datasrc-clip' }),
  })
  const relBody = await relScrape.json()
  check(
    'data-src relative file becomes an absolute playable source',
    relBody.drafts?.[0]?.sourceUrl === 'https://blog.test/wp/uploads/2026/09/site-clip.mp4',
    JSON.stringify(relBody).slice(0, 180),
  )
  await admin('drafts/discard-all', { method: 'POST', headers: auth, body: '{}' })

  const blocked = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://blocked.test/video/999' }),
  })
  check('admin reports a blocked page', blocked.status === 422)

  // Rescue passes for "page"-kind items (darknaija / mzansi / eporner).
  const shadow = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://blog.test/shadow-dl/' }),
  })
  const shadowBody = await shadow.json()
  check(
    'download-link rescues a JSON-LD page item',
    shadowBody.drafts?.[0]?.sourceUrl === 'https://cdn.blog.test/uploads/2026/street-baddie.mp4'
      && shadowBody.drafts?.[0]?.sourceKind === 'file',
    JSON.stringify(shadowBody).slice(0, 180),
  )
  await admin('drafts/discard-all', { method: 'POST', headers: auth, body: '{}' })

  const framed = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://mzansi.test/tiny-gf-sex-tape' }),
  })
  const framedBody = await framed.json()
  check(
    'protocol-relative player iframe becomes its known embed',
    framedBody.drafts?.[0]?.sourceUrl === 'https://www.iceporn.com/embed/2229757'
      && framedBody.drafts?.[0]?.sourceKind === 'embed',
    JSON.stringify(framedBody).slice(0, 180),
  )
  await admin('drafts/discard-all', { method: 'POST', headers: auth, body: '{}' })

  const tubeBlocked = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://www.eporner.com/video-CqzTB8dIhZD/viral-couple/' }),
  })
  const tubeBlockedBody = await tubeBlocked.json()
  check(
    'blocked tube page still drafts via the URL-derived embed',
    tubeBlocked.status === 200
      && tubeBlockedBody.drafts?.[0]?.sourceUrl === 'https://www.eporner.com/embed/CqzTB8dIhZD/'
      && tubeBlockedBody.drafts?.[0]?.sourceKind === 'embed',
    JSON.stringify(tubeBlockedBody).slice(0, 180),
  )
  check('embed-only draft gets its title from the link slug', tubeBlockedBody.drafts?.[0]?.title === 'Viral Couple', JSON.stringify(tubeBlockedBody.drafts?.[0]?.title))
  await admin('drafts/discard-all', { method: 'POST', headers: auth, body: '{}' })

  const tubeScraped = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://www.eporner.com/video-ABC123xyz/some-other-clip/' }),
  })
  const tubeScrapedBody = await tubeScraped.json()
  check(
    'scrapable tube page prefers the stable embed over the bare page link',
    tubeScrapedBody.drafts?.[0]?.sourceUrl === 'https://www.eporner.com/embed/ABC123xyz/'
      && tubeScrapedBody.drafts?.[0]?.sourceKind === 'embed'
      && tubeScrapedBody.drafts?.[0]?.title === 'Some Other Clip',
    JSON.stringify(tubeScrapedBody).slice(0, 220),
  )
  await admin('drafts/discard-all', { method: 'POST', headers: auth, body: '{}' })

  // The gallery was published earlier; scraping it whole must read as duplicate.
  const galleryAgain = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://sometube.test/latest' }),
  })
  const galleryAgainBody = await galleryAgain.json()
  check('gallery re-scrape is all duplicates', galleryAgainBody.drafts.length === 0 && galleryAgainBody.duplicates === 3, JSON.stringify(galleryAgainBody))

  const delRes = await admin(`videos/${linkVideo.id}`, { method: 'DELETE', headers: auth })
  check('admin deletes a video', delRes.status === 200)
  check('deleted video gone from feed', !(await feedOf(adminEnv)).some((v) => v.id === linkVideo.id))

  console.log('— view tracking')
  const feedForViews = await feedOf(adminEnv)
  const watched = feedForViews[0]
  const otherWatched = feedForViews[1]
  const viewPost = (vid, body, headers = {}) =>
    call(adminEnv, `https://worker.test/api/videos/${vid}/view`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })
  const v1 = await (await viewPost(watched.id, JSON.stringify({ session: 'sess-aaaa1111' }))).json()
  check('first view counted', v1.ok === true && v1.counted === true && v1.views === 1, JSON.stringify(v1))
  const v2 = await (await viewPost(watched.id, JSON.stringify({ session: 'sess-aaaa1111' }))).json()
  check('same session does not recount', v2.counted === false && v2.views === 1, JSON.stringify(v2))
  const v3 = await (await viewPost(watched.id, JSON.stringify({ session: 'sess-bbbb2222' }))).json()
  check('new session counts again', v3.counted === true && v3.views === 2, JSON.stringify(v3))
  const v4 = await (await viewPost(otherWatched.id, JSON.stringify({ session: 'sess-aaaa1111' }))).json()
  check('dedupe is per video (same session, other video counts)', v4.counted === true && v4.views === 1, JSON.stringify(v4))
  const v5 = await (await viewPost(watched.id, '')).json()
  check('view POST without a session still counts once', v5.counted === true && v5.views === 3, JSON.stringify(v5))
  const v6 = await (await viewPost(watched.id, '')).json()
  check('the anon fallback still dedupes', v6.counted === false, JSON.stringify(v6))
  check('view on an unknown video is 404', (await viewPost('does-not-exist', JSON.stringify({ session: 'sess-cccc3333' }))).status === 404)
  const preflight = await call(adminEnv, `https://worker.test/api/videos/${watched.id}/view`, { method: 'OPTIONS' })
  check('view endpoint answers CORS preflight', preflight.status === 204 && (preflight.headers.get('access-control-allow-methods') || '').includes('POST'))
  check('the view response is CORS-enabled', (await call(adminEnv, `https://worker.test/api/videos/${watched.id}/view`, { method: 'POST', body: '{}' })).headers.get('access-control-allow-origin') === '*')
  const feedWithViews = await feedOf(adminEnv)
  check('feed exposes views per video', feedWithViews.find((x) => x.id === watched.id)?.views === 3, JSON.stringify(feedWithViews.find((x) => x.id === watched.id)))
  check('feed leaves unseen videos at zero', feedWithViews[feedWithViews.length - 1].views === 0)
  const adminViewList = await (await admin('videos', { headers: auth })).json()
  check('admin list exposes views + total', adminViewList.videos.find((x) => x.id === watched.id)?.views === 3 && adminViewList.viewsTotal === 4, JSON.stringify({ total: adminViewList.viewsTotal }))

  console.log('— bulk management')
  const two = (await (await admin('videos', { headers: auth })).json()).videos.slice(0, 2)
  const bulkPatch = await admin('videos/bulk-patch', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ids: two.map((x) => x.id), category: 'Lesbian' }),
  })
  const bulkPatchBody = await bulkPatch.json()
  check('bulk recategorise updates both', bulkPatch.status === 200 && bulkPatchBody.updated.length === 2 && bulkPatchBody.missing.length === 0, JSON.stringify(bulkPatchBody))
  const feedAfterBulk = await feedOf(adminEnv)
  check('bulk category shows in the feed', two.every((x) => feedAfterBulk.find((v) => v.id === x.id)?.category === 'Lesbian'))
  const badBulk = await admin('videos/bulk-patch', { method: 'POST', headers: auth, body: JSON.stringify({ ids: [two[0].id], category: 'Nope' }) })
  check('bulk patch rejects an unknown category', badBulk.status === 400)
  const emptyBulk = await admin('videos/bulk-patch', { method: 'POST', headers: auth, body: JSON.stringify({ ids: [], category: 'Anal' }) })
  check('bulk patch demands ids', emptyBulk.status === 400)
  const bulkDelete = await admin('videos/bulk-delete', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ids: [two[0].id, 'no-such-id'] }),
  })
  const bulkDeleteBody = await bulkDelete.json()
  check('bulk delete reports deleted and missing', bulkDelete.status === 200 && bulkDeleteBody.deleted.length === 1 && bulkDeleteBody.missing.length === 1, JSON.stringify(bulkDeleteBody))
  const feedAfterDelete = await feedOf(adminEnv)
  check('deleted video gone, other kept', !feedAfterDelete.some((v) => v.id === two[0].id) && feedAfterDelete.some((v) => v.id === two[1].id))
  check('delete clears the counter', (await adminEnv.VIDEOS.get(`views:${two[0].id}`)) == null)
  const listed = await (await admin('videos', { headers: auth })).json()
  check('views total follows the delete', listed.viewsTotal === listed.videos.reduce((sum, v) => sum + v.views, 0), JSON.stringify({ viewsTotal: listed.viewsTotal }))

  console.log('— bulk scrape flow (scrape -> publish-all / review / discard)')
  const bulkDraftScrape = await (await admin('scrape', { method: 'POST', headers: auth, body: JSON.stringify({ url: 'https://sometube.test/more' }) })).json()
  check('gallery scrape yields three drafts', bulkDraftScrape.drafts.length === 3 && bulkDraftScrape.duplicates === 0, JSON.stringify({ drafts: bulkDraftScrape.drafts.length }))
  const pendingIds = bulkDraftScrape.drafts.map((d) => d.id)
  const discardTwo = await admin('drafts/discard-all', { method: 'POST', headers: auth, body: JSON.stringify({ ids: pendingIds.slice(0, 2) }) })
  const discardTwoBody = await discardTwo.json()
  check('discard-all removes exactly the given drafts', discardTwo.status === 200 && discardTwoBody.discarded.length === 2, JSON.stringify(discardTwoBody))
  check('the kept draft survives', (await (await admin('drafts', { headers: auth })).json()).drafts.length === 1)
  const publishSome = await admin('drafts/publish-all', { method: 'POST', headers: auth, body: JSON.stringify({ ids: [pendingIds[2]] }) })
  check('publish-all with ids publishes only those', publishSome.status === 200 && (await publishSome.json()).published.length === 1)
  // 444/555 were discarded (so they scrape fresh again), 666 was published
  // (so it dedupes) — exactly the per-URL statuses the dashboard renders.
  const repaste = await admin('scrape', { method: 'POST', headers: auth, body: JSON.stringify({ url: 'https://sometube.test/more' }) })
  const repasteBody = await repaste.json()
  check('re-scrape: published draft dedupes, discarded ones do not', repasteBody.drafts.length === 2 && repasteBody.duplicates === 1, JSON.stringify(repasteBody))
  const discardRest = await admin('drafts/discard-all', { method: 'POST', headers: auth, body: JSON.stringify({}) })
  check('discard-all without ids clears the queue', (await discardRest.json()).discarded.length === 2 && (await (await admin('drafts', { headers: auth })).json()).drafts.length === 0)

  console.log('— redirect URL')
  const redirectDefault = await (await call(adminEnv, 'https://worker.test/api/settings')).json()
  check('redirect is off by default', redirectDefault.redirectUrl === '', JSON.stringify(redirectDefault))
  const setRedirect = await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ redirectUrl: 'https://ads.example.com/offer' }),
  })
  check('dashboard saves a redirect URL', setRedirect.status === 200)
  const redirectSaved = await (await call(adminEnv, 'https://worker.test/api/settings')).json()
  check('public settings expose the redirect URL', redirectSaved.redirectUrl === 'https://ads.example.com/offer', JSON.stringify(redirectSaved))
  check('mode unchanged by a redirect edit', redirectSaved.mode === 'public')
  const badRedirect = await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ redirectUrl: 'javascript:alert(1)' }),
  })
  check('non-http redirect rejected', badRedirect.status === 400)
  const clearRedirect = await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ redirectUrl: '' }),
  })
  check('redirect can be cleared', clearRedirect.status === 200)
  check('cleared redirect is empty', (await (await call(adminEnv, 'https://worker.test/api/settings')).json()).redirectUrl === '')

  sentMessages = []
  await webhook(adminEnv, textMsg(111, '/redirect'))
  check('bot reports no redirect set', /No redirect set/.test(lastText()), lastText())
  await webhook(adminEnv, textMsg(111, '/redirect https://ads.example.com/offer'))
  check('bot sets the redirect', /redirect set/i.test(lastText()), lastText())
  check('bot redirect reaches the site', (await (await call(adminEnv, 'https://worker.test/api/settings')).json()).redirectUrl === 'https://ads.example.com/offer')
  await webhook(adminEnv, textMsg(111, '/redirect off'))
  check('bot turns the redirect off', (await (await call(adminEnv, 'https://worker.test/api/settings')).json()).redirectUrl === '')

  console.log('— ads')
  const adsDefault = await (await call(adminEnv, 'https://worker.test/api/settings')).json()
  check('ads are off by default', adsDefault.ads.enabled === false)
  check('every slot is empty by default', ['header', 'native', 'sidebar', 'footer', 'video', 'popunder'].every((slot) => adsDefault.ads[slot] === ''))
  check('every slot is individually on by default', ['header', 'native', 'sidebar', 'footer', 'video', 'popunder'].every((slot) => adsDefault.ads.slotsOn[slot] === true))
  check('preview outlines are off by default', adsDefault.ads.preview === false)

  const saveAds = await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ads: { header: '<script>window.__adHeader=1</script>', native: '<div class="native">ad</div>', enabled: true } }),
  })
  check('dashboard saves ad code', saveAds.status === 200)
  const adsBody = await saveAds.json()
  check('header slot stored', adsBody.ads.header.includes('__adHeader'))
  check('native slot stored', adsBody.ads.native.includes('native'))
  check('ads switched on', adsBody.ads.enabled === true)
  check('untouched slots stay empty', adsBody.ads.sidebar === '')
  const publicAds = await (await call(adminEnv, 'https://worker.test/api/settings')).json()
  check('public settings expose the ad code', publicAds.ads.header.includes('__adHeader'))

  const partialAds = await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ads: { sidebar: '<div id="side"></div>' } }),
  })
  const partialBody = await partialAds.json()
  check('a partial ad update keeps other slots', partialBody.ads.header.includes('__adHeader') && partialBody.ads.sidebar.includes('side'))

  const tooLong = await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ads: { footer: 'x'.repeat(20001) } }),
  })
  check('oversized ad code rejected', tooLong.status === 400)

  console.log('— ads: per-slot enable + preview outlines')
  const slotsOff = await (await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ads: { slotsOn: { header: false, sidebar: false } } }),
  })).json()
  check('per-slot disable stored', slotsOff.ads.slotsOn.header === false && slotsOff.ads.slotsOn.sidebar === false)
  check('untouched slots stay enabled', slotsOff.ads.slotsOn.native === true && slotsOff.ads.slotsOn.video === true)
  check('global toggle untouched by slot edits', slotsOff.ads.enabled === true)
  const slotsPublic = await (await call(adminEnv, 'https://worker.test/api/settings')).json()
  check('public settings expose slot state', slotsPublic.ads.slotsOn.header === false)
  check('slot code survives being switched off', slotsPublic.ads.header.includes('__adHeader'))
  const previewOn = await (await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ads: { preview: true } }),
  })).json()
  check('preview flag saved', previewOn.ads.preview === true)
  check('preview reaches the site', (await (await call(adminEnv, 'https://worker.test/api/settings')).json()).ads.preview === true)
  const slotReOn = await (await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ads: { slotsOn: { header: true } } }),
  })).json()
  check('a slot can be switched back on', slotReOn.ads.slotsOn.header === true && slotReOn.ads.slotsOn.sidebar === false)
  const junkSlots = await admin('settings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ads: { slotsOn: 'all-off', preview: 'yes' } }),
  })
  const junkBody = await junkSlots.json()
  check('non-boolean slotsOn/preview are ignored, not stored', junkBody.ads.slotsOn.header === true && junkBody.ads.preview === true)

  sentMessages = []
  await webhook(adminEnv, textMsg(111, '/ads off'))
  check('bot switches ads off', (await (await call(adminEnv, 'https://worker.test/api/settings')).json()).ads.enabled === false)
  check('bot keeps the code when switching off', (await (await call(adminEnv, 'https://worker.test/api/settings')).json()).ads.header.includes('__adHeader'))
  await webhook(adminEnv, textMsg(111, '/ads on'))
  check('bot switches ads on', (await (await call(adminEnv, 'https://worker.test/api/settings')).json()).ads.enabled === true)
  sentMessages = []
  await webhook(adminEnv, textMsg(111, '/ads'))
  check('bot reports ad status', /Ads are ON/.test(lastText()) && /header/.test(lastText()), lastText())
  check('bot status lists per-slot hiding', /Hidden by their per-slot switch: sidebar/.test(lastText()), lastText())

  const cleared = await admin('ads/clear', { method: 'POST', headers: auth, body: JSON.stringify({ enabled: false }) })
  const clearedBody = await cleared.json()
  check('clear empties every slot', ['header', 'native', 'sidebar', 'footer', 'video', 'popunder'].every((slot) => clearedBody.ads[slot] === ''))
  check('clear switches ads off', clearedBody.ads.enabled === false)
  check('clear re-enables every slot and drops preview', ['header', 'native', 'sidebar', 'footer', 'video', 'popunder'].every((slot) => clearedBody.ads.slotsOn[slot] === true) && clearedBody.ads.preview === false)

  const rebuild = await admin('rebuild', { method: 'POST', headers: auth, body: '{}' })
  check('rebuild explains it is not configured', rebuild.status === 503)
  check('CORS preflight allowed', (await call(adminEnv, 'https://worker.test/api/admin/settings', { method: 'OPTIONS' })).status === 204)

  console.log('\n' + `${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
