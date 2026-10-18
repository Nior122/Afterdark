export type EmbedKind = 'youtube' | 'vimeo' | 'telegram' | 'embed' | 'file' | 'page' | 'none'

export interface ResolvedSource {
  kind: EmbedKind
  src: string
  poster?: string
}

const FILE_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i

/** URLs that are explicitly built to be iframed, e.g. /embed/<id> or player.example.com. */
const EMBED_PATH = /\/(?:embed|e|player)(?:\/|$)/i

/** Extract a YouTube video id from any common URL shape. */
export function youTubeId(url: string): string | null {
  try {
    const u = new URL(url.trim())
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      const match = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
      if (match) return match[1]
    }
    return null
  } catch {
    return null
  }
}

export interface TelegramPost {
  channel: string
  messageId: string
  postPath: string
  embedSrc: string
}

const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me', 'telegram.dog'])
const TELEGRAM_RESERVED = new Set([
  'addemoji',
  'addlist',
  'addstickers',
  'addtheme',
  'boost',
  'c',
  'confirmphone',
  'contact',
  'giftcode',
  'iv',
  'joinchat',
  'login',
  'm',
  'proxy',
  'setlanguage',
  'share',
  'socks',
])

/**
 * Extract a public Telegram post from a `t.me/<channel>/<message>` link.
 * Private `/c/…` posts and invite links are intentionally rejected: they do
 * not expose Telegram's public post embed to anonymous website visitors.
 */
export function telegramPost(url: string): TelegramPost | null {
  try {
    const u = new URL(url.trim())
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    if (!TELEGRAM_HOSTS.has(host)) return null

    const segments = u.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment)
        } catch {
          return segment
        }
      })

    // `/s/<channel>/<message>` is the public web-preview shape of the same post.
    const postSegments = segments[0]?.toLowerCase() === 's' ? segments.slice(1) : segments
    const [channel, messageId] = postSegments
    if (!channel || !messageId) return null
    if (TELEGRAM_RESERVED.has(channel.toLowerCase()) || channel.startsWith('+')) return null
    if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(channel) || !/^\d+$/.test(messageId)) return null

    const postPath = `${channel}/${messageId}`
    return {
      channel,
      messageId,
      postPath,
      embedSrc: `https://t.me/${postPath}?embed=1&userpic=false&single=1&dark=1`,
    }
  } catch {
    return null
  }
}

/** Turn a pasted URL into something we can render in a player. */
export function resolveSource(url?: string): ResolvedSource {
  if (!url || !url.trim()) return { kind: 'none', src: '' }
  const raw = url.trim()

  const yt = youTubeId(raw)
  if (yt) {
    return {
      kind: 'youtube',
      src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&autoplay=1`,
      poster: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    }
  }

  const telegram = telegramPost(raw)
  if (telegram) return { kind: 'telegram', src: telegram.embedSrc }

  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop()
      if (id) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${id}` }
    }
    if (FILE_EXT.test(u.pathname)) return { kind: 'file', src: raw }
    if (EMBED_PATH.test(u.pathname) || host.startsWith('embed.') || host.startsWith('player.')) {
      return { kind: 'embed', src: raw }
    }
    return { kind: 'page', src: raw }
  } catch {
    if (FILE_EXT.test(raw)) return { kind: 'file', src: raw }
    return { kind: 'none', src: '' }
  }
}

/** Best-effort thumbnail guess for a pasted video URL. */
export function guessThumbnail(url: string): string | undefined {
  const yt = youTubeId(url)
  if (yt) return `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`
  return undefined
}

/**
 * Best-effort poster lookup for a public Telegram post. Browsers cannot read
 * t.me pages cross-origin (no CORS headers), so this asks the Microlink
 * metadata API for the post's Open Graph image — for video posts Telegram
 * sets that to the actual video thumbnail served by its CDN. Returns
 * undefined when unavailable; callers fall back to the placeholder artwork.
 * Only the image URL is kept — nothing is downloaded or stored by the site.
 */
export async function fetchTelegramPoster(url: string): Promise<string | undefined> {
  const post = telegramPost(url)
  if (!post) return undefined
  try {
    const api = `https://api.microlink.io/?url=${encodeURIComponent(`https://t.me/${post.postPath}`)}`
    const response = await fetch(api)
    if (!response.ok) return undefined
    const data = (await response.json()) as { data?: { image?: { url?: string } } }
    const image = data.data?.image?.url
    return image && /^https:\/\//i.test(image) ? image : undefined
  } catch {
    return undefined
  }
}

const UNITS = [
  { limit: 1e9, suffix: 'B' },
  { limit: 1e6, suffix: 'M' },
  { limit: 1e3, suffix: 'K' },
]

export function formatCount(n: number): string {
  for (const { limit, suffix } of UNITS) {
    if (n >= limit) {
      const value = n / limit
      return `${value >= 10 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')}${suffix}`
    }
  }
  return String(n)
}

export function formatViews(views: number): string {
  return `${formatCount(views)} views`
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000))
  const steps: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.348, 'week'],
    [12, 'month'],
    [Infinity, 'year'],
  ]
  let value = seconds
  for (const [step, name] of steps) {
    if (value < step) {
      const rounded = Math.floor(value)
      return `${rounded} ${name}${rounded === 1 ? '' : 's'} ago`
    }
    value /= step
  }
  return 'just now'
}

export function parseDuration(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^\d{1,2}(:\d{2}){1,2}$/.test(trimmed)) {
    return trimmed
      .split(':')
      .map((part) => String(Number(part)).padStart(2, '0'))
      .join(':')
      .replace(/^0(?=\d:)/, '')
  }
  if (/^\d+$/.test(trimmed)) {
    const total = Number(trimmed)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`
  }
  return null
}

