# AfterDark

An 18+ **direct-link video site**. Every video lives on its own URL
(`/v/<id>/`) and is reachable only from that link or from `sitemap.xml`.

- No home page, no menu, no search, no categories, no grids or feeds.
- No related / suggested / up-next videos, and no autoplay of a next video.
- A video page contains the player, the title and an optional short description
  — nothing that links anywhere else on the site.
- `/` and every unknown route show a neutral 404 that lists nothing.
- Search engines discover pages through `sitemap.xml` only; there are no
  crawlable links between videos and nothing is served differently to bots.

Built with React 19 + TypeScript + Vite + Tailwind CSS v4. No database and no
file storage: videos are link-only, the catalogue is a JSON file, and an
optional Telegram bot feed adds videos published through a Cloudflare Worker.

## Quick start

```bash
npm install
npm run dev             # http://localhost:5173
npm run build           # type-check, bundle, then prerender pages + sitemap
npm run preview:static  # serve dist/ the way GitHub/Cloudflare Pages do
```

Node 18+ is required.

## How a video page is made

`npm run build` does three things:

1. `tsc -b && vite build` — the app (two routes: `/v/:id` and `*`).
2. `node scripts/prerender.mjs` — for every video, writes
   `dist/v/<id>/index.html` containing:
   - a unique `<title>` and meta description based on the video title
   - `<meta name="robots" content="index, follow">`
   - canonical URL, Open Graph and Twitter card tags (title, description, thumbnail)
   - a schema.org **VideoObject** JSON-LD block (`name`, `description`,
     `thumbnailUrl`, `uploadDate`, `contentUrl`/`embedUrl`, `duration`, `url`)
   - the app bundle, so the player works
   It also writes `dist/sitemap.xml` (every video URL, `<lastmod>` = the date
   the video was added), `dist/robots.txt` (allow all crawlers + sitemap), the
   neutral `dist/index.html`, and `dist/404.html`.
3. The video page's static HTML is a **200** response with full metadata, so a
   crawler that never runs JavaScript still sees the complete page. Rendering
   in the browser only upgrades the player; it does not change the content.

Unknown paths are served from `404.html` with a real 404 status (GitHub Pages
and Cloudflare Pages both do this automatically; no rewrite rules are used).
That keeps `/` and mistyped links out of search results.

## Add or remove a video (no UI, by design)

There is no "add video" screen — that would be a page full of controls (and a
path to browsing), which this design rules out. Add videos from the command
line instead:

```bash
# 1. paste the URL, give it a title (category optional)
node scripts/videos.mjs add "https://t.me/yourchannel/123" "My video title" Homemade \
  --thumbnail "https://example.com/poster.jpg" \
  --description "Optional short description." \
  --duration 8:31

# 2. rebuild so the page, sitemap and robots.txt are regenerated
npm run build
```

`add` generates a random 12-character id (A–Z, a–z, 0–9) so links cannot be
guessed or enumerated, and prints the new `/v/<id>/` path. Only the URL and
metadata are stored in `src/data/videos.json` — never the video file.

```bash
node scripts/videos.mjs list            # id, path and title of every video
node scripts/videos.mjs remove <id>     # unpublish, then rebuild
```

Videos published through the Telegram bot (see below) appear instantly on the
site at their own `/v/<id>/` link. They are also fetched during the build when
`VITE_TELEGRAM_FEED_URL` is set, so a redeploy puts them into `sitemap.xml` and
gives them a prerendered page too.

## Supported links

| Link type | What happens |
| --- | --- |
| `https://t.me/<public-channel>/<post>` | Telegram's protected post embed; poster is the post's real thumbnail |
| `https://…/embed/<id>/` (any embeddable player) | Sandboxed iframe behind a clean poster facade, click-shielded |
| `https://…/clip.mp4` (mp4, webm, ogg, mov, m4v) | Native HTML5 `<video>` player |
| `youtube.com/watch?v=…`, `youtu.be/…`, Shorts | `youtube-nocookie.com` embed, `rel=0` |
| `vimeo.com/123456` | Vimeo player |

**Click-shielded embeds.** Generic `/embed/…` players render through
`EmbedPlayer` with no text over the video: the iframe is not loaded until the
visitor presses our own play button, the sandbox omits
`allow-top-navigation*`/`allow-popups*` so player links and popunders cannot
redirect this page or open the source site, and the source player's title/credit
strip is cropped out and covered by an invisible shield. Telegram posts use the
same facade plus Telegram's post widget in `TelegramPlayer`. The raw source URL
is never shown as a link — there is no "open original" control.

## Telegram bot publishing (optional)

Forward a video to a Telegram bot and it is published to the site:

```
Telegram bot → Cloudflare Worker (stores Telegram file ids in KV) → public feed → site
```

The Worker (`worker/worker.js`) receives updates, exposes `/api/videos`, and
proxies playback/thumbnails so the bot token never reaches the browser. Set
`VITE_TELEGRAM_FEED_URL` to the Worker origin at build time (a Cloudflare Pages
production variable or a GitHub Actions repository variable) and the feed is
merged into the catalogue. Steps: [docs/telegram-bot-setup.md](docs/telegram-bot-setup.md).
Telegram bots can only download files up to 20 MB, so bigger videos are refused
by the bot with an explanation.

## Environment variables

| Name | Purpose |
| --- | --- |
| `VITE_SITE_URL` | Public origin of the site, no trailing slash, e.g. `https://afterdark.com` or `https://nior122.github.io/Faceverify`. Drives canonical/OG URLs, `sitemap.xml` and `robots.txt`. **Set this before submitting to search engines.** |
| `VITE_TELEGRAM_FEED_URL` | Optional Worker origin, e.g. `https://afterdark-bot.you.workers.dev`. Enables the bot feed and build-time prerendering of bot videos. |

Both are public values (they ship in the bundle) — never put the bot token or
any other secret in them. See `.env.example` for local development.

## Search Console after deploying

1. Set `VITE_SITE_URL` to the final domain and rebuild/redeploy.
2. Add the site in **Google Search Console** and **Bing Webmaster Tools** and
   verify ownership (DNS TXT record is easiest).
3. Submit `https://YOURDOMAIN/sitemap.xml` in both.
4. Check `https://YOURDOMAIN/robots.txt` references it, and request indexing for
   a video URL if you want faster discovery.

Because there are no internal links, the sitemap is the only discovery path —
that is intentional. Indexing can take a few days.

## Verify

```bash
npm run build
npm run verify          # sitemap/robots/prerendered metadata/links, from dist/
npm run verify:render   # server-renders the app and asserts no links/related videos
```

`verify` fails if a video page is missing its metadata, if `sitemap.xml` misses
a video, if `robots.txt` is wrong, or if any page links to another video.

## Project structure

```
scripts/
  prerender.mjs     builds per-video HTML, sitemap.xml, robots.txt, 404.html
  videos.mjs        owner CLI: add / remove / list videos (random ids)
  verify.mjs        post-build checks (sitemap, metadata, links)
  render-check.tsx  renders the React tree and checks it has no links
  serve-dist.mjs    static server that mimics Pages (200 pages, 404 fallback)
src/
  App.tsx           two routes: /v/:id and *
  data/videos.json  the catalogue (URL + metadata only)
  data/seed.ts      Video type, category list, catalogue loader
  lib/site.ts       SITE_URL, canonical video URLs
  lib/meta.ts       per-video title/description/OG/Twitter/JSON-LD in the browser
  lib/store.tsx     read-only catalogue (seed + Telegram feed + legacy browser videos)
  lib/video.ts      URL classification (Telegram/YouTube/Vimeo/file/embed)
  lib/telegramFeed.ts  optional bot feed
  pages/VideoPage.tsx  player + title + optional description, nothing else
  pages/NotFoundPage.tsx  neutral 404 (also served for "/")
  components/EmbedPlayer.tsx, TelegramPlayer.tsx  click-shielded players
  components/AgeGate.tsx  18+ overlay (content stays mounted for crawlers)
worker/worker.js    Telegram bot Worker (deploy separately, see docs)
```

## Deployment

The build is fully static (`dist/`). Canonical URLs assume the site is served
from `VITE_SITE_URL`, including a sub-path such as `/Faceverify`.

### GitHub Pages (workflow included)

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.
Set the repository **variable** `VITE_SITE_URL` (Settings → Secrets and
variables → Actions → Variables), e.g.
`https://nior122.github.io/Faceverify`, then re-run the workflow.

### Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git**, pick this repo.
2. Framework preset **Vite**, build command `npm run build`, output `dist`.
3. Production variables: `VITE_SITE_URL=https://your-domain` and (optional)
   `VITE_TELEGRAM_FEED_URL=https://<worker>.workers.dev`.
4. Deploy, then add the custom domain. `404.html` is picked up automatically.

### Netlify / Vercel / any static host

`netlify.toml` and `vercel.json` set the build command and `dist` output.
Copy `dist/` to any static host that serves `index.html` for directories and
`404.html` for unknown paths (S3+CloudFront, nginx with `try_files`, Firebase
Hosting, …). No server-side rendering or rewrites are required.

## Notes and limits

- **Only build-time videos are indexed.** A video added after a deploy (bot
  feed, or a link handled by `404.html`) plays for anyone with the link, but
  `sitemap.xml` cannot list it until the next build. Rebuild/redeploy after
  publishing if you want it indexed.
- Video ids for the original four catalogue entries were kept (`v-…`, e.g.
  `v-pov-tatum-christine`) so existing links do not break. Videos added with
  `scripts/videos.mjs` use random 12-character ids.
- Old hash links (`/#/watch/<id>`) are redirected to the new `/v/<id>/` page
  once, in `src/main.tsx`. Old `userVideos` entries in `localStorage`
  (`gridwatch.store.v1`) are still readable, so those links keep working; the
  site no longer writes anything to storage.
- The **18+ overlay** is rendered **on top of** the page, not instead of it, so
  crawlers see the real title/description/VideoObject markup. Visitors must
  still confirm before interacting.
- No ads, analytics, or third-party scripts are loaded. The only external
  requests are the player/poster hosts you choose and (optionally) the bot feed.
