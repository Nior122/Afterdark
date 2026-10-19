import { asset } from './asset'

/**
 * Uploader avatars.
 *
 * The pool in `public/avatars/uploader-*.jpg` (14 portraits) is AI-generated, synthetic
 * portraits. These are not photographs of real people, and no real person's
 * likeness is being attached to any listing. They are deliberately clothed,
 * non-sexual headshots of clearly adult women, because these are 20–40 px
 * profile circles.
 *
 * `avatarFor` returns a pool image when one is available and falls back to the
 * procedural illustrated generator below when the pool is empty (or for tests),
 * so the component tree never has to care which is in play.
 *
 * Why hash the video id instead of storing a choice:
 *   - every video already in the catalogue gets an avatar with no migration;
 *   - every future upload gets one the instant it is created, unattended;
 *   - the same video always shows the same face on every reload and device.
 *
 * The trade-off is that distinct faces are capped by the pool size — with 14
 * files, an 8th and 9th upload may repeat a face. Drop more JPGs in the folder
 * and add them to `UPLOADER_AVATARS` to widen it; the procedural fallback below
 * can produce 122,880 unique avatars if you ever want variety over realism.
 */
/**
 * Number of files present at `public/avatars/uploader-NN.jpg`, zero-padded from
 * 01. Naming is positional, so growing the pool is: drop the files in, raise
 * this number, done — no list to maintain. Any index beyond the files that
 * actually exist resolves to a 404, which components catch with `onError` and
 * swap for the generated fallback below.
 */
const UPLOADER_AVATAR_COUNT = 53

/** Resolved through `asset()` so the pool also works from a GitHub Pages sub-path. */
export const UPLOADER_AVATARS: readonly string[] = Array.from(
  { length: UPLOADER_AVATAR_COUNT },
  (_, i) => asset(`avatars/uploader-${String(i + 1).padStart(2, '0')}.jpg`),
)

export const AVATAR_POOL_SIZE = UPLOADER_AVATARS.length


const SKIN_TONES = [
  '#4a2c17',
  '#5c3317',
  '#6b4226',
  '#7a4a2b',
  '#8d5524',
  '#9c6b43',
  '#a1662f',
  '#b07a4f',
  '#c08552',
  '#d19a66',
] as const

const BACKGROUNDS = [
  '#e9c46a',
  '#f4a261',
  '#e76f51',
  '#94a2ad',
  '#2a9d8f',
  '#8ab17d',
  '#283618',
  '#b5838d',
  '#6d597a',
  '#3d5a80',
  '#457b9d',
  '#a8dadc',
  '#c9ada7',
  '#dda15e',
  '#bb9464',
  '#ee9b00',
] as const

const CLOTHES = [
  '#1d3557',
  '#264653',
  '#2a9d8f',
  '#3f3d56',
  '#5f6f52',
  '#6d597a',
  '#8d5b2e',
  '#b45f3c',
  '#283618',
  '#38040e',
  '#5e548e',
  '#9d0208',
  '#003049',
  '#665191',
  '#a4133c',
  '#ffb703',
] as const

/**
 * Each entry is [back layer, front layer] drawn around a head ellipse centred
 * at (48, 42) with radii 16/18. Styles are a varied set of women's hairstyles.
 */
const HAIR_STYLES: ReadonlyArray<readonly [string, string]> = [
  // Full afro
  [
    '<circle cx="48" cy="38" r="25" fill="#1c1310"/>',
    '<path d="M26 40a22 22 0 0 1 44 0z" fill="#241812"/>',
  ],
  // Puff afro with a band
  [
    '<circle cx="48" cy="34" r="22" fill="#201612"/>',
    '<path d="M28 34h40v5H28z" fill="#e76f51"/>',
  ],
  // Head wrap
  [
    '<path d="M28 40a20 20 0 0 1 40 0z" fill="#201612"/>',
    '<path d="M26 34c8-12 36-12 44 0 3 4 1 9-2 11-10-8-28-8-40 0-3-2-4-7-2-11z" fill="#2a9d8f"/><path d="M30 30q18-7 36 0" fill="none" stroke="#21877b" stroke-width="3" stroke-linecap="round"/>',
  ],
  // Box braids, long
  [
    '<path d="M26 36a22 22 0 0 1 44 0v34H26z" fill="#1c1310"/>',
    '<path d="M26 40a22 22 0 0 1 44 0z" fill="#241812"/>' +
      [28, 34, 62, 68].map((x) => `<rect x="${x}" y="44" width="5" height="44" rx="2.5" fill="#241812"/>`).join('') +
      [28, 34, 62, 68].map((x) => `<rect x="${x}" y="84" width="5" height="5" rx="2" fill="#e9c46a"/>`).join(''),
  ],
  // Locs
  [
    '<path d="M26 36a22 22 0 0 1 44 0v30H26z" fill="#1a1210"/>',
    '<path d="M26 40a22 22 0 0 1 44 0z" fill="#221712"/>' +
      [27, 32, 37, 59, 64, 69].map((x) => `<rect x="${x}" y="42" width="4" height="34" rx="2" fill="#221712"/>`).join(''),
  ],
  // Twisted shoulder-length
  [
    '<path d="M27 38a21 21 0 0 1 42 0v28H27z" fill="#2b1a12"/>',
    '<path d="M27 41a21 21 0 0 1 42 0z" fill="#342016"/>' +
      [29, 63].map((x) => `<rect x="${x}" y="42" width="6" height="26" rx="3" fill="#342016"/>`).join(''),
  ],
  // High bun
  [
    '<circle cx="48" cy="17" r="9" fill="#1c1310"/>',
    '<path d="M28 40a20 20 0 0 1 40 0z" fill="#241812"/>',
  ],
  // Two afro puffs
  [
    '<circle cx="24" cy="30" r="10" fill="#1c1310"/><circle cx="72" cy="30" r="10" fill="#1c1310"/>',
    '<path d="M30 38a18 18 0 0 1 36 0z" fill="#241812"/>',
  ],
  // Cornrows with a centre part
  [
    '<path d="M28 40a20 20 0 0 1 40 0v6H28z" fill="#1a1210"/>',
    '<path d="M28 40a20 20 0 0 1 40 0z" fill="#221712"/>' +
      [34, 40, 46, 52, 58].map((x) => `<rect x="${x}" y="24" width="2.5" height="18" rx="1.2" fill="#2f211a"/>`).join(''),
  ],
  // Short crop / taper
  [
    '',
    '<path d="M31 40a17 17 0 0 1 34 0z" fill="#201612"/>',
  ],
  // Side sweep with a long tail
  [
    '<path d="M58 34a16 16 0 0 1 12 14v24H62z" fill="#2b1a12"/>',
    '<path d="M28 40a20 20 0 0 1 40 0l-4-8c-12-6-28-2-36 8z" fill="#342016"/>',
  ],
  // Beaded ponytail
  [
    '<path d="M58 30a13 13 0 0 1 13 13v25a7 7 0 0 1-14 0z" fill="#1c1310"/>',
    '<path d="M28 40a20 20 0 0 1 40 0z" fill="#241812"/>' +
      [70, 76, 82].map((y) => `<rect x="59" y="${y}" width="11" height="3" rx="1.5" fill="#e9c46a"/>`).join(''),
  ],
] as const

const EARRING_STYLES = [
  // none
  '',
  // small studs
  '<circle cx="33" cy="50" r="2" fill="#e9c46a"/><circle cx="63" cy="50" r="2" fill="#e9c46a"/>',
  // hoops
  '<g fill="none" stroke="#e9c46a" stroke-width="1.8"><circle cx="32.5" cy="53" r="3.4"/><circle cx="63.5" cy="53" r="3.4"/></g>',
  // dangles
  '<g fill="#e9c46a"><circle cx="32.5" cy="50" r="1.6"/><rect x="31.8" y="51" width="1.4" height="7" rx=".7"/><circle cx="32.5" cy="59" r="2.2"/><circle cx="63.5" cy="50" r="1.6"/><rect x="62.8" y="51" width="1.4" height="7" rx=".7"/><circle cx="63.5" cy="59" r="2.2"/></g>',
] as const

export const AVATAR_VARIANTS = {
  skinTones: SKIN_TONES.length,
  hairstyles: HAIR_STYLES.length,
  backgrounds: BACKGROUNDS.length,
  clothes: CLOTHES.length,
  earrings: EARRING_STYLES.length,
} as const

/** Total number of visually distinct avatars the generator can produce. */
export const AVATAR_COMBINATIONS =
  SKIN_TONES.length *
  HAIR_STYLES.length *
  BACKGROUNDS.length *
  CLOTHES.length *
  EARRING_STYLES.length

/** FNV-1a: small, fast and stable across runs and platforms. */
/** FNV-1a. Shared by the avatar pool and channel attribution so both are
 * driven by the same deterministic spread. */
export function hashString(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pick<T>(values: readonly T[], n: number): T {
  return values[n % values.length]
}

/**
 * Build the SVG markup for a given seed. Exported for tests/previewing; the app
 * uses `avatarFor`, which returns a ready-to-use data URI.
 */
export function avatarSvg(seed: string): string {
  const h = hashString(seed || 'afterdark')
  // Derive independent indices so changing one axis does not shift the others.
  const skin = pick(SKIN_TONES, h)
  const hair = pick(HAIR_STYLES, Math.floor(h / 7) % HAIR_STYLES.length)
  const background = pick(BACKGROUNDS, Math.floor(h / 13) % BACKGROUNDS.length)
  const cloth = pick(CLOTHES, Math.floor(h / 29) % CLOTHES.length)
  const earrings = pick(EARRING_STYLES, Math.floor(h / 53) % EARRING_STYLES.length)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img">`,
    `<rect width="96" height="96" fill="${background}"/>`,
    // shoulders
    `<path d="M12 96c0-18 16-27 36-27s36 9 36 27z" fill="${cloth}"/>`,
    // neck (skin, with a soft shadow instead of a second colour)
    `<path d="M42 54h12v12a6 6 0 0 1-12 0z" fill="${skin}"/>`,
    `<path d="M42 54h12v4a6 6 0 0 1-12 0z" fill="#000" opacity=".16"/>`,
    hair[0],
    // head
    `<ellipse cx="48" cy="42" rx="16" ry="18" fill="${skin}"/>`,
    hair[1],
    // Face. Features are drawn with a light sclera and a mid-tone mouth rather
    // than a single dark ink, so they stay visible on the deepest skin tones
    // as well as the lightest ones.
    '<g><ellipse cx="42" cy="42" rx="2.7" ry="2.1" fill="#fdf4ea"/><ellipse cx="54" cy="42" rx="2.7" ry="2.1" fill="#fdf4ea"/></g>' +
      '<g fill="#1c1310"><circle cx="42.2" cy="42.2" r="1.2"/><circle cx="54.2" cy="42.2" r="1.2"/></g>',
    '<path d="M43.5 49q4.5 3.4 9 0" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>',
    '<path d="M43.5 49q4.5 3.4 9 0" fill="none" stroke="#8c3b2f" stroke-width="1.8" stroke-linecap="round"/>',
    earrings,
    '</svg>',
  ].join('')
}

const dataUriCache = new Map<string, string>()

/**
 * Avatar URL for a video: a real (synthetic) portrait from the pool when one is
 * available, otherwise the generated illustrated fallback. Deterministic per id.
 */
export function avatarFor(seed: string): string {
  if (AVATAR_POOL_SIZE === 0) return svgDataUri(seed)
  return UPLOADER_AVATARS[hashString(seed || 'afterdark') % AVATAR_POOL_SIZE]
}

/**
 * Fallback used when a pool file is missing (404): swap in a generated portrait
 * so an avatar slot never renders as a broken image.
 */
export function avatarFallbackFor(video: { id: string }): string {
  return svgDataUri(video.id)
}

function svgDataUri(seed: string): string {
  const cached = dataUriCache.get(seed)
  if (cached) return cached
  const uri = `data:image/svg+xml,${encodeURIComponent(avatarSvg(seed))}`
  dataUriCache.set(seed, uri)
  return uri
}

