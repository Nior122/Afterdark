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
| `https://t.me/<public-channel>/<post>` | Plays inline through Telegram's protected post embed; the post's duration and portrait/landscape shape are read from the widget markup (private `/c/…` posts are preview-only) |
| Any other page | The import first digs a media file out of the page — `og:video` meta, `<video>`/`<source>`/`<iframe>` tags, and JS player configs (`sources:[{file:"…mp4"}]`, the Fluid-player shape WordPress blogs use). Found → plays natively; genuinely nothing playable on the page → shows the thumbnail with an "Open original" button |

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

**Shape and timestamps:** a video whose media is taller than wide (vertical phone clips — the Worker
stores the pixel dimensions for bot uploads, and reads them back from the padding of a `t.me` post
widget for link imports) keeps its shape everywhere: portrait cards in the masonry catalogue grid, a
letterboxed (uncropped) poster on the card and the player facade — and portrait thumbs in the admin
dashboard too (Videos rows and Drafts cards), instead of the scene being cropped to a 16:9 band. The clip's length shows as a timestamp badge on every card, row and poster facade,
and in the generic description line for caption-less uploads. For `t.me` links the duration is read
from the post widget itself (`tgme_widget_message_video_duration` overlay), so Telegram videos get a
real `41:05` badge instead of `0:00`; videos imported before this reads `0:00` until deleted and
re-added by link.

**Telegram CTA:** every opened video — the watch page in public mode and the standalone `/v/…` page in
direct mode — shows one animated Telegram-blue button, *Watch Full Video* with a paper-plane, between the
like/share row and the description box (under the title on direct pages), always outside the box and never
on grid cards. It links to the owner's bot (`https://t.me/KasiQueenbot`, constant `TELEGRAM_CTA_URL` in
`src/components/TelegramCta.tsx`; change it there and rebuild). Being page-level, it covers existing and
future videos alike. The label sheens, the plane nudges every few seconds and the pill breathes — all
motion stops under `prefers-reduced-motion`, and the link opens in a new tab with `noopener noreferrer`.

Fields: URL (required), title (required, auto-filled for YouTube links), optional thumbnail URL,
category and optional duration (`8:31` or seconds). Everything is stored in the browser only —
`localStorage` key `gridwatch.store.v1` (legacy key retained so existing browsers keep their data) — and can be wiped by clearing site data. Uploaded videos are
tagged **Yours** and can be deleted from their card menu or the watch page. The dialog is a personal
scratchpad, not the publish path: to give every visitor a video, import the link through the bot or
the dashboard's **Scrape a link into drafts** — that stores it on the Worker, and the watch page says
as much on page-only entries ("links added from the Create dialog are saved in this browser only").

**Setting this up for the first time?** Follow
[docs/cloudflare-setup-walkthrough.md](docs/cloudflare-setup-walkthrough.md) —
the same steps as the bot guide, but slower, with checkpoints and a
troubleshooting table. Submitting to Google Search Console (verification,
sitemap, automatic rebuilds): [docs/google-search-console.md](docs/google-search-console.md).

## Two site modes (one switch)

The site ships with a runtime switch, stored in the Worker's KV so it needs no rebuild:

| Mode | What visitors get |
| --- | --- |
| `public` (default) | The full catalogue: home feed, categories, search, related videos |
| `direct` | Link-only: no home page, no menu, no related videos, no links between videos. Each video opens **only** from its own URL `/v/<id>/` |

**Home-page redirect.** In `direct` mode the owner can point every non-video URL at an
external link (an ad/affiliate offer, say). It is a **real 302** issued by
`functions/_middleware.ts` — not a JavaScript hop — so it works with scripts disabled and ad
networks see genuine traffic. Never redirected: video pages `/v/<id>/`, the dashboard
`/admin`, `sitemap.xml`, `robots.txt` and every asset. With no URL set, the home page shows the
neutral 18+ page instead. Set it from the dashboard (**Site mode → Home-page redirect**) or with
`/redirect <url>` in the bot; `/redirect off` clears it. The dashboard is served as a plain `200`
at both `/admin` and `/admin/`, skipping even Pages' permanent trailing-slash `308` — browsers
cache 308s forever, and one stale entry would keep bouncing the admin URL without asking the
network; the redirect-free replies keep the owner's route to the controls clean.

**Every video, old or new.** Videos posted after a build have no prerendered file; the middleware
serves them a shell with a **200** and the app renders them from the live feed, so a link works
immediately. They enter `sitemap.xml` on the next build.

### Ads

Owner-pasted ad code, switched on/off live — no rebuild, no redeploy:

| Slot | Where it appears |
| --- | --- |
| `header` | Full-width banner under the site header |
| `native` | In-feed unit at the end of the content column |
| `sidebar` | Under the sidebar navigation |
| `footer` | Above the footer, every page |
| `video` | Under the player on `/v/<id>/` pages |
| `popunder` | One global script (popunder / interstitial networks) |

Paste each network's snippet in the dashboard's **Ads** tab, then switch ads on (there, or with
`/ads on` in the bot). Code is injected verbatim and `<script>` tags are re-created so they
execute — the standard way to run third-party tags. Each slot **reserves its height**, so ads
never shift the layout, and with ads off (the default) nothing at all is rendered. The dashboard
stays ad-free so you always have a page that loads without third-party scripts. Ads are limited
to 20 KB per slot and shown on video pages in both modes.

Two switches stack: the global one plus a **per-slot enable** — a slot renders only when both are
on and it holds code (hide one network without touching the others; toggling is instant, like the
global switch). **Slot preview outlines** replaces live ads on the whole site with dashed boxes
labelled per slot (`on` / `off` / `empty`) so you can check placement while deciding — no ad code
executes while previewing. Both settings live in the same KV blob as the code and reach the site
through `/api/settings`, so nothing needs a rebuild.

> Ads are third-party code on your pages: only paste tags from networks you trust, and check what
> they do to load time. Adult traffic is rejected by most mainstream networks, so test the offer
> link from the same country as your visitors.

Switch it from the bot (`/mode`) or from the dashboard (`/admin/`) — see
[docs/telegram-bot-setup.md](docs/telegram-bot-setup.md).

### How search engines still index every video

Discovery never depends on internal links, in either mode:

- `sitemap.xml` lists **every** video page with `<lastmod>` = the date it was added. It is
  generated at build time from the catalogue plus the bot feed, so it changes when videos are
  added or removed.
- `robots.txt` is `User-agent: *` / `Allow: /` / `Disallow: /admin` / `Sitemap: …/sitemap.xml` —
  the public catalogue is fully open, the admin console is kept out of the index, and crawlers get
  exactly the same HTML visitors get (no cloaking).
- Every `/v/<id>/` page is a real static file with its own `<title>`, meta description,
  `<meta name="robots" content="index, follow">`, canonical URL, Open Graph + Twitter cards
  (`summary_large_image`) and a schema.org `VideoObject` block (`name`, `description`,
  `thumbnailUrl`, `uploadDate`, `contentUrl`/`embedUrl`, `duration`).
- `/`, the 404 shell and `/admin/` are `noindex` — the catalogue's hash routes are not per-video
  URLs, so indexable content lives at the video URLs only. The shells are still `follow`, and
  `/admin` is also disallowed in `robots.txt`; a `/v/<id>/` URL that no video owns answers a
  real `404` instead of a soft one.

New videos appear on their own URL immediately; they enter `sitemap.xml` after the next build,
which the dashboard's **Rebuild site** button triggers — or which happens **by itself**: with a
rebuild target configured on the Worker (`GITHUB_TOKEN`/`GITHUB_REPO` for GitHub Pages,
`CLOUDFLARE_BUILD_HOOK` for a Cloudflare Pages build hook — either or both), every
publish/unpublish/repair dispatches one debounced rebuild; a nightly workflow covers the GitHub
copy on quiet days, and on Cloudflare Pages a fresh video is indexable within the minute
regardless (the middleware builds its head from the live feed). `VITE_GOOGLE_SITE_VERIFICATION`
adds the Search Console meta tag to every page.
Full guide: [docs/google-search-console.md](docs/google-search-console.md).

## Telegram bot publishing (optional)

Forward a video to a Telegram bot and it appears on the site for everyone — including videos
from private chats/channels that the public embed cannot reach. A tiny Cloudflare Worker
(`worker/worker.js`) receives the bot's updates, stores only Telegram file IDs in KV, publishes
a JSON feed at `/api/videos` (each video carries its real `views` count), and proxies
playback/thumbnails so the bot token never reaches the browser — the same proxy now also serves
scraped external `.mp4`s and posters, which is what makes hotlink-protecting blogs (the
"broken link when I press play" case) play normally. Index writes are verified and retried, and
opening the admin dashboard re-indexes any record that was ever stored but never listed — so a
video the bot confirmed as published can no longer quietly vanish. The site merges that feed into
the catalogue when the build-time variable `VITE_TELEGRAM_FEED_URL` is set (GitHub repo variable
for Pages deploys, or `.env.local` — see `.env.example`); unset, the site is unchanged. One-time
setup (~10 minutes, all free) is documented step-by-step in
[docs/telegram-bot-setup.md](docs/telegram-bot-setup.md).

What the bot does:

| Feature | How |
| --- | --- |
| Publish a forwarded video | Caption line 1 = title; `#Hashtags` guide the category and a Workers AI agent writes the description and hashtags fresh per video ([details](docs/ai-caption-agent.md)); published immediately |
| **Scrape a link into drafts** | Paste a URL: the Worker reads title, poster, description, duration, playable embed and category — and every video on a gallery page (up to 24). A page link that hides its file gets rescued: JS-player configs (including JSON-escaped ones), `data-src` lazy-loaders, percent-encoded iframe redirects and plain DOWNLOAD anchors resolve to the real `.mp4`; WordPress blogs that obfuscate their pages are read through the public REST API for the file and the real poster. Watch links on tubes with stable embeds (eporner, iceporn) and VideoPress/WordPress.com players convert to their `/embed/` player even when the page can't be read at all — and the embed page is then fetched to decorate the draft with the tube's poster and duration; anything still page-only gets its player `<iframe>` chased and scraped once for the file inside. Scraped `.mp4`s and their posters then **play through the Worker** (`stream.mp4` / `thumb.jpg` with a browser UA and the source site's Referer), so a hotlink-blocking CDN can't leave the play button dead. Re-pasting a link **repairs existing listings in place** (a page-only record gets its playable source, a poster-less one gets its poster) instead of dead-ending on a duplicate. A pasted single-post page always imports **that post**: its download link beats sidebar/logo anchors, brand-name titles are stripped (“Headline – SiteName” → “Headline”, and if the page only ever says “SiteName”, the permalink slug becomes the title). On `t.me` post links, duration and media aspect come from the post widget itself, and portrait uploads get portrait cards. Source URLs already on the site come back as duplicates instead of new drafts |
| **Review before publishing** | Draft card with ✅ Publish · ✏️ Edit title · 🏷 Category · ❌ Cancel; galleries get Publish all / Review each / Cancel all. Nothing is public until you confirm |
| **Rename** | `/rename <id> <title>`, or ✏️ Rename in the list |
| **Full list + delete** | `/videos` pages through every published video (5 per page) with Rename/Delete buttons; delete asks for confirmation |
| Drafts | `/pending` to see what is waiting; drafts expire after 7 days |
| **Switch site mode** | `/mode` — public catalogue ⇄ direct links only, applied live |
| **Admin dashboard** | `/admin/` does the same jobs in a web page, and more: mode switch, home-page redirect, ad slots (per-slot enable + preview outlines), search/filter/sort, bulk delete/recategorise, bulk link scraping, review/publish drafts, rebuild the site. Works in **both** modes |

### View counting

Every video page — `/v/<id>/` (both modes) and the catalogue's `/watch/:id` — fires
`POST /api/videos/:id/view` once per load against the Worker. The browser generates a random
session id (sessionStorage, nothing identifying), and the Worker dedupes per video per session
with a 24 h KV marker, so reloads do not inflate the number. The counter lives at `views:<id>` in
KV, ships in the public feed as `views`, and the site shows its derived placeholder until a video
has its first real view. The dashboard's Videos tab lists per-video views, sorts by
views/newest/title and totals them (`/api/admin/videos` → `viewsTotal`); deleting a video (one or
many) clears its counter.

Scraped videos are link-only: the Worker stores the source URL and metadata, never the file,
and the site plays them through its usual shielded player. Telegram bots can only fetch files
up to 20 MB, so larger files still go through public `t.me` links or a scraped embed URL.
Note that some sites block server-side requests (403 / JavaScript challenge); the bot reports
that and suggests pasting the direct embed link instead.

### Advanced management (dashboard)

Everything below lives in the `/admin/` dashboard and the Worker's KV — runtime settings, never
baked into the build, so none of it needs a rebuild:

- **Bulk link scraping** — the *Add from link* tab takes a multi-line list (up to 20 URLs, or a
  single gallery URL) and scrapes them one after another through the same `/api/admin/scrape`
  endpoint the bot uses. Each URL gets its own status as the run goes: `queued → scraping →`
  `scraped · N` / `blocked` (page refused us) / `duplicate` (its source is already published or
  drafted — the Worker reports the count). Private Telegram links (`t.me/c/…`, `t.me/+…`,
  `t.me/joinchat/…`) are refused on the spot — by the panel before any call and by the Worker
  before any fetch — with the way round: make the channel public, RE-COPY the post link (old
  `/c/` links stay member-only afterwards) and paste that; it also sidesteps the bot's 20 MB
  file cap, since a post link never passes the file through the bot.
  When the run finishes: **Publish all**, **Review each**
  (jumps to Drafts) or **Discard batch** (only the drafts this run created).
- **Bulk video management** — the *Videos* tab has search, a category filter and sorting
  (most views / newest / title A–Z), pagination, and checkbox selection with a bulk bar: delete
  many at once or recategorise the selection (`POST /api/admin/videos/bulk-delete` and
  `…/videos/bulk-patch`, one call per 200 ids). Every row shows the thumbnail, real view count,
  added date, per-row category/rename/delete, plus **copy link** (canonical `/v/<id>/` URL) and
  **open page**.
- **Ads, per slot** — each slot has its own enable next to the global toggle, and a preview mode
  outlines every slot on the live site without running third-party code (see [Ads](#ads)).
- **Views** — per-video counters in KV surfaced in the feed, the admin API and the Videos tab,
  with a total (see [View counting](#view-counting)).
- **No infinite spinners, no dashboard bounce** — every dashboard call to the Worker runs under a
  deadline (15 s, 30 s for scrapes) and page-level settings reads are cut off after 2 s, so a
  Worker that accepts the connection but never answers produces a one-line actionable error
  instead of a page stuck on "Checking…"; the message names what to check: the Worker's `/health`
  and the Pages build variable `VITE_TELEGRAM_FEED_URL`. Independently, `/admin` and `/admin/`
  are served as a plain `200` by the middleware before anything is fetched: the dashboard never
  sees a redirect — not even Pages' permanent trailing-slash `308`, which a browser that cached
  an older one would otherwise replay forever without touching the network.
- **Version tolerance** — the dashboard normalises settings/videos/drafts responses (missing
  `ads`, `slots`, `views`, `total`, `drafts` all get their defaults) so a Worker deployed from an
  older commit can't crash it: features the old Worker lacks show defaults instead of an error
  page, and a banner names the missing fields up front. Saves are **verified by read-back**: a
  toggle that the old Worker silently ignores now fails loudly ("The Worker did not save the site
  mode…") instead of flipping back on the next refresh. Redeploy the Worker to actually use them.

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
  data/seed.ts   POV Central (attribution metadata only), the 13-video catalogue, adult categories (ad arrays are empty)
  lib/store.tsx  React context store persisted to localStorage
  lib/theme.tsx  light/dark theme provider (localStorage + prefers-color-scheme)
  lib/age.ts     18+ acceptance flag and hook
  lib/avatars.ts  generated uploader avatars (data-URI SVG, see below)
  lib/video.ts   URL parsing (YouTube/Vimeo/Telegram posts/direct files), view + duration formatting
  lib/hooks.ts   click-outside, escape, page title
  lib/settings.tsx site mode context (reads /api/settings, 5-minute refresh)
  lib/admin.ts   typed client for the Worker's admin API (token in sessionStorage)
  lib/site.ts    canonical site URL, deployment base path
  lib/meta.ts    per-video <title>/description/Open Graph/VideoObject data
  Root.tsx       path router for /v/<id>/ and /admin/, hash router + mode gate otherwise
  pages/         one component per route (DirectVideoPage, AdminPage, NotFoundPage…)
scripts/
  prerender.mjs       static /v/<id>/ pages, sitemap.xml, robots.txt, 404 shell
  verify.mjs          checks the built HTML against the indexing rules
  verify:dom          mounts the app in jsdom (needs `npm i --no-save jsdom`)
functions/_middleware.ts  Pages middleware: direct-mode 302, new-video fallback
worker/               Cloudflare Worker: Telegram bot, feed, drafts, admin API, mode, redirect, ads
```

## Troubleshooting: black screen

A completely black page means the HTML loaded but the JavaScript crashed or never ran — the body
is dark and `<div id="root">` is empty. Check, in this order:

1. **Console** (`F12` → Console, reload). A red `Cannot destructure property 'basename' … as it is null`
   means a router link was rendered outside a router — that gate/wordmark bug is fixed, but the same
   class of error blanks the page. Any other red line is the cause.
2. **View source** (`Ctrl/⌘ + U`) → look at `<base href="…">`. It must match the deployment path:
   `/` on a domain root (Cloudflare Pages, Vercel), `/<repo>/` on GitHub Pages. A wrong base makes
   every asset 404 and the page stays blank.
3. **Asset 404**: copy the `assets/index-….js` name from the source and open it directly. A 404 means
   the HTML is stale — hard reload (`Ctrl+Shift+R`) or a private window.
4. **Age gate**: the 18+ interstitial renders on a first visit to any new domain. If the gate itself
   throws, nothing paints — `npm run verify:bundle` covers exactly that scenario.
5. `npm run verify:bundle` locally reproduces the visitor experience against the real build.

## Notes

- The UI is fully responsive: 4-column feed at ≥1168 px, 3/2/1 columns below, off-canvas sidebar on
  mobile, and the watch page switches to a side rail at ≥1184 px.
- There are no ad or demo videos: the seeded catalogue contains only the 13 curated link-only
  videos in `SEED_VIDEOS` — 3 POV embeds, 3 Homemade embeds, 1 Homemade Telegram post, 3 Mzansi listings and 3 DarkNaija listings
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
| `npm run build` | `tsc -b` type-check, production build, then prerender pages/sitemap/robots |
| `npm run preview` | Preview the production build |
| `npm run preview:static` | Serve `dist/` the way Pages does (directory URLs, 404 shell) |
| `npm run verify` | Assert the built site: sitemap coverage, per-page metadata, no links between videos |
| `npm run verify:render` | Server-render each video page and assert it contains no anchors/other videos |
| `npm run verify:dom` | jsdom check of the mode gate, the video page and the dashboard sign-in |
| `npm run verify:bundle` | runs the **built** bundle in jsdom: first visit, returning visitor, direct mode, unreachable/silent Worker, video page standalone in direct + its view POST + its mode-following hop when the site goes public, watch page never printing the Worker's own stream URL, dashboard (sign-in, a stalled Worker surfacing the timeout message instead of "Checking…", the signed-in videos table with views, and surviving an old Worker's settings shape), ad injection incl. per-slot switches and preview outlines. Build first with `VITE_TELEGRAM_FEED_URL=https://worker.test` — the scenarios impersonate that Worker |
| `npm run verify:middleware` | drives `functions/_middleware.ts`: which URLs 302, which never do, new-video fallback, the dashboard served with a redirect-free `200` (even offline), and that a hung Worker is cut off instead of hanging the navigation |
| `npm test --prefix .` | `node worker/test_local.mjs` — the Worker's mocked test suite |

## Deployment

The app is a static build — `npm run build` emits `dist/` with no server requirements. The
catalogue uses a **HashRouter** (`/#/watch/…`) so it works from any path, while the indexable
pages are real files: `dist/v/<id>/index.html` per video, `dist/admin/index.html`, `404.html`,
`sitemap.xml` and `robots.txt`. Set `VITE_SITE_URL` (repo variable for Pages) to the public origin
so canonical/OG URLs and the sitemap are absolute; it falls back to
`https://nior122.github.io/Afterdark`.

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
