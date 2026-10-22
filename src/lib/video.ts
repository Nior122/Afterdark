export type EmbedKind = 'youtube' | 'vimeo' | 'telegram' | 'embed' | 'file' | 'page' | 'none'

export interface ResolvedSource {
  kind: EmbedKind
  src: string
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

/** Turn a stored source URL into something the page can render. */
export function resolveSource(url?: string): ResolvedSource {
  if (!url || !url.trim()) return { kind: 'none', src: '' }
  const raw = url.trim()

  const yt = youTubeId(raw)
  if (yt) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0` }

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

/** `8:31` / `523` -> ISO 8601 duration (`PT8M31S`), for schema.org. */
export function isoDuration(input?: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw || raw === '—') return null
  const parts = raw.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return null
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0]
  if (!h && !m && !s) return null
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s ? `${s}S` : ''}`
}
