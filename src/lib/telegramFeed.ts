import { CATEGORIES, type Video } from '../data/seed'
import { asset } from './asset'
import { channelForVideo } from './uploader'
import { deriveViews } from './stats'
import { timeAgo } from './video'

/**
 * Optional Telegram bot feed.
 *
 * When `VITE_TELEGRAM_FEED_URL` points at the bot Worker (worker/worker.js,
 * see docs/telegram-bot-setup.md), videos the owner forwards to the bot are
 * fetched from its public `/api/videos` feed and merged into the catalogue.
 * Playback streams through the Worker's proxy (`.../stream.mp4`, which the
 * URL resolver treats as a native file), so the bot token and raw Telegram
 * file links never reach the browser. With the variable unset (default),
 * this resolves to an empty list and the site behaves exactly as before.
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

function mapFeedVideo(v: FeedVideo): Video {
  const declaredCategory =
    v.category && v.category !== 'All' && (CATEGORIES as readonly string[]).includes(v.category)
      ? v.category
      : undefined
  const duration = formatDurationSec(v.durationSec)
  // When the bot did not tag a category, inherit the assigned channel's niche
  // so the listing lands in the right browse row. channelForVideo is a pure
  // hash of the id, so this is stable across reloads.
  const category =
    declaredCategory ??
    channelForVideo({ id: v.id, channelId: '', category: '' }).category
  return {
    id: v.id,
    title: v.title?.trim() || 'Telegram video',
    thumbnail: v.thumbUrl || asset('/thumbnails/placeholder.svg'),
    duration,
    views: deriveViews(v.id, v.createdAt),
    publishedAt: v.createdAt ? timeAgo(v.createdAt) : 'Just now',
    channelId: '',
    category,
    videoUrl: v.streamUrl,
    description: `${category} · ${duration}.`,
    tags: v.tags?.length ? v.tags : [category, 'Telegram'],
  }
}

export async function fetchTelegramFeed(): Promise<Video[]> {
  if (!FEED_BASE) return []
  try {
    const response = await fetch(`${FEED_BASE}/api/videos`)
    if (!response.ok) return []
    const data = (await response.json()) as { videos?: FeedVideo[] }
    if (!Array.isArray(data.videos)) return []
    return data.videos.filter((v) => v?.id && v.streamUrl).map(mapFeedVideo)
  } catch {
    return []
  }
}
