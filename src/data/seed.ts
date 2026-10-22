import catalogue from './videos.json'

/**
 * A single link-only video.
 *
 * Nothing is hosted or stored: `videoUrl` is the source (a public Telegram
 * post, an embed URL, or a direct file URL) and `thumbnail` is a remote poster
 * URL. The only locally generated asset is the neutral placeholder below.
 */
export interface Video {
  /** Public, non-guessable id — the `/v/<id>/` segment. */
  id: string
  title: string
  /** Remote poster URL. Empty string means "use the local placeholder". */
  thumbnail: string
  duration: string
  views: string
  /** Date the video was added (YYYY-MM-DD). Used as the sitemap <lastmod>. */
  addedAt: string
  category: string
  /** The source URL. Never rendered as a link; only passed to the player. */
  videoUrl?: string
  description?: string
  tags?: string[]
  /** Render third-party embeds behind the click shield (see EmbedPlayer). */
  protectedEmbed?: boolean
}

/** Adult-site category taxonomy, kept in sync with worker/worker.js. */
export const CATEGORIES = [
  'POV',
  'Amateur',
  'MILF',
  'Blowjob',
  'Big Tits',
  'Big Ass',
  'Latina',
  'Brunette',
  'Pornstar',
  'Hardcore',
  'Anal',
  'Homemade',
  'Mature',
  'Big Dick',
  'Cumshot',
  'Creampie',
  'Threesome',
  'Lesbian',
  'Ebony',
  'Interracial',
  'Hotwife',
  'Webcam',
  'ASMR',
  'Toys',
  '4K Ultra HD',
] as const

/** Local, brand-neutral poster used when a video has no remote thumbnail. */
export const PLACEHOLDER_THUMBNAIL = 'thumbnails/placeholder.svg'

/**
 * The build-time catalogue. Every entry here is prerendered to its own
 * `/v/<id>/` page and listed in `sitemap.xml` by `scripts/prerender.mjs`.
 * Add or remove videos with `node scripts/videos.mjs …` (see README).
 */
export const SEED_VIDEOS: Video[] = (catalogue as Video[]).map((video) => ({
  ...video,
  thumbnail: video.thumbnail?.trim() || PLACEHOLDER_THUMBNAIL,
}))
