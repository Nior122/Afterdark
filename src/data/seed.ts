import { asset } from '../lib/asset'
export interface Channel {
  id: string
  name: string
  avatar: string
  verified: boolean
  subscribers: string
}

export interface Video {
  id: string
  title: string
  thumbnail: string
  duration: string
  views: string
  publishedAt: string
  channelId: string
  category: string
  /** Raw URL supplied by the user. Empty for seeded/demo videos. */
  videoUrl?: string
  /** Site-side description. Link-only imports whose source has none say so here. */
  description?: string
  /** Searchable tags/keywords, rendered as chips on the watch page. */
  tags?: string[]
  /**
   * Render the embed behind a click shield (poster facade + shielded
   * title-bar link + sandbox without top-navigation/popups) and hide the
   * raw source URL, so viewers cannot click through to the original site.
   */
  protectedEmbed?: boolean
  isAd?: boolean
  adHeadline?: string
}

export interface Ad extends Video {
  isAd: true
  sponsor: string
  advertiser: string
  adHeadline: string
}

export const AVATARS = {
  user: asset("/avatars/user.jpg"),
} as const

export const CHANNELS: Channel[] = [
  { id: 'pov-central', name: 'POV Central', avatar: asset("/avatars/pulse.svg"), verified: true, subscribers: '8.4K' },
  { id: 'you', name: 'You', avatar: AVATARS.user, verified: false, subscribers: '0' },
]

export const CHANNEL_MAP: Record<string, Channel> = Object.fromEntries(
  CHANNELS.map((c) => [c.id, c]),
)

/** No sponsor/advertiser channels on this adult catalogue. */
export const ADVERTISERS: Channel[] = []

export const ALL_CHANNELS: Channel[] = [...CHANNELS, ...ADVERTISERS]
export const ALL_CHANNEL_MAP: Record<string, Channel> = Object.fromEntries(
  ALL_CHANNELS.map((c) => [c.id, c]),
)

/** Adult-site category taxonomy. `All` is the home feed, not a video category. */
export const CATEGORIES = [
  'All',
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

/** Encoded browse route for a category, including names with spaces. */
export function browsePath(category: string): string {
  return category === 'All' ? '/' : `/browse/${encodeURIComponent(category)}`
}

/**
 * A video belongs to a browse category when its primary category matches,
 * or when one of its source categories/tags matches. This lets the single
 * `POV` catalogue videos also appear under e.g. MILF, Latina or Blowjob.
 */
export function videoMatchesCategory(
  video: Pick<Video, 'category' | 'tags'>,
  category: string,
): boolean {
  const needle = category.trim().toLowerCase()
  if (!needle || needle === 'all') return true
  return (
    video.category.toLowerCase() === needle ||
    (video.tags?.some((tag) => tag.trim().toLowerCase() === needle) ?? false)
  )
}

/** No ad/demo videos: the catalogue contains only the curated videos below. */
export const RECOMMENDED_ADS: Ad[] = []

export const TRENDING_ADS: Ad[] = []

export const SEED_VIDEOS: Video[] = [
  // --- Link-only imports (embed URL + remote thumbnail + metadata only, no files stored) ---
  {
    id: 'v-telegram-twerking-aunty',
    title: 'Twerking Aunty',
    thumbnail:
      'https://cdn4.telesco.pe/file/cXcslCvdElEiVY8r9F7DrBSzOABHsWuTWLdv21LdXVGRG-LoQPvmAzM2IO9ef9ugkLykWQWsG0K-x-5WwR-ct2gS-75fnwmjdNT-Upz4QKweba5kyU7mh1u4LcMrxFgK55NIkf8k7wJN3PdbnhS_dJRlniPPgiTcwDgw4l4-bfmkoNsF4tMZCSloak6dFemUsXz39RQdYTOrotEgh4p7b5mRIGG-B0gCY_V4pRQsJ79rgEdaMplFMQq6gaGoHx8p3MdNC4ZegLHSahG07xobEGK_y5AkQhPlPE_mr0i366-r_VClMwo_hNLlZ4lZ2rXYip1wE65CKm0fpnIEyvNB3w',
    duration: '0:54',
    views: '686 views',
    publishedAt: '2 months ago',
    channelId: 'you',
    category: 'Homemade',
    videoUrl: 'https://t.me/leakedvideospage/2269',
    description: 'Homemade · 0:54.',
    tags: ['Homemade', 'Twerking', 'Aunty', 'Telegram'],
    protectedEmbed: true,
  },
  {
    id: 'v-pov-tatum-christine',
    title: 'Tatum Christine - Sister Wants Step Brothers Cock',
    thumbnail: 'https://static-ca-cdn.eporner.com/thumbs/static4/1/17/179/17960055/3_240.jpg',
    duration: '30:10',
    views: '31.9K views',
    publishedAt: '2 months ago',
    channelId: 'pov-central',
    category: 'POV',
    videoUrl: 'https://www.eporner.com/embed/f2gVZh1XTVr/',
    description:
      'POV · 30:10 · 1080p@60fps.\n\nNo description was provided by the source for this video, so this listing was created from its title, length, categories and tags.\n\nCategories: Amateur, Blowjob, Homemade, Toys, ASMR, POV, Brunette, HD Porn 1080p, 60 FPS.',
    tags: [
      'POV',
      'Amateur',
      'Blowjob',
      'Homemade',
      'Toys',
      'ASMR',
      'Brunette',
      'HD Porn 1080p',
      '60 FPS',
      'Tatum Christine',
      'Step sister sex',
      'Step sister fuck',
      'Hentai step sister',
      'Hot step sister',
      'Step sister anal',
      'Nude step sister',
      'Step sister blowjob',
      'Step brothers',
      'Long hair',
    ],
    protectedEmbed: true,
  },
  {
    id: 'v-pov-risky-proposition',
    title: '!! Risky Proposition!! Innocent Hooters Waitress Reveals Her Dirtiest Secrets - Barbie Hard Peru',
    thumbnail: 'https://static-ca-cdn.eporner.com/thumbs/static4/1/16/164/16427995/15_240.jpg',
    duration: '19:33',
    views: '443K views',
    publishedAt: '7 months ago',
    channelId: 'pov-central',
    category: 'POV',
    videoUrl: 'https://www.eporner.com/embed/7ds0OE7OiYv/',
    description:
      'POV · 19:33 · 2160p (4K).\n\nListed by the source as starring: Barbie Hard Peru, Mariah Milano, Sarah Lollypop, Abby Adams.\n\nNo description was provided by the source for this video, so this listing was created from its title, length, categories and tags.\n\nCategories: Cumshot, Big Dick, Big Tits, POV, Brunette, Big Ass, Latina, Pornstar, 4K Ultra HD.',
    tags: [
      'POV',
      'Cumshot',
      'Big Dick',
      'Big Tits',
      'Brunette',
      'Big Ass',
      'Latina',
      'Pornstar',
      '4K Ultra HD',
      'Barbie Hard Peru',
      'Mariah Milano',
      'Sarah Lollypop',
      'Abby Adams',
      'Fuck her hard',
      'Her',
      'Hard',
      'Fucking her hard',
      'Barbie',
      'Hooters',
      'Waitress',
      'Innocent',
      'Hclips',
    ],
    protectedEmbed: true,
  },
  {
    id: 'v-pov-kat-mar10',
    title: 'POV MILF Slut With Huge Watermelons Takes On A Huge Cock [Kat Mar10]',
    thumbnail: 'https://static-ca-cdn.eporner.com/thumbs/static4/1/18/186/18662143/9_240.jpg',
    duration: '30:59',
    views: '7.5K views',
    publishedAt: '5 days ago',
    channelId: 'pov-central',
    category: 'POV',
    videoUrl: 'https://www.eporner.com/embed/xnMiRJxFbXE/',
    description:
      'POV · 30:59 · 1440p (2K).\n\nNo description was provided by the source for this video, so this listing was created from its title, length, categories and tags.\n\nCategories: Blowjob, Homemade, Mature, Housewives, Big Tits, POV, Brunette, Big Ass, MILF, 4K Ultra HD, Hotwife.',
    tags: [
      'POV',
      'Blowjob',
      'Homemade',
      'Mature',
      'Housewives',
      'Big Tits',
      'Brunette',
      'Big Ass',
      'MILF',
      '4K Ultra HD',
      'Hotwife',
      'Kat Mar10',
      'Pov milf',
      'Huge tits milf',
      'Huge cock',
      'Milf slut',
      'Huge black cock',
      'Milf pov blowjob',
      'Huge white cock',
    ],
    protectedEmbed: true,
  },
]
