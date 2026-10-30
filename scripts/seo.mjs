/**
 * Shared SEO primitives for AfterDark.
 *
 * Two consumers, deliberately the ONLY source of page metadata:
 *   • scripts/prerender.mjs  — build time: writes one static page per video,
 *     the sitemap and robots.txt into dist/.
 *   • functions/_middleware.ts — request time on Cloudflare Pages: a video
 *     published AFTER the last build has no prerendered file, so the
 *     middleware builds the same head from the live feed and injects it.
 *     Indexable immediately; no rebuild race.
 *
 * Pure string/data functions only — no node APIs, no DOM.
 */

export const SITE_NAME = 'AfterDark'
/** Stable fallback so repeated builds don't churn every <lastmod>. */
export const LAUNCH_DATE = '2026-01-01'
const MAX_DESCRIPTION = 158

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const escapeXml = escapeHtml

export const absoluteUrl = (siteUrl, path) => {
  if (!path) return `${siteUrl}/thumbnails/placeholder.svg`
  if (/^https?:\/\//i.test(path)) return path
  return `${siteUrl}/${String(path).replace(/^(\.\/)+/, '').replace(/^\/+/, '')}`
}

export const videoPageUrl = (siteUrl, id) =>
  `${siteUrl.replace(/\/+$/, '')}/v/${encodeURIComponent(id)}/`

export function isoDate(addedAt) {
  const raw = String(addedAt || '').trim()
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw || LAUNCH_DATE)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export function metaDescription(video) {
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
export function sourceOf(url) {
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

export function playerUrls(video) {
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

export function isoDuration(duration) {
  const parts = String(duration || '').split(':').map(Number)
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return undefined
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0]
  if (!h && !m && !s) return undefined
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s ? `${s}S` : ''}`
}

export function videoJsonLd(siteUrl, video) {
  const duration = isoDuration(video.duration)
  const views = Number(video.views)
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: metaDescription(video),
    thumbnailUrl: [absoluteUrl(siteUrl, video.thumbnail)],
    uploadDate: isoDate(video.updatedAt || video.addedAt),
    url: videoPageUrl(siteUrl, video.id),
    ...(duration ? { duration } : {}),
    ...playerUrls(video),
    isFamilyFriendly: false,
    inLanguage: 'en',
    ...(Number.isFinite(views) && views > 0
      ? {
          interactionStatistic: {
            '@type': 'InteractionCounter',
            interactionType: 'https://schema.org/WatchAction',
            userInteractionCount: views,
          },
        }
      : {}),
    publisher: { '@type': 'Organization', name: SITE_NAME },
  }
}

/**
 * The per-video <head> block. `verification` (a GSC token) lands on every page
 * so any URL-prefix property verifies, whatever URL the crawler opens.
 */
export function buildHead(siteUrl, video, { verification = '' } = {}) {
  const title = `${video.title} — ${SITE_NAME}`
  const description = metaDescription(video)
  const image = absoluteUrl(siteUrl, video.thumbnail)
  const url = videoPageUrl(siteUrl, video.id)
  const jsonLd = JSON.stringify(videoJsonLd(siteUrl, video)).replace(/</g, '\\u003c')
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
    ...(verification ? [`<meta name="google-site-verification" content="${escapeHtml(verification)}" />`] : []),
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join('\n    ')
}

/**
 * Swap the shell's neutral metadata for a page's own, and add a <base> tag so
 * the relative ./assets URLs keep resolving from nested paths.
 */
export function applyHead(shell, head, { basePath = '/', preconnect = '' } = {}) {
  let html = shell
    .replace(/<meta name="robots"[^>]*>\s*/i, '')
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
  if (!/<base\s/i.test(html)) {
    html = html.replace(/<head>/i, `<head>\n    <base href="${basePath}" />`)
  }
  if (preconnect && !/rel=["']preconnect/i.test(html)) {
    html = html.replace(/<\/head>/i, `    ${preconnect}\n  </head>`)
  }
  return html.replace(/<\/head>/i, `\n    ${head}\n  </head>`)
}

/**
 * sitemap.xml with the Google image extension — every video page carries its
 * poster so Image Search can attribute it, and <lastmod> follows the newest
 * of (updated, added) so re-titles/re-posters refresh the crawl signal.
 */
export function sitemapXml(siteUrl, videos) {
  const entries = videos.map((video) => {
    const thumb = absoluteUrl(siteUrl, video.thumbnail)
    return [
      '  <url>',
      `    <loc>${escapeXml(videoPageUrl(siteUrl, video.id))}</loc>`,
      `    <lastmod>${isoDate(video.updatedAt || video.addedAt).slice(0, 10)}</lastmod>`,
      video.thumbnail
        ? '    <image:image>\n'
          + `      <image:loc>${escapeXml(thumb)}</image:loc>\n`
          + `      <image:title>${escapeXml(video.title)}</image:title>\n`
          + '    </image:image>'
        : '',
      '  </url>',
    ].filter(Boolean).join('\n')
  }).join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    entries,
    '</urlset>',
    '',
  ].join('\n')
}

export function robotsTxt(siteUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    '',
    `Sitemap: ${siteUrl.replace(/\/+$/, '')}/sitemap.xml`,
    '',
  ].join('\n')
}

/**
 * Map one Worker-feed item (`GET /api/videos`) into the SEO video shape.
 * Kept as a function so the build and the Pages middleware derive the exact
 * same page for the same record.
 */
export function feedToSeoVideo(v) {
  if (!v || !v.id || !(v.streamUrl || v.sourceUrl)) return null
  return {
    id: String(v.id),
    title: String(v.title || 'Video'),
    thumbnail: v.thumbUrl || '',
    duration: v.durationSec
      ? `${Math.floor(v.durationSec / 60)}:${String(v.durationSec % 60).padStart(2, '0')}`
      : '',
    category: v.category || 'Homemade',
    description: v.description || '',
    addedAt: new Date(v.createdAt || Date.now()).toISOString().slice(0, 10),
    updatedAt: v.updatedAt || null,
    views: Number(v.views) || 0,
    videoUrl: v.streamUrl || v.sourceUrl,
  }
}
