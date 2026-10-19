# AfterDark

An adult (18+) video platform UI built with **React 19 + TypeScript + Vite + Tailwind CSS v4** — browse videos by POV, amateur, MILF, Latina, hardcore and other adult categories.

The home feed is a close recreation of the supplied design (sidebar, category chips, video
rows), and the rest of the product is wired up so videos can actually be
added and watched. **No database, no file storage, no backend** — videos are added by pasting a URL
and the list is kept in `localStorage`.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build on http://localhost:4173
```

Node 18+ is required.

## Adding a video (no upload, no storage)

Click **Create** in the header (or "Add a video" on the Library page) and paste a link:

| Link type | What happens |
| --- | --- |
| `youtube.com/watch?v=…`, `youtu.be/…`, Shorts, `/embed/…` | Plays inline in the YouTube privacy-enhanced player; title and thumbnail auto-detected |
| `vimeo.com/123456` | Plays inline in the Vimeo player |
| `https://…/clip.mp4` (mp4, webm, ogg, mov, m4v) | Plays in the native HTML5 player |
| `https://…/embed/…` (generic embed player) | Plays inline behind a click shield (see below) |
| `https://t.me/<public-channel>/<post>` | Plays inline through Telegram's protected post embed (private `/c/…` posts are preview-only) |
| Any other page | Shows the thumbnail with an "Open original" button |

**Click-shielded embeds:** generic `/embed/…` players render through `EmbedPlayer` with no text over
the video — a clean poster/play facade loads the iframe only from AfterDark's own button, the hardened
`sandbox` omits `allow-top-navigation*`/`allow-popups*` so player links and popunders cannot redirect
this page or open the source site, the iframe is shifted up so the source player's title/credit strip is
cropped out of view, an invisible shield covers that area, and a hover lock icon can make the whole
video non-clickable. Link-only catalogue imports live in `src/data/seed.ts` (`protectedEmbed: true`)
with only the embed URL, a remote thumbnail URL and metadata (`description`, `tags`) — no video or image
files are stored. Their raw source URL is not shown on the watch page. Public Telegram posts use the
stable post URL and `TelegramPlayer`, never a temporary tokenised CDN MP4 URL. Telegram thumbnails are
the post's actual poster images hotlinked from Telegram's CDN (still link-only, nothing stored); the
Create dialog auto-detects the poster for newly pasted public Telegram posts.

Fields: URL (required), title (required, auto-filled for YouTube links), optional thumbnail URL,
category and optional duration (`8:31` or seconds). Everything is stored in the browser only —
`localStorage` key `gridwatch.store.v1` (legacy key retained so existing browsers keep their data) — and can be wiped by clearing site data. Uploaded videos are
tagged **Yours** and can be deleted from their card menu or the watch page.

## Telegram bot publishing (optional)

Forward a video to a Telegram bot and it appears on the site for everyone — including videos
from private chats/channels that the public embed cannot reach. A tiny Cloudflare Worker
(`worker/worker.js`) receives the bot's updates, stores only Telegram file IDs in KV, publishes
a JSON feed at `/api/videos`, and proxies playback/thumbnails so the bot token never reaches
the browser. The site merges that feed into the catalogue when the build-time variable
`VITE_TELEGRAM_FEED_URL` is set (GitHub repo variable for Pages deploys, or `.env.local` —
see `.env.example`); unset, the site is unchanged. Bot commands: send a video to publish
(caption = title, `#Hashtags` = tags/category), `/list`, `/remove <id>`. One-time setup
(~10 minutes, all free) is documented step-by-step in
[docs/telegram-bot-setup.md](docs/telegram-bot-setup.md). Telegram bots can only fetch files
up to 20 MB, so larger videos still go through public `t.me` links.

## Screens

| Route | Description |
| --- | --- |
| `/` | Home feed: latest videos, your videos (if any), and popular adult categories with counts |
| `/browse/:category` | Adult category feed (`POV`, `MILF`, `Big Tits`, `Blowjob`, …; matched by category or tag) |
| `/explore` | Category tiles and discovery rows |
| `/trending` | Videos sorted by view count |
| `/subscriptions` | Subscribed channels + their uploads (subscribe/unsubscribe works) |
| `/library` | History / Watch later / Liked shortcuts + videos you added |
| `/history`, `/watch-later`, `/liked` | Collections, all persisted |
| `/results?q=…` | Search across adult videos, channels, categories and tags |
| `/watch/:id` | Player, like/save/share, expandable description, "Up next" rail |

There are no accounts, profiles or comment sections: nothing requires a login, and channel
names are attribution metadata only (`/channel/:id` routes do not exist). Videos you add are
stored unattributed in your own browser.
| `*` | 404 |

## Project structure

```
public/
  avatars/       channel avatars (SVG)
  thumbnails/    seeded video thumbnails
  favicon.svg
src/
  components/    Header, Sidebar, CategoryBar, VideoCard/Grid/Row, CreateModal, AgeGate, ThemeToggle, KebabMenu…
  data/seed.ts   POV Central (attribution metadata only), the 4-video catalogue, adult categories (ad arrays are empty)
  lib/store.tsx  React context store persisted to localStorage
  lib/theme.tsx  light/dark theme provider (localStorage + prefers-color-scheme)
  lib/age.ts     18+ acceptance flag and hook
  lib/avatars.ts  generated uploader avatars (data-URI SVG, see below)
  lib/video.ts   URL parsing (YouTube/Vimeo/Telegram posts/direct files), view + duration formatting
  lib/hooks.ts   click-outside, escape, page title
  pages/         one component per route
```

## Notes

- The UI is fully responsive: 4-column feed at ≥1168 px, 3/2/1 columns below, off-canvas sidebar on
  mobile, and the watch page switches to a side rail at ≥1184 px.
- There are no ad or demo videos: the seeded catalogue contains only the 4 curated link-only
  videos in `SEED_VIDEOS` — 3 POV embeds plus 1 Homemade Telegram post
  (`RECOMMENDED_ADS`/`TRENDING_ADS` are empty arrays).
- Inter is bundled locally via `@fontsource-variable/inter`, so no external font request is needed.
- **Theming.** Light and dark are both supported. Components never carry `dark:` variants or raw hex:
  they use the semantic tokens in `src/index.css` (`surface`, `panel`, `raise`, `sunken`, `field`, `line`,
  `ink`, `body`, `muted`, `faint`, `action`/`on-action`), and `.dark` overrides those variables on `<html>`.
  Toggling is therefore one class, and any new component is themed automatically by using a token.
  The choice persists in `afterdark.theme.v1`; while nothing is stored the app follows
  `prefers-color-scheme` live. A blocking script in `index.html` applies the class before first paint,
  so a reload never flashes white.
- **Age gate.** `<AgeGate>` in `main.tsx` renders nothing of the site — not the header, not a single
  thumbnail — until the visitor confirms they are 18+. Acceptance is stored as `afterdark.age.v1=yes`
  in localStorage (no account, no server call); "I am under 18" shows a refusal screen instead. The gate
  also carries a theme toggle, since it is the first screen visitors see.
- **Channels = uploaders.** Every listing is attributed to a channel, and a channel
  *is* the uploader: a name, one face from the avatar pool, a verified flag and a
  **fake** subscriber count. `src/data/seed.ts` carries a roster of **100** names, four per
  browse category (`POV Central` / `Her Lens POV` / `Lens Loaded POV` / `First Person Files`
  for POV), and `selectChannelRoster(poolSize)` keeps live only as many as the avatar pool
  can fund without two channels sharing a face: 2 per category from 50 faces, 3 from 75, all 4
  from 100. The pool is therefore the single dial — raising `UPLOADER_AVATAR_COUNT` grows the
  uploader roster with it, and a pool too small for the next tier keeps the current tier instead
  of duplicating faces. Crossing a tier does re-shuffle which sibling channel a video hashes
  onto (same category, different uploader). `channelForVideo(video)` in
  `src/lib/uploader.ts` does the assignment: an explicitly attributed video keeps its
  channel, while uploads and Telegram imports (`channelId: ''`) are spread across the
  *whole live roster*, chosen by hashing the video id over every channel. A hashtag-less
  bot import no longer concentrates on two channels — measured across 5 000 bot-style
  ids, all 50 channels receive uploads (busiest holds 2.4 %, spread min 69 / max 122).
  The pairing is stable across reloads and identical on every device, and nothing is
  stored. An import with no declared category inherits its uploader's niche; a declared
  one is kept. View counts (`src/lib/stats.ts`) are derived per video id: a log-uniform
  ceiling ramped from 18 % to 100 % over two days, nothing stored, so counts age on their
  own and match across devices. Subscriber counts are log-uniform (~2K–~800K, floored so
  no channel looks dead) and are invented, like the performers: no number here is real
  and none should be quoted as one. `faceForVideo(video)` returns the channel's face, so all
  uploads from one channel look like the same uploader; the per-video `avatar` field
  overrides it when you need to pin a specific face. Cards and rows show
  `name · subscribers`; the watch page, subscriptions rail, search results and the bell
  feed all read the same resolver. Each channel has a page — `/channel/:id`, reachable by
  clicking any uploader name or face, plus the sidebar subscriptions, the subscriptions rail
  and search results — listing every video attributed to it (`videosForChannel`). There are
  still no visitor accounts.
  To rename or re-scope a channel, edit `CHANNEL_ROSTER` — ids are slugs of the names, and
  `pov-central` is the one id the code special-cases. Names beyond the live tier stay dormant
  until the pool is big enough for them.

- **Uploader avatars.** Every video shows a distinct avatar in the feed, the row list
  and the watch page. The pool is `public/avatars/uploader-01.jpg` … `uploader-63.jpg`:
  **AI-generated synthetic portraits** — they are not photographs of any real person, and no
  real likeness is attached to any listing. They are clothed, non-sexual headshots of adult
  women, sized 192×192 (~5–9 kB each, 572 kB for all 63) because they render at 20–40 px.
  `avatarFor(video.id)` hashes the id into the pool, so uploads acquire an avatar automatically
  with no configuration and the same video always shows the same face on every device.
  Seeded catalogue entries pin an explicit `avatar` in `data/seed.ts` so the demo feed shows
  four different faces; add that field to override the hash for any video.
  Two consequences of a real image pool: distinct faces are capped by the pool size, and
  viewers may read an avatar as the performer — consider labelling them as illustrative if
  that matters for your audience. Widen the pool by dropping more sequentially named JPGs in
  `public/avatars/` and raising `UPLOADER_AVATAR_COUNT` in `src/lib/avatars.ts`; a missing
  file falls back to the generator via `onError` rather than showing a broken image. `src/lib/avatars.ts` also keeps a procedural illustrated generator
  (122,880 combinations) used automatically if the pool is ever emptied.
- There is no UI trigger for adding a video: the modal, `addVideo` and URL parsing are intact, but the
  header/library/watch-page buttons were removed by design.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on `0.0.0.0:5173` |
| `npm run build` | `tsc -b` type-check, then production build |
| `npm run preview` | Preview the production build |

## Deployment

The app is a static single-page build — `npm run build` emits `dist/` with no server requirements.
Routing uses a **HashRouter** (`/#/watch/…`) so the build works on any static host, including GitHub
Pages sub-paths, with zero rewrite configuration.

### GitHub Pages (included workflow)

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Merge this work into `main` (or run the workflow manually from the Actions tab)
3. The site appears at `https://<user>.github.io/<repo>/`

### Vercel

`vercel.json` is already configured (Vite framework preset, `dist` output, SPA rewrites, asset caching).

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production
```

Or import the repository at <https://vercel.com/new> and press Deploy — no environment variables are
needed.

### Netlify

`netlify.toml` is already configured (build command, `dist` publish dir, SPA redirect, headers).
Import the repo at <https://app.netlify.com/start>, or:

```bash
npm i -g netlify-cli
netlify deploy --prod --dir=dist
```

### Any static host (S3, Cloudflare Pages, Firebase Hosting, nginx)

Upload the contents of `dist/` after `npm run build`. Because of the hash router, deep links resolve
to `index.html` automatically.

### Production checks

```bash
npm run build          # tsc -b + vite build
npm run preview        # serve dist/ at http://localhost:4173
```

- No environment variables, API keys, database or object storage are required.
- Videos added in the UI are stored per-browser in `localStorage`; deployments start with the 4
  seeded link-only videos on a fresh browser. Saved/liked/history IDs for removed catalogue videos are
  filtered out on load, removed channel subscriptions are dropped, and any legacy non-adult
  categories on locally saved videos are normalised to `POV`.
- YouTube embeds use `youtube-nocookie.com`; generic embed links are rendered in a sandboxed iframe
  with `referrerPolicy="no-referrer"`.

## Deployment status

- Clean production build (Vite 6, ~90 kB gzipped main chunk, React split into its own chunk).
- Works from the domain root **and** from a sub-path (relative `base`, hashed asset URLs).
- `npm run preview` verified: images, fonts, hash routing and deep links all load with zero console errors.

## Changelog

- `0c3834b` deployment config for GitHub Pages / Vercel / Netlify.
- `d766358` sandboxed generic embed players + branded placeholder poster.
- `875ac5e` initial build: home feed, watch page, create-by-URL, search, library.

## Hosting cheat-sheet

| Host | What to do |
| --- | --- |
| GitHub Pages | Settings → Pages → Source **GitHub Actions**, then merge into `main` (workflow deploys automatically) |
| Vercel | Import repo at vercel.com/new → Deploy (settings read from `vercel.json`) |
| Netlify | Import repo at app.netlify.com/start (settings read from `netlify.toml`) |
| Cloudflare Pages | Build `npm run build`, output `dist` |
| Any web server | Copy `dist/` — hash routing needs no rewrites |
