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
  techbit: '/avatars/techbit.svg',
  cinemasphere: '/avatars/cinemasphere.jpg',
  gameplay: '/avatars/gameplay.svg',
  newsnow: '/avatars/newsnow.jpg',
  sportscentral: '/avatars/sportscentral.svg',
  cinemax: '/avatars/cinemax.jpg',
  chillwave: '/avatars/chillwave.svg',
  user: '/avatars/user.jpg',
} as const

export const CHANNELS: Channel[] = [
  { id: 'techbit', name: 'TechBit', avatar: AVATARS.techbit, verified: true, subscribers: '2.4M' },
  { id: 'cinemasphere', name: 'CinemaSphere', avatar: AVATARS.cinemasphere, verified: true, subscribers: '1.8M' },
  { id: 'gameplay', name: 'GamePlay', avatar: AVATARS.gameplay, verified: true, subscribers: '3.1M' },
  { id: 'newsnow', name: 'NewsNow', avatar: AVATARS.newsnow, verified: true, subscribers: '5.2M' },
  { id: 'sportscentral', name: 'SportsCentral', avatar: AVATARS.sportscentral, verified: true, subscribers: '1.2M' },
  { id: 'cinemax', name: 'CineMax', avatar: AVATARS.cinemax, verified: true, subscribers: '980K' },
  { id: 'chillwave', name: 'ChillWave', avatar: AVATARS.chillwave, verified: true, subscribers: '4.6M' },
  { id: 'you', name: 'You', avatar: AVATARS.user, verified: false, subscribers: '0' },
]

export const CHANNEL_MAP: Record<string, Channel> = Object.fromEntries(
  CHANNELS.map((c) => [c.id, c]),
)

export const ADVERTISERS: Channel[] = [
  { id: 'ad-nova', name: 'Nova Bank', avatar: '/avatars/nova.svg', verified: true, subscribers: '' },
  { id: 'ad-vista', name: 'Vista Travel', avatar: '/avatars/vista.svg', verified: true, subscribers: '' },
  { id: 'ad-pulse', name: 'Pulse Gaming', avatar: '/avatars/pulse.svg', verified: true, subscribers: '' },
  { id: 'ad-meridian', name: 'Meridian News', avatar: '/avatars/meridian.svg', verified: true, subscribers: '' },
  { id: 'ad-strike', name: 'Strike Football', avatar: '/avatars/strike.svg', verified: true, subscribers: '' },
  { id: 'ad-cinemax', name: 'CineMax+', avatar: AVATARS.cinemax, verified: true, subscribers: '' },
  { id: 'ad-sonic', name: 'Sonic Music', avatar: '/avatars/sonic.svg', verified: true, subscribers: '' },
  { id: 'ad-northvolt', name: 'NorthVolt', avatar: '/avatars/northvolt.svg', verified: true, subscribers: '' },
]

export const ALL_CHANNELS: Channel[] = [...CHANNELS, ...ADVERTISERS]
export const ALL_CHANNEL_MAP: Record<string, Channel> = Object.fromEntries(
  ALL_CHANNELS.map((c) => [c.id, c]),
)

export const CATEGORIES = [
  'All',
  'Tech',
  'Gaming',
  'Entertainment',
  'Music',
  'News',
  'Sports',
  'Movies',
  'How-To',
] as const

/** Ads shown in the first row ("Recommended for you"). */
export const RECOMMENDED_ADS: Ad[] = [
  {
    id: 'ad-rec-1',
    sponsor: 'Ad',
    advertiser: 'Nova Bank',
    adHeadline: '',
    title: 'The Future of Smart Cities',
    thumbnail: '/thumbnails/city.jpg',
    duration: '2:45',
    views: '128K views',
    publishedAt: '2 days ago',
    channelId: 'techbit',
    category: 'Tech',
    isAd: true,
  },
  {
    id: 'ad-rec-2',
    sponsor: 'Ad · Get 20% off on annual plans',
    advertiser: 'Vista Travel',
    adHeadline: 'Get 20% off on annual plans',
    title: "Exploring the World's Most Beautiful Places",
    thumbnail: '/thumbnails/mountains.jpg',
    duration: '10:12',
    views: '245K views',
    publishedAt: '1 week ago',
    channelId: 'cinemasphere',
    category: 'Entertainment',
    isAd: true,
  },
  {
    id: 'ad-rec-3',
    sponsor: 'Ad',
    advertiser: 'Pulse Gaming',
    adHeadline: 'New loot, new season. Play now!',
    title: 'Cyber Arena – Season 7 Gameplay',
    thumbnail: '/thumbnails/gaming.jpg',
    duration: '8:31',
    views: '89K views',
    publishedAt: '3 days ago',
    channelId: 'gameplay',
    category: 'Gaming',
    isAd: true,
  },
  {
    id: 'ad-rec-4',
    sponsor: 'Ad',
    advertiser: 'Meridian News',
    adHeadline: 'Stay informed. Get the full story.',
    title: 'Top Headlines: Global Markets Update',
    thumbnail: '/thumbnails/news.jpg',
    duration: '5:27',
    views: '76K views',
    publishedAt: '8 hours ago',
    channelId: 'newsnow',
    category: 'News',
    isAd: true,
  },
]

/** Ads shown in the "Trending now" row. */
export const TRENDING_ADS: Ad[] = [
  {
    id: 'ad-trend-1',
    sponsor: 'Ad',
    advertiser: 'Strike Football',
    adHeadline: 'Built for champions.',
    title: 'Top 10 Soccer Goals This Week',
    thumbnail: '/thumbnails/soccer.jpg',
    duration: '3:15',
    views: '312K views',
    publishedAt: '1 day ago',
    channelId: 'sportscentral',
    category: 'Sports',
    isAd: true,
  },
  {
    id: 'ad-trend-2',
    sponsor: 'Ad',
    advertiser: 'CineMax+',
    adHeadline: 'Now streaming. Only on CineMax',
    title: 'Shadow Protocol – Official Trailer',
    thumbnail: '/thumbnails/hooded.jpg',
    duration: '12:45',
    views: '1.2M views',
    publishedAt: '4 days ago',
    channelId: 'cinemax',
    category: 'Movies',
    isAd: true,
  },
  {
    id: 'ad-trend-3',
    sponsor: 'Ad',
    advertiser: 'Sonic Music',
    adHeadline: 'Millions of songs. One app.',
    title: 'Lo-Fi Beats to Study / Relax To',
    thumbnail: '/thumbnails/waveform.jpg',
    duration: '1:02:34',
    views: '530K views',
    publishedAt: '6 days ago',
    channelId: 'chillwave',
    category: 'Music',
    isAd: true,
  },
  {
    id: 'ad-trend-4',
    sponsor: 'Ad',
    advertiser: 'NorthVolt',
    adHeadline: 'Upgrade your tech. Save more.',
    title: 'How to Build Your First PC – Step by Step',
    thumbnail: '/thumbnails/tech.jpg',
    duration: '6:48',
    views: '97K views',
    publishedAt: '5 days ago',
    channelId: 'techbit',
    category: 'How-To',
    isAd: true,
  },
]

export const SEED_VIDEOS: Video[] = [
  {
    id: 'v-concert',
    title: 'Inside the Neon Tour: Night Two Highlights',
    thumbnail: '/thumbnails/concert.jpg',
    duration: '14:02',
    views: '842K views',
    publishedAt: '2 days ago',
    channelId: 'chillwave',
    category: 'Music',
  },
  {
    id: 'v-nebula',
    title: 'What the New Telescope Found in the Carina Nebula',
    thumbnail: '/thumbnails/nebula.jpg',
    duration: '18:27',
    views: '1.4M views',
    publishedAt: '1 week ago',
    channelId: 'techbit',
    category: 'Tech',
  },
  {
    id: 'v-cooking',
    title: 'Restaurant Secrets: The Perfect Flambé Pasta',
    thumbnail: '/thumbnails/cooking.jpg',
    duration: '11:36',
    views: '226K views',
    publishedAt: '3 days ago',
    channelId: 'cinemasphere',
    category: 'How-To',
  },
  {
    id: 'v-supercar',
    title: 'Pushing the New Roadster Down the Pacific Coast',
    thumbnail: '/thumbnails/supercar.jpg',
    duration: '9:54',
    views: '604K views',
    publishedAt: '5 days ago',
    channelId: 'sportscentral',
    category: 'Sports',
  },
  {
    id: 'v-city-doc',
    title: 'How Cities Learned to Think: Urban Tech Explained',
    thumbnail: '/thumbnails/city.jpg',
    duration: '22:08',
    views: '318K views',
    publishedAt: '2 weeks ago',
    channelId: 'techbit',
    category: 'Tech',
  },
  {
    id: 'v-lake',
    title: 'A Week Alone in the Rockies (4K Cinematic)',
    thumbnail: '/thumbnails/mountains.jpg',
    duration: '21:15',
    views: '1.1M views',
    publishedAt: '1 month ago',
    channelId: 'cinemasphere',
    category: 'Entertainment',
  },
  {
    id: 'v-cinema',
    title: 'The Making of a Cinema Classic: Restored in 4K',
    thumbnail: '/thumbnails/hooded.jpg',
    duration: '16:41',
    views: '487K views',
    publishedAt: '6 days ago',
    channelId: 'cinemax',
    category: 'Movies',
  },
  {
    id: 'v-news-brief',
    title: 'Morning Brief: What You Missed Overnight',
    thumbnail: '/thumbnails/news.jpg',
    duration: '7:12',
    views: '410K views',
    publishedAt: '5 hours ago',
    channelId: 'newsnow',
    category: 'News',
  },
  {
    id: 'v-game-meta',
    title: 'The New Meta: 10 Loadouts That Actually Work',
    thumbnail: '/thumbnails/gaming.jpg',
    duration: '13:29',
    views: '2.3M views',
    publishedAt: '4 days ago',
    channelId: 'gameplay',
    category: 'Gaming',
  },
  {
    id: 'v-match',
    title: 'Full Match Recap: The Comeback of the Season',
    thumbnail: '/thumbnails/soccer.jpg',
    duration: '19:47',
    views: '3.6M views',
    publishedAt: '1 day ago',
    channelId: 'sportscentral',
    category: 'Sports',
  },
  {
    id: 'v-lofi',
    title: 'Late Night Session – Deep Focus Mix',
    thumbnail: '/thumbnails/waveform.jpg',
    duration: '58:19',
    views: '2.9M views',
    publishedAt: '3 weeks ago',
    channelId: 'chillwave',
    category: 'Music',
  },
  {
    id: 'v-pc-build',
    title: 'Build a Silent 4K Editing Rig for Under $900',
    thumbnail: '/thumbnails/tech.jpg',
    duration: '24:03',
    views: '156K views',
    publishedAt: '2 days ago',
    channelId: 'techbit',
    category: 'How-To',
  },
]
