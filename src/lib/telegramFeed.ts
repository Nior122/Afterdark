import { PLACEHOLDER_THUMBNAIL, type Video } from '../data/seed'

/**
 * Optional Telegram bot feed.
 *
 * When `VITE_TELEGRAM_FEED_URL` points at the bot Worker (worker/worker.js,
 * see docs/telegram-bot-setup.md), videos the owner forwards to the bot are
 * fetched from its public `/api/videos` feed. Playback streams through the
 * Worker's proxy (`…/stream.mp4`, which the URL resolver treats as a native
 * file), so the bot token and raw Telegram file links never reach the browser.
 * With the variable unset (default) this resolves to an empty list.
 *
 * Feed videos are playable by direct link straight away. To have them
 * prerendered and listed in sitemap.xml they must be present at build time —
 * the build fetches the same feed (scripts/prerender.mjs) when this variable
 * is set, so a normal redeploy indexes them.
 */

interface FeedVideo {
  id: string
  title?: string
  category?: string
  tags?: string[]
  durationSec?: number
  createdAt?: number
  streamUrl?: string
  thumbUrl?: string | null
}

const FEED_BASE = (import.meta.env.VITE_TELEGRAM_FEED_URL as string | undefined)?.replace(
  /\/+$/,
  '',
)

function formatDurationSec(totalSec?: number): string {
  const s = Math.max(0, Math.round(totalSec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

function isoDate(timestamp?: number): string {
  const date = new Date(timestamp || Date.now())
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10)
}

function mapFeedVideo(video: FeedVideo): Video {
  const duration = formatDurationSec(video.durationSec)
  const category = video.category && video.category !== 'All' ? video.category : 'Homemade'
  return {
    id: video.id,
    title: video.title?.trim() || 'Telegram video',
    thumbnail: video.thumbUrl || PLACEHOLDER_THUMBNAIL,
    duration,
    views: '',
    addedAt: isoDate(video.createdAt),
    category,
    videoUrl: video.streamUrl,
    description: `${category} · ${duration}. Published through the Telegram bot.`,
    tags: video.tags?.length ? video.tags : [category, 'Telegram'],
  }
}

export async function fetchTelegramFeed(): Promise<Video[]> {
  if (!FEED_BASE) return []
  try {
    const response = await fetch(`${FEED_BASE}/api/videos`)
    if (!response.ok) return []
    const data = (await response.json()) as { videos?: FeedVideo[] }
    if (!Array.isArray(data.videos)) return []
    return data.videos.filter((video) => video?.id && video.streamUrl).map(mapFeedVideo)
  } catch {
    return []
  }
}
