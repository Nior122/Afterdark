import { avatarFor, hashString, UPLOADER_AVATARS } from '../lib/avatars'
export interface Channel {
  id: string
  name: string
  avatar: string
  verified: boolean
  /** Display-only fake audience size, pre-formatted ("12.4K"). Not real. */
  subscribers: string
  /** The single browse category this channel publishes into. */
  category: string
}

export interface Video {
  id: string
  title: string
  thumbnail: string
  duration: string
  views: string
  /** Display-only relative age ("2 months ago"), also shown on cards. */
  publishedAt: string
  /** ISO date or timestamp when the video was added — ordering, sitemap and schema uploadDate. */
  addedAt?: string
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
  /**
   * Explicit uploader face, overriding channel attribution. Normally unset: the
   * avatar comes from the video's channel (see `lib/uploader.ts`), which falls
   * back to a pool hash of the video id when no channel resolves.
   */
  avatar?: string
  isAd?: boolean
  adHeadline?: string
  /**
   * The media is taller than wide (vertical phone clips). Cards then frame the
   * thumbnail in portrait and the poster facades letterbox instead of cropping
   * the scene down to a 16:9 band.
   */
  isPortrait?: boolean
}

export interface Ad extends Video {
  isAd: true
  sponsor: string
  advertiser: string
  adHeadline: string
}

/**
 * Channels are the uploader identities of this catalogue. Each one owns a face
 * from the avatar pool, a fake subscriber count and exactly one browse
 * category; every video is attributed to one of the channels that publish in
 * its own category (see `lib/uploader.ts`), so seeded, link-imported and
 * Telegram-fed listings all carry a byline. Attribution is a pure hash of the
 * video id: stable across reloads, identical on every device, nothing stored.
 *
 * The roster carries four channels per category, but only as many as there are
 * faces for go live — see `selectChannelRoster`. That coupling is the whole
 * point: growing `UPLOADER_AVATAR_COUNT` grows the uploader roster with it, and
 * it is structurally impossible to end up with two channels sharing a face.
 *
 * A channel is a navigation target (`/channel/:id`, see `channelPath` and
 * `pages/ChannelPage.tsx`) — but there are still no visitor accounts.
 */
const CHANNEL_ROSTER: ReadonlyArray<readonly [name: string, category: string]> = [
  ['POV Central', 'POV'],
  ['Her Lens POV', 'POV'],
  ['Lens Loaded POV', 'POV'],
  ['First Person Files', 'POV'],
  ['Amateur Diaries', 'Amateur'],
  ['Candid Home Tapes', 'Amateur'],
  ['Backyard Amateur', 'Amateur'],
  ['Unpolished Tapes', 'Amateur'],
  ['MILF Manor', 'MILF'],
  ['Experienced Files', 'MILF'],
  ['Silver Fox Society', 'MILF'],
  ['MILF After Hours', 'MILF'],
  ['Close-Up Club', 'Blowjob'],
  ['Lipstick Lounge', 'Blowjob'],
  ['Slow Build Files', 'Blowjob'],
  ['Mouthwork Monthly', 'Blowjob'],
  ['Heavy Curves TV', 'Big Tits'],
  ['Busty Selects', 'Big Tits'],
  ['Front Row Curves', 'Big Tits'],
  ['Heavy Set Hour', 'Big Tits'],
  ['Bounce Room', 'Big Ass'],
  ['Backrow Files', 'Big Ass'],
  ['Low Angle Files', 'Big Ass'],
  ['Whiplash Room', 'Big Ass'],
  ['Latina Heat', 'Latina'],
  ['Fuego Amateur', 'Latina'],
  ['Caliente Selects', 'Latina'],
  ['Prima Vera POV', 'Latina'],
  ['Dark Hair Daily', 'Brunette'],
  ['Brunette Files', 'Brunette'],
  ['Espresso Files', 'Brunette'],
  ['Quiet Brunette', 'Brunette'],
  ['Star Billing', 'Pornstar'],
  ['Featured Performers', 'Pornstar'],
  ['Marquee Names', 'Pornstar'],
  ['Contract Stars Archive', 'Pornstar'],
  ['Hardcore Hub', 'Hardcore'],
  ['No Limits Club', 'Hardcore'],
  ['Raw Deal Files', 'Hardcore'],
  ['Full Send Club', 'Hardcore'],
  ['Back Door Bureau', 'Anal'],
  ['Prep and Progress', 'Anal'],
  ['Slow Open Files', 'Anal'],
  ['Diligent Prep', 'Anal'],
  ['Kitchen Table Tapes', 'Homemade'],
  ['Bedroom Archive', 'Homemade'],
  ['Phone Camera Club', 'Homemade'],
  ['Off Season Tapes', 'Homemade'],
  ['Mature Attraction', 'Mature'],
  ['Forty Plus Club', 'Mature'],
  ['Seasoned Selections', 'Mature'],
  ['Later In Life', 'Mature'],
  ['Bigger in Person', 'Big Dick'],
  ['Size Matters Files', 'Big Dick'],
  ['Measured Files', 'Big Dick'],
  ['Heavy Traffic POV', 'Big Dick'],
  ['Finish Line Clips', 'Cumshot'],
  ['Last Frame Files', 'Cumshot'],
  ['Final Frame Club', 'Cumshot'],
  ['Overflow Tapes', 'Cumshot'],
  ['Filled Up Files', 'Creampie'],
  ['Inside Job Amateur', 'Creampie'],
  ['Left Inside Files', 'Creampie'],
  ['Warm Room Tapes', 'Creampie'],
  ['Three Deep', 'Threesome'],
  ['Third Person POV', 'Threesome'],
  ['Odd Number Files', 'Threesome'],
  ['Pair Plus One', 'Threesome'],
  ['Girl on Girl', 'Lesbian'],
  ['Two Women Files', 'Lesbian'],
  ['Soft Light Girls', 'Lesbian'],
  ['Her Place Files', 'Lesbian'],
  ['Ebony Elite', 'Ebony'],
  ['Melanin Motion', 'Ebony'],
  ['Onyx Hour', 'Ebony'],
  ['Obsidian Selects', 'Ebony'],
  ['Mixed Company', 'Interracial'],
  ['Cross Over Club', 'Interracial'],
  ['Mixed Signals Files', 'Interracial'],
  ['Blended Lines', 'Interracial'],
  ['Hotwife Handbook', 'Hotwife'],
  ['Shared Keys', 'Hotwife'],
  ['Shared Key Files', 'Hotwife'],
  ['Tuesday Night Arrangements', 'Hotwife'],
  ['Cam Room Replay', 'Webcam'],
  ['Late Night Cams', 'Webcam'],
  ['Tip Jar Tapes', 'Webcam'],
  ['Two AM Streams', 'Webcam'],
  ['Whisper Hours', 'ASMR'],
  ['Soft Spoken Files', 'ASMR'],
  ['Ear To Ear Files', 'ASMR'],
  ['Breath And Whisper', 'ASMR'],
  ['Drawer of Toys', 'Toys'],
  ['Vibe and Click', 'Toys'],
  ['Speed Dial Files', 'Toys'],
  ['Hands Off Club', 'Toys'],
  ['Ultra HD House', '4K Ultra HD'],
  ['Sixty Frames', '4K Ultra HD'],
  ['Pixel Perfect House', '4K Ultra HD'],
  ['Crisp Cuts 4K', '4K Ultra HD'],
]

/** `POV Central` -> `pov-central`. Names are unique, so derived ids are too. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000)
    return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`
  return String(value)
}

/**
 * Fake but plausible audience size, keyed off the channel id so a channel keeps
 * its number for as long as its name does. Log-uniform from ~2K to ~800K: the
 * spread keeps small channels the common case, while the floor stops any
 * listing from showing a three-figure following, which reads as a dead site.
 */
function fakeAudience(id: string): { subscribers: string; value: number } {
  const spread = (hashString(id) >>> 8) % 1000
  const value = Math.round(10 ** (3.3 + (spread / 1000) * 2.6))
  return { value, subscribers: formatCount(value) }
}

/** Channels at or above this follower count carry the verified tick. */
const VERIFIED_AT = 50_000

/** Hard ceiling on channels per category, however many faces exist. */
const CHANNELS_PER_CATEGORY_MAX = 4

const ROSTER_BY_CATEGORY = CHANNEL_ROSTER.reduce(
  (acc, entry) => {
    ;(acc[entry[1]] ??= []).push(entry)
    return acc
  },
  {} as Record<string, Array<readonly [string, string]>>,
)

/**
 * The live slice of the roster: every category gets the same number of
 * channels, as large as the avatar pool can fund without any two channels
 * sharing a face, clamped to 1..4. With 63 faces that is two per category;
 * at 75 it becomes three and at 100 the full four, with no code change.
 *
 * Note the side effect of crossing a boundary: a category going from two live
 * channels to three re-shuffles which channel each video hashes onto, so a few
 * listings move between sibling channels in the same category.
 */
export function selectChannelRoster(
  poolSize: number,
  maxPerCategory: number = CHANNELS_PER_CATEGORY_MAX,
): Array<readonly [string, string]> {
  const categories = Object.keys(ROSTER_BY_CATEGORY).length
  const perCategory = Math.max(1, Math.min(maxPerCategory, Math.floor(Math.max(poolSize, 1) / categories)))
  return Object.values(ROSTER_BY_CATEGORY).flatMap((list) => list.slice(0, perCategory))
}

export const CHANNELS: Channel[] = selectChannelRoster(UPLOADER_AVATARS.length).map(
  ([name, category], index) => {
  const id = slugify(name)
  const audience = fakeAudience(id)
  return {
    id,
    name,
    category,
    // Roster order rather than a hash: the pool is at least as large as the
    // roster, so each channel gets its own face instead of two colliding.
    avatar:
      UPLOADER_AVATARS.length > 0
        ? UPLOADER_AVATARS[index % UPLOADER_AVATARS.length]
        : avatarFor(id),
    verified: audience.value >= VERIFIED_AT,
    subscribers: audience.subscribers,
  }
},
)

export const CHANNEL_MAP: Record<string, Channel> = Object.fromEntries(
  CHANNELS.map((c) => [c.id, c]),
)

/** No sponsor/advertiser channels on this adult catalogue. */
export const ADVERTISERS: Channel[] = []

export const ALL_CHANNELS: Channel[] = [...CHANNELS, ...ADVERTISERS]
export const ALL_CHANNEL_MAP: Record<string, Channel> = Object.fromEntries(
  ALL_CHANNELS.map((c) => [c.id, c]),
)

/** Channels grouped by the category they publish into. */
export const CHANNELS_BY_CATEGORY: Record<string, Channel[]> = CHANNELS.reduce(
  (acc, channel) => {
    ;(acc[channel.category] ??= []).push(channel)
    return acc
  },
  {} as Record<string, Channel[]>,
)

/**
 * Candidate channels for a video category. An unknown or missing category still
 * resolves to a real byline rather than none, so a mis-tagged import can never
 * render an uploader-less card.
 */
export function channelsForCategory(category: string): Channel[] {
  return CHANNELS_BY_CATEGORY[category] ?? ALL_CHANNELS
}

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

/** Canonical link to a channel's own page, where its uploads are collected. */
export function channelPath(channelId: string): string {
  return `/channel/${encodeURIComponent(channelId)}`
}

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
    id: 'v-mzansi-nextdoorstudios-ph5e8cc83e2b2b2',
    title: 'NextDoorStudios – Couple Invites A Third For Raw Threesome',
    thumbnail: 'https://mzansiadultblog.com/wp-content/uploads/2026/08/nextdoorstudios-couple-invites-a-third-for-raw-threesome.jpg',
    duration: '10:30',
    views: '0 views',
    publishedAt: 'Just added',
    addedAt: '2026-10-30T09:51:56Z',
    channelId: '',
    category: 'Threesome',
    videoUrl: 'https://www.pornhub.com/embed/ph5e8cc83e2b2b2',
    description: 'The source did not provide a description for this video.',
    tags: [
      'Threesome', 'Fetish', 'Will Braun', '3some', 'bareback', 'big-cock', 'college',
      'dick flopping', 'ebony', 'glasses', 'jock', 'kissing', 'nextdoorstudios',
      'raw fuck', 'redhead', 'spitroast', 'tongue kissing', 'watching',
    ],
    protectedEmbed: true,
  },
  {
    id: 'v-mzansi-alia-starr-ph5d15003539cc5',
    title: 'BANGBROS – Curvy West Coast Chocolate Bunny Alia Starr Taking White Cock',
    thumbnail: 'https://mzansiadultblog.com/wp-content/uploads/2026/08/bangbros-curvy-west-coast-chocolate-bunny-alia-starr-taking-white-cock-1.jpg',
    duration: '12:00',
    views: '0 views',
    publishedAt: 'Just added',
    addedAt: '2026-10-30T09:51:56Z',
    channelId: '',
    category: 'Ebony',
    videoUrl: 'https://www.pornhub.com/embed/ph5d15003539cc5',
    description: 'The source did not provide a description for this video.',
    tags: [
      'Ebony', 'Fetish', 'Alia Starr', 'bang bros', 'bangbros', 'big naturals', 'big-boobs',
      'big-tits', 'Big Tits', 'black', 'blowjob', 'brown bunnies', 'brownbunnies', 'busty',
      'gostosa', 'huge tits', 'Natural Tits', 'outside', 'public',
    ],
    protectedEmbed: true,
  },
  {
    id: 'v-mzansi-face-crushers-2137091694',
    title: 'Face Crushers – Scene 1',
    thumbnail: 'https://mzansiadultblog.com/wp-content/uploads/2026/08/face-crushers-scene-1.jpg',
    duration: '31:43',
    views: '0 views',
    publishedAt: 'Just added',
    addedAt: '2026-10-30T09:51:56Z',
    channelId: '',
    category: 'Blowjob',
    videoUrl: 'https://www.pornhub.com/embed/2137091694',
    description: 'The source did not provide a description for this video.',
    tags: [
      'Blowjob', 'Fetish', 'Daphne Daniels', 'Rock The Icon', 'big-tits', 'Big Tits', 'bj',
      'brunette', 'chubby', 'cumshot', 'ebony', 'facial', 'huge tits', 'huge-ass',
      'pornhub.com', 'pussy licking',
    ],
    protectedEmbed: true,
  },
  {
    id: 'v-homemade-isabella-clark-FLYDkTYmsaz',
    title: 'Hot Nylon Milf With Standing Tits At Sex Meeting - Isabella Clark',
    thumbnail: 'https://static-ca-cdn.eporner.com/thumbs/static4/1/11/114/11476375/13_240.jpg',
    duration: '12:01',
    views: '0 views',
    publishedAt: 'Just added',
    addedAt: '2026-10-30T09:26:32Z',
    channelId: '',
    category: 'Homemade',
    videoUrl: 'https://www.eporner.com/embed/FLYDkTYmsaz/',
    description: 'Isabella Clark meets a younger man for a date arranged online.',
    tags: [
      'Amateur', 'Homemade', 'Big Tits', 'Lingerie', 'Blonde', 'MILF', 'Pornstar',
      'Isabella Clark', 'Hot sex videos', 'Lesbian hot sex', 'Hot big tits', 'Big tits milf',
      'Hot sex video', 'Hot milf', 'Hot sex', 'Milf tits', 'Thigh highs',
    ],
    protectedEmbed: true,
  },
  {
    id: 'v-homemade-sunday-sex-show-55-f6rgPs3Li8w',
    title: 'Sunday Sex Show 55',
    thumbnail: 'https://static-ca-cdn.eporner.com/thumbs/static4/1/17/179/17900008/15_240.jpg',
    duration: '6:26',
    views: '0 views',
    publishedAt: 'Just added',
    addedAt: '2026-10-30T09:26:32Z',
    channelId: '',
    category: 'Homemade',
    videoUrl: 'https://www.eporner.com/embed/f6rgPs3Li8w/',
    description: 'Another installment of the uploader’s Sunday Sex Show.',
    tags: [
      'Amateur', 'Cumshot', 'Blowjob', 'Homemade', 'Big Tits', 'Lingerie', 'Brunette',
      'HD Porn 1080p', 'Big Ass', 'Squirt', 'Webcam', 'Sex', 'Pussy licking',
      'Tattoo', 'Fishnets', '69', 'Facesitting',
    ],
    protectedEmbed: true,
  },
  {
    id: 'v-homemade-swimming-pool-weRIQSlrEHx',
    title: 'Although It Is A Public Swimming Public Pool This Couple Fucks Without Any Shame',
    thumbnail: 'https://static-ca-cdn.eporner.com/thumbs/static4/1/10/104/10491903/8_240.jpg',
    duration: '9:11',
    views: '0 views',
    publishedAt: 'Just added',
    addedAt: '2026-10-30T09:26:32Z',
    channelId: '',
    category: 'Homemade',
    videoUrl: 'https://www.eporner.com/embed/weRIQSlrEHx/',
    description: 'A couple is intimate in a sauna pool.',
    tags: [
      'Amateur', 'Hardcore', 'Homemade', 'Public', 'Outdoor', 'Handjob', 'Swinger',
      'Small Tits', 'Fetish', 'Webcam', 'HQ Porn', 'Swimming pool', 'Shemale fucks couple',
      'Couple', 'Swimming pool sex', 'Public pool', 'Public swimming pool', 'Fucks',
      'Pool', 'Underwater', 'Femefun',
    ],
    protectedEmbed: true,
  },
  {
    id: 'v-telegram-twerking-aunty',
    title: 'Twerking Aunty',
    thumbnail:
      'https://cdn4.telesco.pe/file/cXcslCvdElEiVY8r9F7DrBSzOABHsWuTWLdv21LdXVGRG-LoQPvmAzM2IO9ef9ugkLykWQWsG0K-x-5WwR-ct2gS-75fnwmjdNT-Upz4QKweba5kyU7mh1u4LcMrxFgK55NIkf8k7wJN3PdbnhS_dJRlniPPgiTcwDgw4l4-bfmkoNsF4tMZCSloak6dFemUsXz39RQdYTOrotEgh4p7b5mRIGG-B0gCY_V4pRQsJ79rgEdaMplFMQq6gaGoHx8p3MdNC4ZegLHSahG07xobEGK_y5AkQhPlPE_mr0i366-r_VClMwo_hNLlZ4lZ2rXYip1wE65CKm0fpnIEyvNB3w',
    duration: '0:54',
    views: '686 views',
    publishedAt: '2 months ago',
    // Date added — sitemap <lastmod> and schema.org uploadDate.
    addedAt: '2026-08-22',
    channelId: '',
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
    // Date added — sitemap <lastmod> and schema.org uploadDate.
    addedAt: '2026-08-22',
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
    // Date added — sitemap <lastmod> and schema.org uploadDate.
    addedAt: '2026-03-22',
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
    // Date added — sitemap <lastmod> and schema.org uploadDate.
    addedAt: '2026-10-17',
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