import type { Video } from '../data/seed'
import { absoluteUrl, SITE_NAME, videoUrl } from './site'
import { resolveSource } from './video'

/**
 * Per-video document metadata.
 *
 * Prerendered `/v/<id>/` pages already carry these tags (scripts/prerender.mjs
 * writes them at build time). This module re-applies them in the browser so a
 * page reached another way (dev server, a link added after the build) is still
 * correct, and so the neutral fallback page can drop them again.
 */

const OG_LOCALE = 'en_US'

function longDate(addedAt?: string): string {
  const value = addedAt?.trim()
  // Feed videos carry their publish date; anything else falls back to today so
  // the required `uploadDate` is always a valid ISO timestamp.
  const parsed = value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value) : new Date()
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

/** One-line, unique description built from the title plus the short summary. */
export function metaDescriptionFor(video: Video): string {
  const summary = (video.description ?? '')
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .trim()
  const base = summary
    ? `Watch “${video.title}” on ${SITE_NAME}.`
    : `Watch “${video.title}” on ${SITE_NAME}${video.category ? ` — ${video.category}` : ''}.`
  const text = summary ? `${base} ${summary}` : base
  return text.length > 158 ? `${text.slice(0, 155).trimEnd()}…` : text
}

export function pageTitleFor(video: Video): string {
  return `${video.title} — ${SITE_NAME}`
}

/** schema.org VideoObject for a video, as a plain object. */
export function videoJsonLd(video: Video): Record<string, unknown> {
  const image = absoluteUrl(video.thumbnail)
  const pageUrl = videoUrl(video.id)
  const source = resolveSource(video.videoUrl)
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: metaDescriptionFor(video),
    thumbnailUrl: [image],
    uploadDate: longDate(video.addedAt),
    url: pageUrl,
    isFamilyFriendly: false,
    inLanguage: 'en',
    publisher: { '@type': 'Organization', name: SITE_NAME },
  }
  if (source.kind === 'file') data.contentUrl = source.src
  else if (source.src) data.embedUrl = source.src
  return data
}

function upsertMeta(attribute: 'name' | 'property', key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
}

function removeMeta(attribute: 'name' | 'property', key: string): void {
  document.head.querySelector(`meta[${attribute}="${key}"]`)?.remove()
}

function upsertCanonical(href: string): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = href
}

function upsertJsonLd(video: Video): void {
  let script = document.head.querySelector<HTMLScriptElement>('script[type="application/ld+json"]')
  if (!script) {
    script = document.createElement('script')
    script.type = 'application/ld+json'
    document.head.appendChild(script)
  }
  script.textContent = JSON.stringify(videoJsonLd(video))
}

export function applyVideoMeta(video: Video): void {
  const title = pageTitleFor(video)
  const description = metaDescriptionFor(video)
  const image = absoluteUrl(video.thumbnail)
  const canonical = videoUrl(video.id)

  document.title = title
  upsertMeta('name', 'description', description)
  upsertMeta('name', 'robots', 'index, follow')
  upsertCanonical(canonical)

  upsertMeta('property', 'og:type', 'video.other')
  upsertMeta('property', 'og:site_name', SITE_NAME)
  upsertMeta('property', 'og:locale', OG_LOCALE)
  upsertMeta('property', 'og:title', video.title)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:image', image)
  upsertMeta('property', 'og:url', canonical)

  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', video.title)
  upsertMeta('name', 'twitter:description', description)
  upsertMeta('name', 'twitter:image', image)
  upsertMeta('name', 'twitter:url', canonical)

  upsertJsonLd(video)
}

/** Neutral page: no indexable content, nothing pointing at a video. */
export function applyNeutralMeta(): void {
  document.title = SITE_NAME
  upsertMeta('name', 'description', `${SITE_NAME} — this page does not exist.`)
  upsertMeta('name', 'robots', 'noindex, nofollow')
  document.head.querySelector('link[rel="canonical"]')?.remove()
  for (const [attribute, key] of [
    ['property', 'og:type'],
    ['property', 'og:title'],
    ['property', 'og:description'],
    ['property', 'og:image'],
    ['property', 'og:url'],
    ['name', 'twitter:card'],
    ['name', 'twitter:title'],
    ['name', 'twitter:description'],
    ['name', 'twitter:image'],
    ['name', 'twitter:url'],
  ] as const) {
    removeMeta(attribute, key)
  }
  document.head.querySelector('script[type="application/ld+json"]')?.remove()
}
