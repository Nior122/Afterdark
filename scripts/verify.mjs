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
import { readFile } from 'node:fs/promises'
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

console.log('— root, admin and unknown paths')
for (const name of ['index.html', '404.html', 'admin/index.html']) {
  const html = await read(name)
  check(`${name} is noindex`, /<meta name="robots" content="noindex/.test(html))
  check(`${name} lists no videos`, !videos.some((video) => html.includes(video.id) || html.includes(video.title)))
  check(`${name} has no internal links`, !/<a\s[^>]*href="\/(?!\/)/i.test(html))
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

console.log('— summary')
check(`all ${videos.length} video pages prerendered`, pages === videos.length, `${pages} page(s)`)
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed (${pages} video page(s))`)
process.exit(failures ? 1 : 0)
