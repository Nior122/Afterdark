/**
 * Post-build step: static HTML for every video, plus sitemap.xml / robots.txt.
 *
 * The site is one app with two personalities (a runtime mode switch), and the
 * files below serve both:
 *
 *   dist/v/<id>/index.html   one page per video, 200, with a unique title,
 *                            description, canonical, Open Graph/Twitter tags and
 *                            a schema.org VideoObject block. The app is bundled
 *                            inside, so the player still works.
 *   dist/admin/index.html    the owner dashboard (noindex, not linked anywhere)
 *   dist/index.html          the catalogue shell (noindex — hash routes are not
 *                            per-video URLs; videos are indexed at /v/<id>/)
 *   dist/404.html            same shell, for unknown paths on static hosts
 *   dist/sitemap.xml         every video URL + <lastmod> (the only discovery path)
 *   dist/robots.txt          allow all crawlers, point at the sitemap
 *
 * Because the video pages and sitemap are generated from the catalogue plus
 * the bot feed at build time, adding a video from the bot or dashboard needs a
 * rebuild before it is indexable — the dashboard has a "Rebuild site" button
 * for that.
 *
 * Run by `npm run build`; can also be run on its own after a build.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalogue } from './load-catalogue.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

/** Fallback matching the live deployment; set VITE_SITE_URL for a real domain. */
const FALLBACK_SITE_URL = 'https://nior122.github.io/Afterdark'
const configuredSiteUrl = (process.env.VITE_SITE_URL || '').trim()
const SITE_URL = (configuredSiteUrl || FALLBACK_SITE_URL).replace(/\/+$/, '')
if (!configuredSiteUrl) {
  console.warn(
    `⚠️  VITE_SITE_URL is not set — canonical URLs, Open Graph URLs and sitemap.xml will use\n` +
      `    ${FALLBACK_SITE_URL}\n` +
      `    Set VITE_SITE_URL to the domain the site is served from before submitting it to search engines.`,
  )
}

const SITE_NAME = 'AfterDark'
/** Stable fallback so repeated builds don't churn every <lastmod>. */
const LAUNCH_DATE = '2026-01-01'
const FEED_URL = (process.env.VITE_TELEGRAM_FEED_URL || '').replace(/\/+$/, '')
const MAX_DESCRIPTION = 158

/** Path prefix of the deployment ("/" at a domain root, "/Afterdark/" on Pages). */
const basePath = (() => {
  try {
    const path = new URL(SITE_URL).pathname.replace(/\/+$/, '')
    return `${path}/`
  } catch {
    return '/'
  }
})()

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{2,}$/

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const escapeXml = escapeHtml

const absolute = (path) => {
  if (!path) return `${SITE_URL}/thumbnails/placeholder.svg`
  if (/^https?:\/\//i.test(path)) return path
  return `${SITE_URL}/${String(path).replace(/^(\.\/)+/, '').replace(/^\/+/, '')}`
}

const videoUrlFor = (id) => `${SITE_URL}/v/${encodeURIComponent(id)}/`

function isoDate(addedAt) {
  const raw = String(addedAt || '').trim()
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw || LAUNCH_DATE)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function metaDescription(video) {
  const summary = String(video.description || '')
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .trim()
  const base = summary
    ? `Watch “${video.title}” on ${SITE_NAME}.`
    : `Watch “${video.title}” on ${SITE_NAME}${video.category ? ` — ${video.category}` : ''}.`
  const text = summary ? `${base} ${summary}` : base
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 3).trimEnd()}…` : text
}

/** Mirrors src/lib/video.ts for the two fields the JSON-LD needs. */
function sourceOf(url) {
  const raw = String(url || '').trim()
  if (!raw) return { kind: 'none', src: '' }
  try {
    const parsed = new URL(raw)
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 't.me' || host === 'telegram.me' || host === 'telegram.dog') return { kind: 'telegram', src: raw }
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return { kind: 'youtube', src: raw }
    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return { kind: 'vimeo', src: raw }
    if (/\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i.test(parsed.pathname)) return { kind: 'file', src: raw }
    if (/\/(?:embed|e|player)(?:\/|$)/i.test(parsed.pathname) || host.startsWith('embed.') || host.startsWith('player.')) {
      return { kind: 'embed', src: raw }
    }
    return { kind: 'page', src: raw }
  } catch {
    return { kind: 'none', src: '' }
  }
}

function playerUrls(video) {
  const source = sourceOf(video.videoUrl)
  if (source.kind === 'file') return { contentUrl: source.src }
  if (source.kind === 'telegram') {
    const post = /t\.me\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})\/(\d+)/.exec(source.src)
    if (post) return { embedUrl: `https://t.me/${post[1]}/${post[2]}?embed=1&userpic=false&single=1&dark=1` }
    return { embedUrl: source.src }
  }
  if (source.kind === 'embed' || source.kind === 'youtube' || source.kind === 'vimeo' || source.kind === 'page') {
    return { embedUrl: source.src }
  }
  return {}
}

function isoDuration(duration) {
  const parts = String(duration || '')
    .split(':')
    .map(Number)
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return undefined
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0]
  if (!h && !m && !s) return undefined
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s ? `${s}S` : ''}`
}

function jsonLd(video) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: metaDescription(video),
    thumbnailUrl: [absolute(video.thumbnail)],
    uploadDate: isoDate(video.addedAt),
    url: videoUrlFor(video.id),
    ...(isoDuration(video.duration) ? { duration: isoDuration(video.duration) } : {}),
    ...playerUrls(video),
    isFamilyFriendly: false,
    inLanguage: 'en',
    publisher: { '@type': 'Organization', name: SITE_NAME },
  }
}

function headFor(video) {
  const title = `${video.title} — ${SITE_NAME}`
  const description = metaDescription(video)
  const image = absolute(video.thumbnail)
  const url = videoUrlFor(video.id)
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="video.other" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${escapeHtml(video.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(video.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:url" content="${escapeHtml(url)}" />`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd(video)).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ')
}

/**
 * Swap the shell's neutral metadata for a page's own, and add a <base> tag so
 * the relative ./assets URLs keep resolving from nested paths.
 */
function withHead(shell, head) {
  let html = shell
    .replace(/<meta name="robots"[^>]*>\s*/i, '')
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
  if (!/<base\s/i.test(html)) {
    html = html.replace(/<head>/i, `<head>\n    <base href="${basePath}" />`)
  }
  return html.replace(/<\/head>/i, `\n    ${head}\n  </head>`)
}

const NEUTRAL_HEAD = `<title>${SITE_NAME}</title>\n    <meta name="robots" content="noindex, nofollow" />`

/** Bot-published videos, so they get their own page and sitemap entry too. */
async function loadFeed() {
  if (!FEED_URL) return []
  try {
    const response = await fetch(`${FEED_URL}/api/videos`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (!Array.isArray(data?.videos)) throw new Error('unexpected feed shape')
    return data.videos
      .filter((video) => video?.id && (video.streamUrl || video.sourceUrl))
      .map((video) => ({
        id: video.id,
        title: String(video.title || 'Video'),
        thumbnail: video.thumbUrl || 'thumbnails/placeholder.svg',
        duration: video.durationSec
          ? `${Math.floor(video.durationSec / 60)}:${String(video.durationSec % 60).padStart(2, '0')}`
          : '',
        category: video.category || 'Homemade',
        description: video.description || '',
        addedAt: new Date(video.createdAt || Date.now()).toISOString().slice(0, 10),
        videoUrl: video.streamUrl || video.sourceUrl,
      }))
  } catch (error) {
    console.warn(`⚠️  Could not read the Telegram feed at build time (${error?.message || error}); continuing with the committed catalogue.`)
    return []
  }
}

async function main() {
  const shell = await readFile(join(dist, 'index.html'), 'utf8')
  const catalogue = await loadCatalogue()
  const feedVideos = await loadFeed()

  const videos = []
  const seen = new Set()
  for (const video of [...catalogue, ...feedVideos]) {
    const id = String(video?.id || '')
    if (!ID_PATTERN.test(id)) {
      console.warn(`⚠️  Skipping video with an unusable id: ${JSON.stringify(video?.id)}`)
      continue
    }
    if (seen.has(id) || !video.title) continue
    seen.add(id)
    videos.push(video)
  }

  for (const video of videos) {
    const dir = join(dist, 'v', video.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'index.html'), withHead(shell, headFor(video)), 'utf8')
  }

  // The owner dashboard gets its own file so /admin/ is a 200, not a 404.
  await mkdir(join(dist, 'admin'), { recursive: true })
  await writeFile(
    join(dist, 'admin', 'index.html'),
    withHead(shell, `<title>${SITE_NAME} — dashboard</title>\n    <meta name="robots" content="noindex, nofollow" />`),
    'utf8',
  )

  const urls = videos
    .map(
      (video) =>
        `  <url>\n    <loc>${escapeXml(videoUrlFor(video.id))}</loc>\n    <lastmod>${isoDate(video.addedAt).slice(0, 10)}</lastmod>\n  </url>`,
    )
    .join('\n')
  await writeFile(
    join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    'utf8',
  )

  await writeFile(
    join(dist, 'robots.txt'),
    ['User-agent: *', 'Allow: /', '', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n'),
    'utf8',
  )

  // Catalogue shell + unknown-path fallback: neutral, noindex, no video list.
  await writeFile(join(dist, 'index.html'), withHead(shell, NEUTRAL_HEAD), 'utf8')
  await writeFile(join(dist, '404.html'), withHead(shell, NEUTRAL_HEAD), 'utf8')

  console.log(
    `✓ prerendered ${videos.length} video page(s), admin page, sitemap.xml (${videos.length} URL${videos.length === 1 ? '' : 's'}) and robots.txt for ${SITE_URL}`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
