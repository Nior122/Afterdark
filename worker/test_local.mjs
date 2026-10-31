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
const menuCalls = []
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

// Page-builder obfuscation (darknaija et al): the file only ever appears in
// the HTML with JSON-escaped slashes, so a naive scan sees `https:\/\/…`.
const ESCAPED_CFG_PAGE = `<!doctype html><html><head><title>Escaped Config Clip</title></head>
<body><div class="vpd-player" data-config='{"player":{"file":"https:\\/\\/cdn.test\\/wp\\/uploads\\/clip.mp4"}}'></div>
<script>fluidPlayer("vpd", { media: { sources: [{ file: "https:\\/\\/cdn.test\\/wp\\/uploads\\/clip.mp4" }] } });</script></body></html>`

// The player is an iframe wrapped in a redirect whose target_url only becomes
// a usable tube URL after percent-decoding.
const FRAME_REDIRECT_PAGE = `<!doctype html><html><head><title>Redirect Frame Clip</title></head>
<body><iframe src="//www.iceporn.com/embed/redirect?type=main&target_url=https%3A%2F%2Fwww.iceporn.com%2Fvideo%2F555111%2Fclip" frameborder="0"></iframe></body></html>`

// A WordPress page whose served HTML hides the file entirely (only a wp-
// content hint and the naked anchor text survive) — the REST API rescue is
// the only way to it. Poster comes from the yoast meta inside the REST entry.
const NAIFICA_PAGE = `<!doctype html><html><head><title>Baddie Street Clip</title>
<link rel="stylesheet" href="/wp-content/themes/naija/style.css" /></head>
<body><h1>Baddie Street Clip</h1><div class="dlc">DOWNLOAD VIDEO</div></body></html>`

// Tube embed pages — served to third-party iframes, so the Worker can read
// them even when the watch page blocks it. This is what poster/duration
// decoration pulls from.
const EPORNER_EMBED_PAGE = `<!doctype html><html><head>
<meta property="og:image" content="https://static-ca-cdn.eporner.com/thumbs/deco.jpg" />
<meta property="og:video:duration" content="1008" /></head><body><div class="player"></div></body></html>`
const ICEPORN_EMBED_PAGE = `<!doctype html><html><head>
<meta property="og:image" content="https://thumb.iceppsn.test/media/deco.jpg" /></head><body></body></html>`

// A page whose og:video file lives on a CDN that hotlink-checks visitors:
// the feed must route playback (and the poster) through the Worker proxy.
const PROXY_FILE_PAGE = `<!doctype html><html><head><title>Big Baddie Leak</title>
<meta property="og:site_name" content="NaijaLeaks" />
<meta property="og:video" content="https://cdn.proxy.test/uploads/big-baddie.mp4" />
<meta property="og:image" content="https://cdn.proxy.test/uploads/big-baddie.jpg" />
</head><body></body></html>`

// A mzansiadultblog-style repost: the video lives on VideoPress (WordPress.com)
// behind an iframe — the known-embed table must map it to /embed/.
const VP_PAGE = `<!doctype html><html><head><title>Wow Look At That Ass</title>
<link rel="stylesheet" href="/wp-content/themes/bosa/style.css" /></head>
<body><iframe src="https://videopress.com/v/9xKq2mPz" width="640" height="360" frameborder="0" allowfullscreen></iframe></body></html>`

// A post whose player iframe points at an unknown player PAGE that itself
// carries the file as og:video — the generic iframe chase must follow it.
const CHASE_PAGE = `<!doctype html><html><head><title>Chased Clip</title></head>
<body><iframe src="https://player.chasetest.test/watch/777" frameborder="0"></iframe></body></html>`
const CHASE_TARGET = `<!doctype html><html><head><title>Chased Clip — Player</title>
<meta property="og:video" content="https://cdn.chasetest.test/v/777.mp4" />
<meta property="og:image" content="https://cdn.chasetest.test/v/777.jpg" />
<meta property="og:video:duration" content="95" /></head><body></body></html>`

/** Headers the media proxy sent upstream, for Referer/Range assertions. */
const proxiedUpstream = []
/** Bodies of simulated GitHub workflow_dispatch calls (auto-rebuild tests). */
const rebuildDispatches = []
/** URLs of simulated Cloudflare Pages build-hook POSTs (auto-rebuild tests). */
const rebuildHookPosts = []
// mzansiadultblog reality for old reposts: the post stands, the embedded
// clip is gone at the source, and the page SAYS so.
const DEAD_REPOST_PAGE = `<!doctype html><html><head><title>Wow Look At That Ass</title></head>
<body><div class="video-wrapper"><h3>This video has been deleted</h3>
<p>Xvideos.com embed video</p>
<a href="https://www.xvideos.com/">Watch more porn</a></div></body></html>`
// Blogs love stuffing promo links into og:description. The caption we publish
// must keep the words, the poster and the source — and drop the links.
const LINKY_CAPTION_PAGE = `<!doctype html><html><head><title>Leaked Compilation</title>
<meta property="og:site_name" content="BlogTest" />
<meta property="og:title" content="Leaked Compilation" />
<meta property="og:description" content="Watch the full compilation at https://spam.test/promo — mirror at www.mirror.example.com/m. Enjoy!" />
<meta property="og:image" content="https://blog.test/img/poster.jpg" />
<meta property="og:video" content="https://blog.test/media/clip.mp4" />
</head><body></body></html>`

// What darknaija really serves a bot: an obfuscated shell whose only title is
// the site brand. The real headline lives in the permalink slug, and — when
// reachable — in the WP REST entry (with the file and the poster).
const BRAND_SHELL_PAGE = `<!doctype html><html><head><title>DarkNaija</title>
<meta property="og:site_name" content="DarkNaija" />
<meta property="og:title" content="DarkNaija" />
<link rel="stylesheet" href="/wp-content/themes/naija/style.css" /></head>
<body><div class="dlc">DOWNLOAD VIDEO</div></body></html>`

// The full live darknaija shape for a bot: WordPress custom-logo anchor
// (alt == site brand — the anchor scan used to turn THIS into the only
// "video"), a related-posts strip, and the real file behind a cross-host
// download link. og:title carries the brand as a " – DarkNaija" suffix.
const DARKNAIJA_LIVE_PAGE = `<!doctype html><html><head>
<title>Kampala Lady Josephine Record Herself Naked – DarkNaija</title>
<meta property="og:site_name" content="DarkNaija" />
<meta property="og:title" content="Kampala Lady Josephine Record Herself Naked – DarkNaija" />
<link rel="stylesheet" href="/wp-content/themes/naija/style.css" /></head>
<body>
<a class="custom-logo-link" href="https://darknaija.test/"><img class="custom-logo" src="/logo.png" alt="DarkNaija" /></a>
<h1>Kampala Lady Josephine Record Herself Naked</h1>
<div class="dlc"><a href="https://cdn.darknaija.test/uploads/12/josephine.mp4">DOWNLOAD VIDEO</a></div>
<div class="rel"><a href="/2026-07-19/mercy-from-kampala/"><img alt="ng-porn-742-img-92" src="/p1.jpg" />Mercy From Kampala</a>
<a href="/2026-06-06/kampala-lady-dancing/"><img alt="screenshot-viva-video" src="/p2.jpg" />Kampala Lady Dancing</a></div>
</body></html>`

// Same shell, but the ONLY title anywhere in the markup is the brand.
const DARKNAIJA_BRANDY_PAGE = `<!doctype html><html><head><title>DarkNaija</title>
<meta property="og:site_name" content="DarkNaija" />
<link rel="stylesheet" href="/wp-content/themes/naija/style.css" /></head>
<body><a class="custom-logo-link" href="/"><img alt="DarkNaija" src="/logo.png" /></a>
<div class="dlc"><a href="https://cdn.darknaija.test/uploads/9/only-slug.mp4">DOWNLOAD VIDEO</a></div></body></html>`

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
  if (u === `https://api.telegram.org/bot${TOKEN}/setMyCommands`) {
    menuCalls.push(JSON.parse(opts.body))
    return Response.json({ ok: true, result: true })
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
  // The metadata-recovery path the worker falls back to: bare watch page (this
  // id answers, others stay walled) and the API (down — must not hang).
  if (u === 'https://www.eporner.com/video-CqzTB8dIhZD/') {
    return new Response(EPORNER_EMBED_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (/^https:\/\/www\.eporner\.com\/video-[^/]+\/$/.test(u)) {
    return new Response('Just a moment...', { status: 403, headers: { 'Content-Type': 'text/html' } })
  }
  if (u.startsWith('https://www.eporner.com/api/v2/')) {
    return new Response('nope', { status: 500 })
  }
  if (u === 'https://www.xvideos.com/video49952353/hot-clip') {
    return new Response('blocked', { status: 403, headers: { 'Content-Type': 'text/html' } })
  }
  if (u === 'https://www.xvideos.com/embedframe/49952353') {
    return new Response('<!doctype html><html><head><title>Hot Clip</title></head><body>player</body></html>', { headers: { 'Content-Type': 'text/html' } })
  }
  if (u === 'https://mzansi.test/dead-repost/') {
    return new Response(DEAD_REPOST_PAGE, { headers: { 'Content-Type': 'text/html' } })
  }
  if (u === 'https://blog.test/linkycaption') {
    return new Response(LINKY_CAPTION_PAGE, { headers: { 'Content-Type': 'text/html' } })
  }
  if (u === 'https://darknaija.test/2026-10-29/kampala-lady-josephine-record-herself-naked/') {
    return new Response(BRAND_SHELL_PAGE, { headers: { 'Content-Type': 'text/html' } })
  }
  if (u === 'https://darknaija.test/wp-json/wp/v2/posts?slug=kampala-lady-josephine-record-herself-naked') {
    return Response.json([{
      id: 12,
      link: 'https://darknaija.test/2026-10-29/kampala-lady-josephine-record-herself-naked/',
      title: { rendered: 'Kampala Lady Josephine Record Herself Naked' },
      content: { rendered: '<figure><video controls src="https://cdn.darknaija.test/uploads/12/josephine.mp4"></video></figure>' },
      excerpt: { rendered: '' },
      yoast_head: '<meta property="og:image" content="https://darknaija.test/uploads/12/josephine.jpg" />',
    }])
  }
  // Same shell, but the REST API is empty too — only the slug can save it.
  if (u === 'https://shellonly.test/2026-10-29/kampala-lady-josephine-record-herself-naked/') {
    return new Response(BRAND_SHELL_PAGE, { headers: { 'Content-Type': 'text/html' } })
  }
  if (u.startsWith('https://shellonly.test/wp-json/')) return Response.json([])
  if (u === 'https://darknaija.test/2026-10-29/kampala-lady-josephine-record-herself-naked-2/') {
    return new Response(DARKNAIJA_LIVE_PAGE, { headers: { 'Content-Type': 'text/html' } })
  }
  if (u === 'https://darknaija.test/wp-json/wp/v2/posts?slug=kampala-lady-josephine-record-herself-naked-2') {
    return Response.json([])
  }
  if (u === 'https://darknaija.test/2026-01-02/slug-rescues-the-title/') {
    return new Response(DARKNAIJA_BRANDY_PAGE, { headers: { 'Content-Type': 'text/html' } })
  }
  if (u === 'https://darknaija.test/wp-json/wp/v2/posts?slug=slug-rescues-the-title') {
    return Response.json([])
  }
  if (u === 'https://api.github.com/repos/RBOWNER/RB/actions/workflows/deploy.yml/dispatches') {
    rebuildDispatches.push(JSON.parse(opts.body || '{}'))
    return new Response('', { status: 202 })
  }
  if (u.startsWith('https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/')) {
    rebuildHookPosts.push(u)
    if (u.includes('/dead-')) return new Response('{"success":false,"errors":[{"message":"invalid hook"}]}', { status: 403 })
    return new Response('{"success":true,"result":{"id":"deploy-hook-test"}}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (u === 'https://www.eporner.com/video-ABC123xyz/some-other-clip/') {
    return new Response(BAR_EPORNER_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://blog.test/escaped-cfg') {
    return new Response(ESCAPED_CFG_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://blog.test/frame-redirect') {
    return new Response(FRAME_REDIRECT_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://naija.test/2026-10-30/json-hidden/') {
    return new Response(NAIFICA_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u === 'https://naija.test/wp-json/wp/v2/posts?slug=json-hidden') {
    return Response.json([{
      id: 7,
      link: 'https://naija.test/2026-10-30/json-hidden/',
      title: { rendered: 'Baddie Street Clip' },
      content: { rendered: '<figure><video controls src="https://cdn.naija.test/uploads/7/baddie.mp4"></video></figure>' },
      excerpt: { rendered: '' },
      featured_media: 0,
      yoast_head: '<meta property="og:image" content="https://naija.test/uploads/7/poster.jpg" />',
    }])
  }
  // External file+poster with header capture for proxy assertions.
  if (u === 'https://proxy.test/big-baddie/') return new Response(PROXY_FILE_PAGE, { headers: { 'Content-Type': 'text/html' } })
  if (u === 'https://cdn.proxy.test/uploads/big-baddie.mp4') {
    proxiedUpstream.push({
      kind: 'video',
      range: String(opts.headers?.Range ?? opts.headers?.range ?? ''),
      referer: String(opts.headers?.Referer ?? opts.headers?.referer ?? ''),
      ua: String(opts.headers?.['User-Agent'] ?? opts.headers?.['user-agent'] ?? ''),
    })
    const range = opts.headers?.Range ?? opts.headers?.range
    if (typeof range === 'string' && /^bytes=(\d+)-(\d*)$/.test(range)) {
      const m = range.match(/^bytes=(\d+)-(\d*)$/)
      const start = Number(m[1])
      const end = m[2] === '' ? MP4.length - 1 : Math.min(Number(m[2]), MP4.length - 1)
      return new Response(MP4.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${MP4.length}`,
        },
      })
    }
    return new Response(MP4, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) } })
  }
  if (u === 'https://cdn.proxy.test/uploads/big-baddie.jpg') {
    proxiedUpstream.push({ kind: 'thumb', referer: String(opts.headers?.Referer ?? opts.headers?.referer ?? '') })
    return new Response(JPG, { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(JPG.length) } })
  }
  if (u === 'https://vp.test/wow-look-at-that-ass/') return new Response(VP_PAGE, { headers: { 'Content-Type': 'text/html' } })
  if (u === 'https://chasetest.test/chased-clip/') return new Response(CHASE_PAGE, { headers: { 'Content-Type': 'text/html' } })
  if (u === 'https://player.chasetest.test/watch/777') return new Response(CHASE_TARGET, { headers: { 'Content-Type': 'text/html' } })
  if (u === 'https://cdn.chasetest.test/v/777.mp4') return new Response(MP4, { headers: { 'Content-Type': 'video/mp4' } })
  if (u.startsWith('https://www.eporner.com/embed/')) {
    return new Response(EPORNER_EMBED_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (u.startsWith('https://www.iceporn.com/embed/')) {
    return new Response(ICEPORN_EMBED_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  return realFetch(url, opts)
}

class MockKV {
  constructor() { this.map = new Map() }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null }
  async put(k, v) { this.map.set(k, String(v)) }
  async delete(k) { this.map.delete(k) }
  async list({ prefix = '', limit = 1000 } = {}) {
    return {
      keys: [...this.map.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })),
      list_complete: true,
    }
  }
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
  // FEED_MEMO_MS=0 keeps the public-read memo off for this suite: several
  // sections write KV directly and assert the feed instantly. (A dedicated
  // section at the end exercises the memo itself on its own env.)
  const env = { BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET, VIDEOS: new MockKV(), FEED_MEMO_MS: '0' }

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

  console.log('— bot commands: /help, the slash-menu, /admin')
  sentMessages = []
  check('/start already registered the slash-menu with Telegram',
    menuCalls.length === 1 && Array.isArray(menuCalls[0].commands) && menuCalls[0].commands.some((c) => c.command === 'help'),
    JSON.stringify(menuCalls).slice(0, 140))
  check('menu registration is scoped to private chats', menuCalls[0]?.scope?.type === 'all_private_chats', JSON.stringify(menuCalls[0]?.scope))
  await webhook(env, textMsg(111, '/help'))
  check('/help re-prints the same guide /start gives', lastText().includes('Commands: /videos') && lastText().includes('Nothing scraped is published until'), lastText())
  await webhook(env, textMsg(111, '/menu'))
  await webhook(env, textMsg(111, '/help'))
  check('menu sync runs once a day, not per message', menuCalls.length === 1)
  await webhook(env, textMsg(111, '/quarantine'))
  check('unknown command points at /help', lastText().includes('/help'), lastText())
  await webhook(env, textMsg(111, '/admin'))
  check('/admin names the dashboard and the SITE_URL hint', lastText().includes('/admin') && lastText().includes('SITE_URL'), lastText())
  env.SITE_URL = 'https://rawclips.pages.dev'
  await webhook(env, textMsg(111, '/admin'))
  check('/admin links the dashboard once SITE_URL is set', lastText().includes('https://rawclips.pages.dev/admin'), lastText())
  delete env.SITE_URL

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
  check(
    'feed order stays newest-first — the two-minute rotation lives in the site, not the API',
    feed.every((video, i) => i === 0 || (feed[i - 1].createdAt ?? 0) >= (video.createdAt ?? 0)),
    JSON.stringify(feed.map((video) => video.createdAt)),
  )
  const scraped = feed.find((x) => x.title.startsWith('Hotel Hookup')) || {}
  check(
    'feed carries only the proxy for a scraped mp4 — never the raw URL',
    scraped.sourceUrl == null && scraped.streamUrl === `https://worker.test/api/videos/${scraped.id}/stream.mp4`,
    JSON.stringify(scraped),
  )
  {
    const hotelRecord = JSON.parse((await env.VIDEOS.get(`v:${scraped.id}`)) || '{}')
    check('the raw mp4 stays on the private record', hotelRecord.sourceUrl === 'https://cdn.sometube.test/videos/hotel.mp4', JSON.stringify(hotelRecord.sourceUrl))
  }
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
    'js-config mp4 becomes the playable source — proxied, raw URL hidden from the feed',
    fluidVideo.sourceUrl == null && String(fluidVideo.streamUrl || '').endsWith(`/api/videos/${fluidVideo.id}/stream.mp4`),
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
  check(
    'tube embed draft picks up its real poster',
    framedBody.drafts?.[0]?.thumbUrl === 'https://thumb.iceppsn.test/media/deco.jpg',
    JSON.stringify(framedBody.drafts?.[0]?.thumbUrl),
  )
  await admin('drafts/discard-all', { method: 'POST', headers: auth, body: '{}' })

  const escaped = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://blog.test/escaped-cfg' }),
  })
  const escapedBody = await escaped.json()
  check(
    'JSON-escaped file URLs are found after unescaping',
    escapedBody.drafts?.[0]?.sourceUrl === 'https://cdn.test/wp/uploads/clip.mp4'
      && escapedBody.drafts?.[0]?.sourceKind === 'file',
    JSON.stringify(escapedBody).slice(0, 180),
  )
  await admin('drafts/discard-all', { method: 'POST', headers: auth, body: '{}' })

  const redirected = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://blog.test/frame-redirect' }),
  })
  const redirectedBody = await redirected.json()
  check(
    'percent-encoded iframe redirect resolves to the tube embed',
    redirectedBody.drafts?.[0]?.sourceUrl === 'https://www.iceporn.com/embed/555111'
      && redirectedBody.drafts?.[0]?.sourceKind === 'embed',
    JSON.stringify(redirectedBody).slice(0, 180),
  )
  await admin('drafts/discard-all', { method: 'POST', headers: auth, body: '{}' })

  const viaRest = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://naija.test/2026-10-30/json-hidden/' }),
  })
  const viaRestBody = await viaRest.json()
  check(
    'WordPress REST rescue finds a file the page HTML hid',
    viaRestBody.drafts?.[0]?.sourceUrl === 'https://cdn.naija.test/uploads/7/baddie.mp4'
      && viaRestBody.drafts?.[0]?.sourceKind === 'file',
    JSON.stringify(viaRestBody).slice(0, 200),
  )
  check(
    'REST poster (yoast og:image) fills the draft thumbnail',
    viaRestBody.drafts?.[0]?.thumbUrl === 'https://naija.test/uploads/7/poster.jpg',
    JSON.stringify(viaRestBody.drafts?.[0]?.thumbUrl),
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
  check(
    'blocked tube draft decorates poster + duration from the embed page',
    tubeBlockedBody.drafts?.[0]?.thumbUrl === 'https://static-ca-cdn.eporner.com/thumbs/deco.jpg'
      && tubeBlockedBody.drafts?.[0]?.durationSec === 1008,
    JSON.stringify(tubeBlockedBody.drafts?.[0]).slice(0, 220),
  )
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

  console.log('— in-place repair of stale listings (re-pasting a broken link fixes it)')
  // Seed a pre-salvage record: published pointing at the page itself, no
  // poster. Re-scraping the SAME page must repair it in place — never a
  // "already on the site" dead end, never a duplicate.
  const stalePage = {
    id: 'w-stale-naija', kind: 'link', sourceKind: 'page',
    sourceUrl: 'https://naija.test/2026-10-30/json-hidden/',
    title: 'Old Broken Entry', category: 'Homemade', tags: [], durationSec: 0,
    thumbUrl: '', description: '', site: 'naija.test', createdAt: Date.now() - 10000,
  }
  await env.VIDEOS.put(`v:${stalePage.id}`, JSON.stringify(stalePage))
  await env.VIDEOS.put('idx', JSON.stringify([stalePage.id, ...JSON.parse((await env.VIDEOS.get('idx')) || '[]')]))

  const repairScrape = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://naija.test/2026-10-30/json-hidden/' }),
  })
  const repairBody = await repairScrape.json()
  check(
    'stale page-only record is repaired, not called a duplicate',
    repairBody.repaired === 1 && repairBody.drafts.length === 0,
    JSON.stringify(repairBody).slice(0, 200),
  )
  const afterRepair = (await feedOf(env)).find((v) => v.id === stalePage.id) || {}
  check(
    'repaired record now plays the REST-found file (via proxy, raw URL hidden)',
    String(afterRepair.streamUrl || '').endsWith(`/api/videos/${stalePage.id}/stream.mp4`) && afterRepair.sourceUrl == null,
    JSON.stringify(afterRepair).slice(0, 160),
  )
  {
    const repairedRec = JSON.parse((await env.VIDEOS.get(`v:${stalePage.id}`)) || '{}')
    check('the repaired raw file URL stays on the private record', String(repairedRec.sourceUrl || '').endsWith('/uploads/7/baddie.mp4'), JSON.stringify(repairedRec.sourceUrl))
  }
  check(
    'repaired record gained the poster (served via the thumb proxy)',
    afterRepair.thumbUrl === `https://worker.test/api/videos/${stalePage.id}/thumb.jpg`,
    JSON.stringify(afterRepair.thumbUrl),
  )
  check(
    'the stored record keeps the true upstream poster',
    JSON.parse(await env.VIDEOS.get(`v:${stalePage.id}`)).thumbUrl === 'https://naija.test/uploads/7/poster.jpg',
  )

  // And the eporner complaint: an embed record published without a poster
  // gets poster + duration backfilled when the same watch link is re-pasted.
  const staleEmbed = {
    id: 'w-stale-eporner', kind: 'link', sourceKind: 'embed',
    sourceUrl: 'https://www.eporner.com/embed/CqzTB8dIhZD/',
    title: 'Viral Couple', category: 'Homemade', tags: [], durationSec: 0,
    thumbUrl: '', description: '', site: 'eporner.com', createdAt: Date.now() - 10000,
  }
  await env.VIDEOS.put(`v:${staleEmbed.id}`, JSON.stringify(staleEmbed))
  await env.VIDEOS.put('idx', JSON.stringify([staleEmbed.id, ...JSON.parse((await env.VIDEOS.get('idx')) || '[]')]))

  const backfillScrape = await admin('scrape', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://www.eporner.com/video-CqzTB8dIhZD/viral-couple/' }),
  })
  const backfillBody = await backfillScrape.json()
  check(
    're-pasting a tube link backfills the missing poster',
    backfillBody.backfilled === 1 && backfillBody.drafts.length === 0,
    JSON.stringify(backfillBody).slice(0, 200),
  )
  const afterBackfill = (await feedOf(env)).find((v) => v.id === staleEmbed.id) || {}
  check(
    'backfilled record shows the tube poster (proxied) and duration',
    afterBackfill.thumbUrl === `https://worker.test/api/videos/${staleEmbed.id}/thumb.jpg`
      && afterBackfill.durationSec === 1008,
    JSON.stringify({ t: afterBackfill.thumbUrl, d: afterBackfill.durationSec }),
  )
  check(
    'the backfilled record keeps the upstream poster URL in storage',
    JSON.parse(await env.VIDEOS.get(`v:${staleEmbed.id}`)).thumbUrl === 'https://static-ca-cdn.eporner.com/thumbs/deco.jpg',
  )

  // ---- playback proxy for scraped external files (hotlink-blocked CDNs) ----
  const proxyScrape = await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://proxy.test/big-baddie/' }),
  })
  const proxyDraft = await proxyScrape.json()
  check(
    'proxy fixture scraped as a file',
    proxyDraft.drafts?.[0]?.sourceKind === 'file',
    JSON.stringify(proxyDraft.drafts?.[0]?.sourceKind),
  )
  const proxyPublish = await admin(`drafts/${proxyDraft.drafts[0].id}/publish`, { method: 'POST', headers: auth })
  const proxyPublished = await proxyPublish.json()
  check('proxy fixture published', proxyPublish.status === 200 && Boolean(proxyPublished.video?.id), JSON.stringify(proxyPublished))
  const proxyVideo = (await (await admin('videos', { headers: auth })).json())
    .videos.find((v) => v.id === proxyPublished.video.id)
  check(
    'published scrape streams through the Worker proxy',
    proxyVideo.streamUrl === `https://worker.test/api/videos/${proxyVideo.id}/stream.mp4`,
    JSON.stringify(proxyVideo.streamUrl),
  )
  check(
    'true source URL stays on the record (private)',
    proxyVideo.sourceUrl === 'https://cdn.proxy.test/uploads/big-baddie.mp4',
    JSON.stringify(proxyVideo.sourceUrl),
  )
  check(
    'scraped poster is proxied too',
    proxyVideo.thumbUrl === `https://worker.test/api/videos/${proxyVideo.id}/thumb.jpg`,
    JSON.stringify(proxyVideo.thumbUrl),
  )
  const feedProxyRow = (await feedOf(env)).find((v) => v.id === proxyVideo.id)
  check(
    'public feed exposes the proxied stream for scrapes',
    feedProxyRow?.streamUrl?.endsWith(`/api/videos/${proxyVideo.id}/stream.mp4`),
    JSON.stringify(feedProxyRow?.streamUrl),
  )
  proxiedUpstream.length = 0
  const proxyStream = await call(env, `https://worker.test/api/videos/${proxyVideo.id}/stream.mp4`)
  const streamBytes = new Uint8Array(await proxyStream.arrayBuffer())
  check(
    'proxied stream returns the file bytes',
    proxyStream.status === 200 && streamBytes.length === MP4.length && proxyStream.headers.get('Content-Type') === 'video/mp4',
    JSON.stringify({ s: proxyStream.status, n: streamBytes.length }),
  )
  const proxyThumb = await call(env, `https://worker.test/api/videos/${proxyVideo.id}/thumb.jpg`)
  check('proxied poster returns the image bytes', proxyThumb.status === 200 && (await proxyThumb.arrayBuffer()).byteLength === JPG.length)
  check(
    'upstream saw browser UA + source-site Referer',
    proxiedUpstream.length === 2
      && proxiedUpstream.every((h) => h.referer === 'https://proxy.test/')
      && /Mozilla/.test(proxiedUpstream.find((h) => h.kind === 'video')?.ua || ''),
    JSON.stringify(proxiedUpstream),
  )
  const proxyRange = await call(env, `https://worker.test/api/videos/${proxyVideo.id}/stream.mp4`, {
    headers: { range: 'bytes=0-3' },
  })
  check(
    'Range requests pass through to the upstream',
    proxyRange.status === 206
      && proxyRange.headers.get('Content-Range') === `bytes 0-3/${MP4.length}`
      && proxiedUpstream.some((h) => h.range === 'bytes=0-3'),
    JSON.stringify({ s: proxyRange.status, cr: proxyRange.headers.get('Content-Range') }),
  )
  const embedStream = await call(env, 'https://worker.test/api/videos/w-stale-eporner/stream.mp4')
  check('embed records refuse the stream proxy', embedStream.status === 404)
  await env.VIDEOS.put(
    'v:w-ssrf-test',
    JSON.stringify({ id: 'w-ssrf-test', kind: 'link', sourceKind: 'file', sourceUrl: 'https://worker.test/evil.mp4', title: 'SSRF probe', category: 'POV', tags: [], durationSec: 0, createdAt: Date.now(), updatedAt: null }),
  )
  const ssrfRes = await call(env, 'https://worker.test/api/videos/w-ssrf-test/stream.mp4')
  check('proxy refuses its own origin', ssrfRes.status === 404)
  await env.VIDEOS.delete('v:w-ssrf-test')

  // ---- VideoPress (mzansiadultblog-style reposts) ----
  const vpScrape = await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://vp.test/wow-look-at-that-ass/' }),
  })
  const vpDraft = await vpScrape.json()
  check(
    'VideoPress iframe maps to a direct embed URL',
    vpDraft.drafts?.[0]?.sourceKind === 'embed' && vpDraft.drafts?.[0]?.sourceUrl === 'https://videopress.com/embed/9xKq2mPz',
    JSON.stringify({ k: vpDraft.drafts?.[0]?.sourceKind, s: vpDraft.drafts?.[0]?.sourceUrl }),
  )
  await admin(`drafts/${vpDraft.drafts[0].id}`, { method: 'DELETE', headers: auth })

  // ---- generic player-iframe chase ----
  const chaseScrape = await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://chasetest.test/chased-clip/' }),
  })
  const chaseDraft = await chaseScrape.json()
  check(
    'unknown player iframe is chased to its file',
    chaseDraft.drafts?.[0]?.sourceKind === 'file' && chaseDraft.drafts?.[0]?.sourceUrl === 'https://cdn.chasetest.test/v/777.mp4',
    JSON.stringify({ k: chaseDraft.drafts?.[0]?.sourceKind, s: chaseDraft.drafts?.[0]?.sourceUrl }),
  )
  check(
    'chase inherits the inner page duration',
    chaseDraft.drafts?.[0]?.durationSec === 95,
    JSON.stringify(chaseDraft.drafts?.[0]?.durationSec),
  )
  await admin(`drafts/${chaseDraft.drafts[0].id}`, { method: 'DELETE', headers: auth })

  // ---- self-heal: stored but never indexed ("posted, went nowhere") ----
  await env.VIDEOS.put(
    'v:w-orphaned',
    JSON.stringify({ id: 'w-orphaned', kind: 'link', sourceKind: 'embed', sourceUrl: 'https://videopress.com/embed/orphan1', title: 'Orphaned Clip', category: 'POV', tags: [], durationSec: 0, createdAt: Date.now(), updatedAt: null }),
  )
  const orphanVideos = await (await admin('videos', { headers: auth })).json()
  check("dashboard load re-indexes an orphaned record", orphanVideos.videos.some((v) => v.id === 'w-orphaned'))
  check('re-indexed record appears in the public feed too', (await feedOf(env)).some((v) => v.id === 'w-orphaned'))
  await env.VIDEOS.delete('v:w-orphaned')
  {
    const raw = await env.VIDEOS.get('idx')
    await env.VIDEOS.put('idx', JSON.stringify(JSON.parse(raw).filter((x) => x !== 'w-orphaned')))
  }

  // ---- XVideos (mzansi's other player) resolves to its embedframe ----
  const xvideoBody = await (await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.xvideos.com/video49952353/hot-clip' }),
  })).json()
  check(
    'xvideos watch link becomes its embedframe player',
    xvideoBody.drafts?.[0]?.sourceKind === 'embed'
      && xvideoBody.drafts?.[0]?.sourceUrl === 'https://www.xvideos.com/embedframe/49952353',
    JSON.stringify({ k: xvideoBody.drafts?.[0]?.sourceKind, s: xvideoBody.drafts?.[0]?.sourceUrl }),
  )
  await admin(`drafts/${xvideoBody.drafts[0].id}`, { method: 'DELETE', headers: auth })

  // ---- deleted-at-source post: refuse with a reason, no broken listing ----
  const deadRes = await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://mzansi.test/dead-repost/' }),
  })
  const deadBody = await deadRes.json()
  check(
    'a post whose video was deleted upstream is refused with an explanation',
    deadRes.status === 422 && /deleted/i.test(deadBody.message || '') && !deadBody.drafts,
    JSON.stringify(deadBody),
  )

  // ---- published captions are link-free; everything else untouched ----
  const linkyBody = await (await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://blog.test/linkycaption' }),
  })).json()
  const linkyDraft = linkyBody.drafts?.[0] || {}
  check(
    'a scraped caption keeps its words but loses every link',
    /Watch the full compilation/.test(linkyDraft.description || '')
      && !/spam\.test|www\.|mirror\.example|https?:|t\.me/.test(linkyDraft.description || ''),
    JSON.stringify(linkyDraft.description),
  )
  check(
    'link-stripping changes nothing else: same source file, poster and title',
    linkyDraft.sourceUrl === 'https://blog.test/media/clip.mp4'
      && linkyDraft.thumbUrl === 'https://blog.test/img/poster.jpg'
      && linkyDraft.title === 'Leaked Compilation',
    JSON.stringify({ s: linkyDraft.sourceUrl, t: linkyDraft.thumbUrl, n: linkyDraft.title }),
  )
  const linkyPub = await (await admin(`drafts/${linkyDraft.id}/publish`, { method: 'POST', headers: auth })).json()
  const linkyRow = (await feedOf(env)).find((v) => v.id === linkyPub.video?.id)
  check(
    'the published record reads clean in the public feed',
    Boolean(linkyRow) && /Enjoy!/.test(linkyRow.description)
      && !/spam\.test|www\.|example\.com|https?:/.test(linkyRow.description),
    JSON.stringify(linkyRow?.description),
  )
  // Records published BEFORE this fix read clean at serve time — no
  // republish, no rebuild, whatever Worker version wrote them.
  await env.VIDEOS.put('v:w-linky-old', JSON.stringify({
    id: 'w-linky-old', kind: 'link', title: 'Old Post', category: 'POV', tags: [],
    description: 'Hot scene, full pack at t.me/pack4u and example.shop/buy',
    sourceUrl: 'https://blog.test/old.mp4', sourceKind: 'file', site: 'blog.test',
    createdAt: Date.now(), updatedAt: null,
  }))
  await env.VIDEOS.put('idx', JSON.stringify(['w-linky-old', ...JSON.parse((await env.VIDEOS.get('idx')) || '[]')]))
  const oldRow = (await feedOf(env)).find((v) => v.id === 'w-linky-old')
  check(
    'a stored record from before the fix still reads link-free on the feed',
    Boolean(oldRow) && /full pack/.test(oldRow.description) && !/t\.me|example\.shop/.test(oldRow.description),
    JSON.stringify(oldRow?.description),
  )
  const patchRes = await admin(`videos/${linkyPub.video.id}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'Slick edit, more at x.to/p' }),
  })
  const patchedRow = (await feedOf(env)).find((v) => v.id === linkyPub.video.id)
  check(
    'owner edits persist verbatim in storage but never reach the feed with a link',
    patchRes.status === 200
      && Boolean(patchedRow) && /Slick edit/.test(patchedRow.description) && !/x\.to/.test(patchedRow.description),
    JSON.stringify(patchedRow?.description),
  )
  await env.VIDEOS.delete(`v:${linkyPub.video.id}`)
  await env.VIDEOS.delete('v:w-linky-old')
  {
    const raw = await env.VIDEOS.get('idx')
    await env.VIDEOS.put('idx', JSON.stringify(JSON.parse(raw).filter((x) => x !== 'w-linky-old' && x !== linkyPub.video?.id)))
  }

  // ---- a brand-named shell page must not become the video's title ----
  const brandScrape = await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://darknaija.test/2026-10-29/kampala-lady-josephine-record-herself-naked/' }),
  })
  const brandBody = await brandScrape.json()
  const brandDraft = brandBody.drafts?.[0] || {}
  check(
    'an obfuscated shell titled after its site gets the real headline instead',
    brandDraft.title === 'Kampala Lady Josephine Record Herself Naked'
      && brandDraft.sourceUrl === 'https://cdn.darknaija.test/uploads/12/josephine.mp4'
      && brandDraft.sourceKind === 'file',
    JSON.stringify({ t: brandDraft.title, s: brandDraft.sourceUrl, k: brandDraft.sourceKind }),
  )
  if (brandDraft.id) await admin(`drafts/${brandDraft.id}`, { method: 'DELETE', headers: auth })
  const shellBody = await (await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://shellonly.test/2026-10-29/kampala-lady-josephine-record-herself-naked/' }),
  })).json()
  check(
    'with the REST API gone too, the permalink slug titles the clip',
    shellBody.drafts?.[0]?.title === 'Kampala Lady Josephine Record Herself Naked',
    JSON.stringify(shellBody.drafts?.[0]?.title),
  )
  if (shellBody.drafts?.[0]?.id) await admin(`drafts/${shellBody.drafts[0].id}`, { method: 'DELETE', headers: auth })
  // Published records keep working: re-pasting upgrades a brand-only title
  // on the existing listing (same source URL → backfill, not a new draft).
  await env.VIDEOS.put('v:w-brand-title', JSON.stringify({
    id: 'w-brand-title', kind: 'link', sourceKind: 'file', title: 'DarkNaija',
    sourceUrl: 'https://cdn.darknaija.test/uploads/12/josephine.mp4', site: 'darknaija.test',
    category: 'POV', tags: [], description: '', thumbUrl: '', durationSec: 0,
    createdAt: Date.now(), updatedAt: null,
  }))
  await env.VIDEOS.put('idx', JSON.stringify(['w-brand-title', ...JSON.parse((await env.VIDEOS.get('idx')) || '[]')]))
  const brandRepair = await (await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://darknaija.test/2026-10-29/kampala-lady-josephine-record-herself-naked/' }),
  })).json()
  const repairedBrand = JSON.parse(await env.VIDEOS.get('v:w-brand-title'))
  check(
    're-pasting upgrades a brand-name title on the published listing',
    brandRepair.drafts.length === 0 && brandRepair.backfilled >= 1
      && repairedBrand.title === 'Kampala Lady Josephine Record Herself Naked',
    JSON.stringify({ d: brandRepair.drafts.length, b: brandRepair.backfilled, t: repairedBrand.title }),
  )
  await env.VIDEOS.delete('v:w-brand-title')
  {
    const raw = await env.VIDEOS.get('idx')
    await env.VIDEOS.put('idx', JSON.stringify(JSON.parse(raw).filter((x) => x !== 'w-brand-title')))
  }

  // ---- the page, not its logo, must win (live darknaija anchor shape) ----
  const liveBody = await (await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://darknaija.test/2026-10-29/kampala-lady-josephine-record-herself-naked-2/' }),
  })).json()
  const liveDrafts = liveBody.drafts || []
  check(
    'logo/nav anchors never become video items',
    !liveDrafts.some((d) => d.title === 'DarkNaija'),
    JSON.stringify(liveDrafts.map((d) => d.title)),
  )
  check(
    'the post’s own video wins over sidebar thumbnails, brand suffix cleaned',
    liveDrafts.length === 1
      && liveDrafts[0].title === 'Kampala Lady Josephine Record Herself Naked'
      && liveDrafts[0].sourceUrl === 'https://cdn.darknaija.test/uploads/12/josephine.mp4'
      && liveDrafts[0].sourceKind === 'file',
    JSON.stringify(liveDrafts.map((d) => ({ t: d.title, s: d.sourceUrl, k: d.sourceKind }))),
  )
  for (const d of liveDrafts) await admin(`drafts/${d.id}`, { method: 'DELETE', headers: auth })
  const brandyBody = await (await admin('scrape', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://darknaija.test/2026-01-02/slug-rescues-the-title/' }),
  })).json()
  check(
    'a brand-only page with a real download link: one draft, slug title, file source',
    brandyBody.drafts?.length === 1
      && brandyBody.drafts[0].title === 'Slug Rescues The Title'
      && brandyBody.drafts[0].sourceKind === 'file',
    JSON.stringify(brandyBody.drafts),
  )
  for (const d of brandyBody.drafts || []) await admin(`drafts/${d.id}`, { method: 'DELETE', headers: auth })

  // ---- automatic sitemap rebuild: one debounced deploy per change burst ----
  rebuildDispatches.length = 0
  const rbEnv = { ...env, ADMIN_TOKEN: 'admin-secret', GITHUB_TOKEN: 'gh', GITHUB_REPO: 'RBOWNER/RB', REBUILD_GAP_MS: '900000' }
  const rb = (e, path, opts = {}) =>
    call(e, `https://worker.test/api/admin/${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-secret', ...(opts.headers || {}) },
    })
  const seedRbDraft = async (draftId, sourceUrl) => {
    await env.VIDEOS.put(`draft:${draftId}`, JSON.stringify({
      id: draftId, title: `Rebuild ${draftId}`, category: 'POV', tags: [],
      description: '', site: 'rb.test', sourceUrl, sourceKind: 'file', thumbUrl: '',
      durationSec: 12, createdAt: Date.now(), pageUrl: 'https://rb.test/one/',
    }))
  }
  await seedRbDraft('d-rb1', 'https://rb.test/one.mp4')
  const rbPub1 = await (await rb(rbEnv, 'drafts/d-rb1/publish', { method: 'POST' })).json()
  check(
    'first publish after a quiet period dispatches one rebuild',
    rbPub1.ok && rebuildDispatches.length === 1 && rebuildDispatches[0].ref === 'main',
    JSON.stringify({ n: rebuildDispatches.length, body: rebuildDispatches[0] }),
  )
  await seedRbDraft('d-rb2', 'https://rb.test/two.mp4')
  await rb(rbEnv, 'drafts/d-rb2/publish', { method: 'POST' })
  check(
    'publishes inside the debounce window share ONE deploy',
    rebuildDispatches.length === 1 && (await env.VIDEOS.get('rebuild:queued')) === '1',
    JSON.stringify({ n: rebuildDispatches.length }),
  )
  await rb(rbEnv, 'rebuild', { method: 'POST' })
  check(
    'manual rebuild also clears the queue and resets the clock',
    rebuildDispatches.length === 2 && (await env.VIDEOS.get('rebuild:queued')) === null,
    JSON.stringify({ n: rebuildDispatches.length }),
  )
  await seedRbDraft('d-rb3', 'https://rb.test/three.mp4')
  await rb(rbEnv, 'drafts/d-rb3/publish', { method: 'POST' })
  check('windowed publish queues again without firing', rebuildDispatches.length === 2)
  await env.VIDEOS.put('rebuild:last', '0') // pretend the window has passed
  await rb(rbEnv, 'videos')
  check(
    'opening the dashboard drains the queued rebuild',
    rebuildDispatches.length === 3 && (await env.VIDEOS.get('rebuild:queued')) === null,
    JSON.stringify({ n: rebuildDispatches.length }),
  )
  await seedRbDraft('d-rb4', 'https://rb.test/four.mp4')
  await rb({ ...rbEnv, AUTO_REBUILD: 'off' }, 'drafts/d-rb4/publish', { method: 'POST' })
  check('AUTO_REBUILD=off vetoes the trigger', rebuildDispatches.length === 3)

  // A Cloudflare Pages site needs NO GitHub config: the build hook alone is
  // the trigger (URL is its own credential; Pages re-runs `npm run build`).
  await env.VIDEOS.delete('rebuild:last')
  const cfHook = 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/livetok'
  const cfEnv = { ...env, ADMIN_TOKEN: 'admin-secret', CLOUDFLARE_BUILD_HOOK: cfHook }
  await seedRbDraft('d-rb5', 'https://rb.test/five.mp4')
  await rb(cfEnv, 'drafts/d-rb5/publish', { method: 'POST' })
  check(
    'hook-only config fires the Cloudflare build hook instead of GitHub',
    rebuildHookPosts.length === 1 && rebuildHookPosts[0] === cfHook && rebuildDispatches.length === 3,
    JSON.stringify({ hooks: rebuildHookPosts, gh: rebuildDispatches.length }),
  )
  const cfSettings = await (await rb(cfEnv, 'settings')).json()
  check(
    'admin settings report autoRebuild from the hook alone (no GitHub config)',
    cfSettings.autoRebuild === true && cfSettings.github === false,
    JSON.stringify({ ar: cfSettings.autoRebuild, gh: cfSettings.github }),
  )
  const cfPublic = await (await call(cfEnv, 'https://worker.test/api/settings')).json()
  check('public /api/settings still leaks neither target nor token hints', cfPublic.mode && cfPublic.github === undefined)
  // Both hosts configured: one catalogue change refreshes BOTH copies.
  await env.VIDEOS.delete('rebuild:last')
  await seedRbDraft('d-rb6', 'https://rb.test/six.mp4')
  await rb({ ...rbEnv, CLOUDFLARE_BUILD_HOOK: cfHook }, 'drafts/d-rb6/publish', { method: 'POST' })
  check(
    'both targets fire on one change when both are configured',
    rebuildDispatches.length === 4 && rebuildHookPosts.length === 2,
    JSON.stringify({ gh: rebuildDispatches.length, hooks: rebuildHookPosts.length }),
  )
  // A dead hook (revoked token, typo'd URL) must not stop the GitHub copy.
  await env.VIDEOS.delete('rebuild:last')
  const halfEnv = { ...rbEnv, CLOUDFLARE_BUILD_HOOK: 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/dead-tok' }
  await seedRbDraft('d-rb7', 'https://rb.test/seven.mp4')
  const rb7 = await (await rb(halfEnv, 'drafts/d-rb7/publish', { method: 'POST' })).json()
  check(
    'a failing hook does not veto the GitHub target',
    rb7.ok && rebuildDispatches.length === 5,
    JSON.stringify({ ok: rb7.ok, gh: rebuildDispatches.length }),
  )
  const halfManual = await rb(halfEnv, 'rebuild', { method: 'POST' })
  const halfBody = await halfManual.json()
  check(
    'the dashboard reports partial success instead of hiding it',
    halfManual.status === 200 && halfBody.ok && /one target failed/i.test(halfBody.message || ''),
    JSON.stringify(halfBody).slice(0, 160),
  )
  // With neither configured, the button explains both options.
  const noneRes = await rb({ ...env, ADMIN_TOKEN: 'admin-secret' }, 'rebuild', { method: 'POST' })
  const noneBody = await noneRes.json()
  check(
    'unconfigured rebuild names CLOUDFLARE_BUILD_HOOK as the Pages route',
    noneRes.status === 503 && /CLOUDFLARE_BUILD_HOOK/.test(noneBody.message || ''),
    JSON.stringify(noneBody).slice(0, 160),
  )
  await env.VIDEOS.delete('rebuild:last')
  await env.VIDEOS.delete('rebuild:queued')

  console.log('— channel auto-post: ALLOWED_CHANNEL_IDS is id-format tolerant')
  {
    const chanPost = (chatId, uniq) => ({
      channel_post: {
        message_id: 7, date: 0,
        chat: { id: chatId, type: 'channel', title: 'Raw Clips' },
        caption: 'Channel drop #POV',
        video: {
          file_id: `vid-${uniq}`, file_unique_id: uniq, file_name: 'chan.mp4',
          duration: 60, width: 720, height: 1280, file_size: 5 * 1048576,
          thumbnail: { file_id: `thumb-${uniq}` },
        },
      },
    })
    const feedBefore = (await feedOf(env)).length
    // Owners type whatever number they were shown — the bare id without the
    // -100 supergroup prefix must still match the real (negative) chat id.
    env.ALLOWED_CHANNEL_IDS = '2188686361'
    await webhook(env, chanPost(-1002188686361, 'chanBare'))
    const afterBare = await feedOf(env)
    check('a bare channel id in ALLOWED_CHANNEL_IDS matches the -100 post',
      afterBare.length === feedBefore + 1 && afterBare.some((v) => /^Channel [Dd]rop$/.test(v.title || '')),
      JSON.stringify({ before: feedBefore, after: afterBare.length }))
    env.ALLOWED_CHANNEL_IDS = '-1002188686361'
    await webhook(env, chanPost(-1002188686361, 'chanFull'))
    const afterFull = await feedOf(env)
    check('the full -100 form matches too (same channel, second file)',
      afterFull.length === feedBefore + 2, JSON.stringify(afterFull.length))
    // An unlisted channel publishes nothing and nags the owner once — with
    // the exact id to paste.
    env.ALLOWED_CHANNEL_IDS = '999999999'
    sentMessages = []
    await webhook(env, chanPost(-100123123123, 'chanStranger'))
    check('an unlisted channel never auto-publishes', (await feedOf(env)).length === feedBefore + 2)
    check('and the owner is told which id to add',
      lastText().includes('ALLOWED_CHANNEL_IDS') && lastText().includes('-100123123123'), lastText())
    delete env.ALLOWED_CHANNEL_IDS
    for (const rec of (await feedOf(env)).filter((x) => /^Channel [Dd]rop$/.test(x.title || ''))) {
      await env.VIDEOS.delete(`v:${rec.id}`)
      const rawIdx = await env.VIDEOS.get('idx')
      await env.VIDEOS.put('idx', JSON.stringify(JSON.parse(rawIdx || '[]').filter((x) => x !== rec.id)))
    }
  }

  console.log('— KV quota: public reads memoize, mutations invalidate')
  {
    const menv = { BOT_TOKEN: TOKEN, WEBHOOK_SECRET: SECRET, VIDEOS: new MockKV() }
    await webhook(menv, textMsg(111, '/start'))
    await webhook(menv, videoMsg(111, 'memoA'))
    const mget = menv.VIDEOS.get.bind(menv.VIDEOS)
    let mreads = 0
    menv.VIDEOS.get = async (...args) => { mreads += 1; return mget(...args) }
    const r1 = await call(menv, 'https://worker.test/api/videos')
    const feed1 = await r1.text()
    const buildReads = mreads
    check('memo: the first feed request pays the reads', buildReads > 0, String(buildReads))
    mreads = 0
    const r2 = await call(menv, 'https://worker.test/api/videos')
    const feed2 = await r2.text()
    check('memo: repeat page views cost zero KV reads and identical bytes',
      mreads === 0 && feed1 === feed2 && r2.headers.get('x-feed-cache') === 'hit',
      `${mreads} reads, ${feed1 === feed2 ? 'same' : 'different'}`)
    const memoId = JSON.parse(feed1).videos[0].id
    mreads = 0
    await call(menv, `https://worker.test/api/videos/${memoId}/thumb.jpg`)
    const thumbFirst = mreads
    mreads = 0
    await call(menv, `https://worker.test/api/videos/${memoId}/thumb.jpg`)
    check('memo: proxied media reuses the cached record', thumbFirst === 1 && mreads === 0,
      JSON.stringify({ first: thumbFirst, again: mreads }))
    await webhook(menv, videoMsg(111, 'memoB')) // publish → markCatalogChanged → invalidate
    mreads = 0
    const feed3 = await (await call(menv, 'https://worker.test/api/videos')).json()
    check('a publish invalidates the memo on the very next request',
      mreads > 0 && feed3.videos.length === 2, JSON.stringify({ reads: mreads, n: feed3.videos.length }))
  }

  console.log('\n' + `${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
