/**
 * Build-time preview cards — the image a chat app shows when a link is pasted.
 *
 * Why this file exists: a preview is only drawn BIG by WhatsApp, Telegram and
 * friends when the image itself is big and at least roughly 300×200. Below that
 * the apps drop the card to a small square thumb beside the text — which is
 * exactly what a clip coming from Telegram looks like: its video thumbnail is
 * pinned at 180×320, and the Bot API has no larger one for a video. The site's
 * grid also wants that small file, so nothing is fixed by resizing there.
 *
 * So the build composes each poster into a real card once, writes it next to the
 * pages and points `og:image` (and the sitemap's image) at it. The layout is the
 * "blurred pad" one tube sites and social platforms use: the whole frame stays
 * visible — nothing important is cropped — on a background made of the same
 * frame blown up, blurred and dimmed, so it reads as one picture, not black bars.
 *
 * The canvas follows the clip, because that is what decides how large the frame
 * looks inside the fixed-width card a chat app draws:
 *
 *   landscape / square source → 1200×630 (the ratio the apps reserve for a card)
 *   vertical source           → 1000×1000 (a tall card gets cropped by the apps;
 *                               a square shows ~2.5× more of the clip than 16:9)
 *
 * The title is NOT burned in: the apps put `og:title` under the image themselves,
 * which is where it belongs.
 *
 * `sharp` is an OPTIONAL dependency: if it is not installed (or cannot install on
 * the build host) the whole step is skipped, every page keeps its plain poster URL
 * and claims no dimensions. A missing nicety must never fail a deploy.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Widescreen card: the ratio WhatsApp/Telegram/Facebook reserve for a preview. */
export const WIDE_WIDTH = 1200
export const WIDE_HEIGHT = 630
/** Square card for vertical clips: biggest frame the apps will show uncropped. */
export const SQUARE_SIZE = 1000
/** Keep the file small: crawlers fetch it for every shared link. */
export const MAX_BYTES = 220_000
/** Below this in either edge, chat apps stop drawing the image large. */
export const MIN_CARD_EDGE = 300

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{2,}$/

/** sharp is a native optional dependency — resolve it once, tolerate its absence. */
export async function loadSharp() {
  try {
    const module = await import('sharp')
    return module.default || module
  } catch {
    return null
  }
}

/** Absolute http(s)/data URL a poster can be fetched from at build time. */
function fetchable(url) {
  const raw = String(url || '')
  return /^https?:\/\//i.test(raw) || /^data:image\//i.test(raw)
}

/** Which canvas this poster should be laid out on, and its edges. */
export function cardCanvasFor(width, height) {
  return width > height ? { width: WIDE_WIDTH, height: WIDE_HEIGHT } : { width: SQUARE_SIZE, height: SQUARE_SIZE }
}

/**
 * One poster → one card. Returns `{ bytes, width, height }`, or null when the
 * bytes are not a readable image: the caller then leaves that video's metadata on
 * its poster, which is honest and still previews — just smaller.
 */
export async function composeCard(sharp, bytes) {
  if (!bytes || !bytes.length) return null
  const meta = await sharp(bytes).metadata().catch(() => null)
  if (!meta || !meta.width || !meta.height) return null
  const { width, height } = cardCanvasFor(meta.width, meta.height)
  const background = { r: 12, g: 9, b: 14 } // the site's ink, so the pad is on-brand
  const base = sharp(bytes)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .blur(24)
    .modulate({ brightness: 0.55 })
  // The frame itself, uncropped and centred; `inside` keeps its aspect ratio. The
  // light sharpen is what keeps a 4x upscale from looking like a watercolour.
  const foreground = await sharp(bytes)
    .resize(width, height, { fit: 'inside' })
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer()
  const composed = base.composite([{ input: foreground, gravity: 'centre' }]).flatten({ background })
  let out = await composed.jpeg({ quality: 78, progressive: true }).toBuffer()
  if (out.length > MAX_BYTES) out = await composed.jpeg({ quality: 60, progressive: true }).toBuffer()
  if (out.length > MAX_BYTES) out = await composed.resize(Math.round(width * 0.75), Math.round(height * 0.75), { fit: 'inside' }).jpeg({ quality: 58, progressive: true }).toBuffer()
  const finalMeta = await sharp(out).metadata()
  return { bytes: out, width: finalMeta.width, height: finalMeta.height }
}

/**
 * Writes `dist/previews/<id>.jpg` for every video whose poster can be read and
 * returns `id → { path, width, height }` for the metadata to point at. The path is
 * site-relative on purpose: it follows whatever origin the page is served from.
 *
 * `concurrency` is small because the posters are other people's servers: a build
 * that hammers them looks like an attack, and gets blocked.
 */
export async function buildPreviewCards({
  sharp: sharpLib,
  videos,
  outDir,
  publicDir = '/previews',
  fetchImpl = fetch,
  concurrency = 3,
  timeoutMs = 8_000,
  deadlineMs = 90_000,
  log = () => {},
} = {}) {
  const covers = new Map()
  const stats = { made: 0, skipped: 0 }
  const sharp = sharpLib || (await loadSharp())
  if (!sharp) {
    stats.skipped = videos.length
    log('sharp is not installed — video previews keep using the source poster')
    return { covers, ...stats }
  }

  await mkdir(outDir, { recursive: true })
  const queue = videos.filter((video) => SAFE_ID.test(String(video?.id || '')) && fetchable(video.thumbnail))
  stats.skipped += videos.length - queue.length

  // A build must never be held hostage by somebody else's image host: past the
  // deadline the rest are skipped and the pages keep their posters. Cloudflare
  // Pages and the GitHub workflow both fail a deploy that runs too long, and a
  // missing nicety is not worth a site that stops updating.
  const deadline = Date.now() + deadlineMs
  let timedOut = 0
  let cursor = 0
  async function worker() {
    while (cursor < queue.length) {
      if (Date.now() > deadline) {
        timedOut += 1
        stats.skipped += queue.length - cursor
        cursor = queue.length
        log('preview cards stopped early: the build deadline was reached')
        return
      }
      const video = queue[cursor++]
      const id = String(video.id)
      try {
        const response = await fetchImpl(video.thumbnail, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Accept: 'image/*', 'User-Agent': 'afterdark-build' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        const card = await composeCard(sharp, bytes)
        if (!card) throw new Error('not a readable image')
        await writeFile(join(outDir, `${id}.jpg`), card.bytes)
        covers.set(id, { path: `${publicDir}/${id}.jpg`, width: card.width, height: card.height })
        stats.made += 1
      } catch (error) {
        stats.skipped += 1
        log(`preview card skipped for ${id}: ${error && error.message ? error.message : error}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, worker))
  if (timedOut) stats.timedOut = true
  return { covers, ...stats }
}
