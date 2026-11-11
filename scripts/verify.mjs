#!/usr/bin/env node
/**
 * Checks the built site against the indexing rules that matter:
 *
 *   node scripts/verify.mjs        (after `npm run build`)
 *
 * - sitemap.xml lists every catalogue video once, with <lastmod>
 * - robots.txt allows every crawler and points at the sitemap
 * - every video has its own 200 page with a unique title, description,
 *   index/follow, canonical, OG/Twitter tags and a VideoObject JSON-LD block
 * - no page links to another video
 * - "/" and the unknown-path shell list no videos and are noindex
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalogue } from './load-catalogue.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${name}`)
  else {
    failures += 1
    console.log(`  ✗ ${name} ${detail}`)
  }
}

const read = (path) => readFile(join(dist, path), 'utf8')

const catalogue = await loadCatalogue()
const sitemap = await read('sitemap.xml')
const robots = await read('robots.txt')
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => match[1])

const siteUrl = (locs[0] || '').replace(/\/v\/[^/]+\/$/, '')
const ids = locs.map((loc) => decodeURIComponent(loc.replace(/^.*\/v\//, '').replace(/\/$/, '')))
const videos = ids.map((id) => catalogue.find((video) => video.id === id) || { id, title: id })

console.log('— sitemap & robots')
check('sitemap lists videos', locs.length > 0)
check('sitemap URLs are unique', new Set(locs).size === locs.length)
check('every catalogue video is listed', catalogue.every((video) => locs.some((loc) => loc.endsWith(`/v/${video.id}/`))))
check('lastmod values are dates', lastmods.length === locs.length && lastmods.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))
check('sitemap namespace declared', sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'))
check('robots allows every crawler', /User-agent:\s*\*/.test(robots) && /Allow:\s*\/\s*$/m.test(robots))
check('robots points at the sitemap', robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`), robots)
check('robots keeps the dashboard out of the index', robots.includes('Disallow: /admin'), robots)
check('sitemap declares the Google image extension', sitemap.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'))
{
  const imageLocs = [...sitemap.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((match) => match[1])
  check('every sitemap entry carries its poster', imageLocs.length === locs.length && imageLocs.every((src) => /^https?:\/\//.test(src)))
}
check(
  'catalogue shell invites crawlers to follow while staying out of the index',
  /<meta name="robots" content="noindex, follow/.test(await read('index.html')),
)

console.log('— shared SEO module (functions/_middleware.ts imports the same)')
{
  const { buildHead, sitemapXml, feedToSeoVideo } = await import('./seo.mjs')
  const head = buildHead('https://x.test', { id: 'a', title: 'T', thumbnail: '', videoUrl: 'https://x.test/a.mp4' }, { verification: 'TOKEN123' })
  check('verification meta lands when configured', head.includes('<meta name="google-site-verification" content="TOKEN123" />'))
  check('verification meta stays out when unset', !buildHead('https://x.test', { id: 'a', title: 'T', videoUrl: '' }).includes('google-site-verification'))
  const sm = sitemapXml('https://x.test', [{ id: 'a', title: 'T', thumbnail: 't.jpg', addedAt: '2026-01-02', updatedAt: '2026-05-05T10:00:00Z' }])
  check('lastmod prefers the update date', sm.includes('<lastmod>2026-05-05</lastmod>'), sm)
  check('sitemap URLs are absolute with trailing slash', sm.includes('<loc>https://x.test/v/a/</loc>'))
  check('feed items without a source are skipped', feedToSeoVideo({ id: 'x' }) === null && feedToSeoVideo({ id: 'y', streamUrl: 's' }) !== null)
}

console.log('— root, admin and unknown paths')
for (const name of ['index.html', '404.html', 'admin/index.html']) {
  const html = await read(name)
  check(`${name} is noindex`, /<meta name="robots" content="noindex/.test(html))
  check(`${name} lists no videos`, !videos.some((video) => html.includes(video.id) || html.includes(video.title)))
  check(`${name} has no internal links`, !/<a\s[^>]*href="\/(?!\/)/i.test(html))
}

console.log('— the site itself previews as a card')
{
  const html = await read('index.html')
  check('home carries og:title, og:description and og:site_name',
    ['og:title', 'og:description', 'og:site_name'].every((tag) => html.includes(`property="${tag}"`)),
    html.slice(0, 400))
  check('home asks the chat app for a card, not a bare link',
    /name="twitter:card" content="summary(_large_image)?"/.test(html))
  const images = [...html.matchAll(/property="og:image" content="([^"]+)"/g)].map((match) => match[1])
  check('any home card image is an absolute URL a crawler can fetch', images.every((src) => /^https:\/\//.test(src)))
  check('the card image exists exactly when public/og-cover.jpg is in the repo',
    images.length === (existsSync(join(root, 'public', 'og-cover.jpg')) ? 1 : 0), String(images.length))
  const shell = await read('v/_shell.html')
  check('the /v/ fallback shell leaves the metadata for the middleware to inject',
    !/property="og:(title|description|image|url)"/.test(shell))
}

console.log('— preview cards (the big image a chat app shows)')
{
  const { buildPreviewCards, cardCanvasFor, loadSharp, MIN_CARD_EDGE, MAX_BYTES, SQUARE_SIZE, WIDE_WIDTH, WIDE_HEIGHT } =
    await import('./preview-card.mjs')

  /** Read the size out of JPEG bytes — no library, because a claim must be checked against the file itself. */
  const jpegSize = (bytes) => {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue }
      const marker = bytes[i + 1]
      const length = (bytes[i + 2] << 8) | bytes[i + 3]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
      }
      i += 2 + length
    }
    return null
  }

  check('a vertical clip gets the square card, a wide one the 16:9 card',
    cardCanvasFor(180, 320).width === SQUARE_SIZE && cardCanvasFor(180, 320).height === SQUARE_SIZE
      && cardCanvasFor(640, 360).width === WIDE_WIDTH && cardCanvasFor(640, 360).height === WIDE_HEIGHT,
    JSON.stringify({ tall: cardCanvasFor(180, 320), wide: cardCanvasFor(640, 360) }))
  check('both cards clear the edge the apps need to show one large',
    Math.min(SQUARE_SIZE, WIDE_WIDTH, WIDE_HEIGHT) >= MIN_CARD_EDGE)

  const sharp = await loadSharp()
  check('sharp resolves as an optional dependency (absent is allowed, never fatal)', sharp === null || typeof sharp === 'function')

  if (sharp) {
    // Any poster is enough to prove the geometry: the card must come out at the
    // size the metadata will declare, or the claim in og:image is a lie.
    const poster = await sharp({
      create: { width: 180, height: 320, channels: 3, background: { r: 190, g: 30, b: 80 } },
    }).jpeg().toBuffer()
    const dataUri = `data:image/jpeg;base64,${poster.toString('base64')}`
    const dir = await mkdtemp(join(tmpdir(), 'afterdark-covers-'))
    const built = await buildPreviewCards({
      videos: [{ id: 'unit-card', thumbnail: dataUri }, { id: 'no-poster', thumbnail: '' }],
      outDir: dir,
      fetchImpl: async (url) => (String(url).startsWith('data:')
        ? new Response(Buffer.from(String(url).split(',')[1], 'base64'))
        : Promise.reject(new Error('only data: URLs in this check'))),
    })
    const file = join(dir, 'unit-card.jpg')
    const size = jpegSize(await readFile(file))
    check('a poster becomes a square card of the declared size',
      size && size.width === SQUARE_SIZE && size.height === SQUARE_SIZE, JSON.stringify(size))
    check('the card is a JPEG small enough for a crawler to fetch gladly',
      (await stat(file)).size <= MAX_BYTES, String((await stat(file)).size))
    check('the card path is site-relative so it follows the deployment',
      built.covers.get('unit-card')?.path === '/previews/unit-card.jpg'
        && built.covers.get('unit-card')?.width === SQUARE_SIZE,
      JSON.stringify(built.covers.get('unit-card')))
    check('a video without a poster is skipped, not guessed',
      built.covers.has('unit-card') && !built.covers.has('no-poster') && built.skipped >= 1,
      JSON.stringify({ made: built.made, skipped: built.skipped }))
    const starved = await buildPreviewCards({
      videos: [{ id: 'too-late', thumbnail: dataUri }],
      outDir: dir,
      deadlineMs: -1,
      fetchImpl: async () => { throw new Error('must not even be tried') },
    })
    check('a build that runs out of time skips the cards instead of failing',
      starved.made === 0 && starved.skipped === 1 && starved.timedOut === true,
      JSON.stringify({ made: starved.made, skipped: starved.skipped, timedOut: Boolean(starved.timedOut) }))
    const { composeCard } = await import('./preview-card.mjs')
    check('unreadable bytes produce no card rather than a broken one', (await composeCard(sharp, Buffer.from('not an image'))) === null)
    await rm(dir, { recursive: true, force: true })
  }

  // The real build output: every page must claim exactly what its file holds.
  let sized = 0
  for (const video of videos) {
    let html
    try {
      html = await read(`v/${video.id}/index.html`)
    } catch {
      continue
    }
    const image = /property="og:image" content="([^"]+)"/.exec(html)?.[1] || ''
    const declared = /property="og:image:width" content="(\d+)"/.exec(html)?.[1] || ''
    const declaredHeight = /property="og:image:height" content="(\d+)"/.exec(html)?.[1] || ''
    let card = null
    try {
      card = jpegSize(await readFile(join(dist, 'previews', `${video.id}.jpg`)))
    } catch {
      card = null
    }
    if (card) {
      sized += 1
      check(`${video.id}: page points at its own card`, image.endsWith(`/previews/${video.id}.jpg`), image)
      check(`${video.id}: declared size matches the bytes on disk (a lie here means no big card)`,
        declared === String(card.width) && declaredHeight === String(card.height), `${declared}x${declaredHeight} vs ${card.width}x${card.height}`)
      check(`${video.id}: card is big enough for the large layout`,
        Math.min(card.width, card.height) >= MIN_CARD_EDGE, `${card.width}x${card.height}`)
      check(`${video.id}: the sitemap advertises the same image the page shows`,
        sitemap.includes(`${siteUrl}/previews/${video.id}.jpg`))
    } else {
      check(`${video.id}: no card, so no size is claimed`, !declared && !declaredHeight && Boolean(image), image)
    }
  }
  console.log(`  · ${sized}/${videos.length} video page(s) carry a composed preview card`)
}

console.log('— video pages')
let pages = 0
for (const video of videos) {
  let html
  try {
    html = await read(`v/${video.id}/index.html`)
  } catch {
    check(`${video.id}: page exists`, false)
    continue
  }
  pages += 1
  const others = videos.filter((other) => other.id !== video.id)
  const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)
  let object = null
  try {
    object = jsonLd ? JSON.parse(jsonLd[1]) : null
  } catch {
    object = null
  }

  check(`${video.id}: own title`, /<title>[^<]+<\/title>/.test(html) && html.includes(video.title.replace(/&/g, '&amp;')))
  check(`${video.id}: meta description`, /<meta name="description" content="[^"]+"/.test(html))
  check(`${video.id}: index, follow`, /<meta name="robots" content="index, follow/.test(html))
  check(`${video.id}: canonical`, new RegExp(`<link rel="canonical" href="${siteUrl}/v/${video.id}/"`).test(html))
  check(`${video.id}: Open Graph`, ['og:title', 'og:description', 'og:image', 'og:url'].every((tag) => html.includes(`property="${tag}"`)))
  const ogImage = /property="og:image" content="([^"]+)"/.exec(html)?.[1] || ''
  check(`${video.id}: card image is an absolute URL a chat app can fetch`,
    /^https?:\/\//.test(ogImage), ogImage)
  check(`${video.id}: Twitter card`, ['summary_large_image', 'twitter:title', 'twitter:description', 'twitter:image'].every((tag) => html.includes(tag)))
  check(
    `${video.id}: VideoObject JSON-LD`,
    object?.['@type'] === 'VideoObject' &&
      typeof object.name === 'string' &&
      typeof object.description === 'string' &&
      Array.isArray(object.thumbnailUrl) &&
      typeof object.uploadDate === 'string' &&
      Boolean(object.contentUrl || object.embedUrl),
    JSON.stringify(object),
  )
  check(`${video.id}: no link to another video`, !others.some((other) => html.includes(`/v/${other.id}`)))
  check(`${video.id}: no other video ids`, !others.some((other) => html.includes(other.id)))
  check(`${video.id}: no internal anchors`, !/<a\s[^>]*href="(\/|\.)/i.test(html))
}

console.log('— new-video fallback')
{
  let shell = ''
  try {
    shell = await read('v/_shell.html')
  } catch {
    shell = ''
  }
  check('fallback shell exists for videos added after the build', shell.length > 0)
  check('fallback shell is noindex', /<meta name="robots" content="noindex/.test(shell))
  check('fallback shell is not in the sitemap', !sitemap.includes('_shell'))
}

console.log('— deploy stamp (the Worker is pasted into a dashboard, so it needs a marker)')
{
  const source = await readFile(join(root, 'worker/worker.js'), 'utf8')
  const stamp = /const WORKER_BUILD = '(\d{4}-\d{2}-\d{2})\.(\d+)'/.exec(source)
  check('worker.js carries a deploy stamp', Boolean(stamp), 'expected const WORKER_BUILD = YYYY-MM-DD.N')
  check('GET /health reports it, so "did my paste take?" is a one-second check',
    /build \$\{WORKER_BUILD\}/.test(source))
  let lastTouched = ''
  try {
    lastTouched = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'worker/worker.js'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    lastTouched = '' // no git here (a Pages build container): nothing to compare against
  }
  if (lastTouched && stamp) {
    check('the stamp is at least as new as the last commit that touched the Worker',
      stamp[1] >= lastTouched,
      `stamp ${stamp[1]} vs commit ${lastTouched} — bump WORKER_BUILD in worker/worker.js`)
  } else {
    console.log('  · stamp-vs-git skipped (no git history in this checkout)')
  }
}

console.log('— summary')
check(`all ${videos.length} video pages prerendered`, pages === videos.length, `${pages} page(s)`)
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed (${pages} video page(s))`)
process.exit(failures ? 1 : 0)
