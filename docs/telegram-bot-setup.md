# Telegram bot setup — post videos to AfterDark by forwarding them to a bot

Once set up, publishing a video is just this: **forward (or send) the video to
your Telegram bot → it appears on the website** with its real thumbnail, the
title from your caption, and — when the Worker has a Workers AI binding — a
fresh AI-written description and hashtags ([docs/ai-caption-agent.md](ai-caption-agent.md)).

How it works, in one line:

> Telegram bot → tiny free Cloudflare Worker (stores video IDs, counts views,
> streams playback) → the website reads the Worker's public feed and reports
> views back to it.

- 💸 Free (Cloudflare's free tier is plenty) · ⏱ about 10 minutes, one time
- 🔑 Your bot token goes **only** into Cloudflare's secret settings — never
  into this repo, the website code, or any chat. Treat it like a password:
  whoever has it controls the bot.
- 🎞 Telegram limits bots to files of **20 MB or smaller**. Bigger videos are
  refused by the bot with an explanation (compress them, or keep using
  public `t.me` post links for those).

---

## Step 1 — Create the bot (Telegram)

1. Open Telegram and chat with **@BotFather**.
2. Send `/newbot`, pick a display name (e.g. `AfterDark Publisher`) and a
   username ending in `bot` (e.g. `afterdark_publisher_bot`).
3. BotFather replies with a **token** like `123456789:AAH...`. Keep it handy
   for Step 4. Don't share it with anyone.

## Step 2 — Create the Worker (Cloudflare)

1. Create a free account at <https://dash.cloudflare.com> if you don't have one.
2. Go to **Workers & Pages → Create → Worker**.
3. Name it something like `afterdark-bot` (this decides its URL:
   `https://afterdark-bot.<your-subdomain>.workers.dev`) and click **Deploy**
   (it deploys a "Hello World" first — that's fine).
4. Click **Edit code**, select all the existing code, delete it, and paste in
   the entire contents of
   [`worker/worker.js`](../worker/worker.js) from this repo.
5. Click **Deploy** (top right).

## Step 3 — Add storage (KV)

1. In the Cloudflare dashboard go to **Storage & Databases → KV → Create
   namespace** and name it e.g. `afterdark-videos`.
2. Open your Worker → **Settings → Bindings → Add → KV namespace**.
3. Set **Variable name** to exactly `VIDEOS`, pick the namespace you just
   created, and **Deploy**.

## Step 4 — Add the secrets

In your Worker → **Settings → Variables and Secrets → Add**, create two
**Secret** entries:

| Name | Value |
| --- | --- |
| `BOT_TOKEN` | The token from BotFather (Step 1) |
| `WEBHOOK_SECRET` | A long random string you invent (24+ characters, letters/digits) — you'll reuse it in Step 5 |
| `ADMIN_TOKEN` | *(optional but recommended)* a long random password for the `/admin` dashboard. Without it the dashboard is disabled and only the bot can manage videos |

Click **Deploy** after adding them.

Optional, for the dashboard's **Rebuild site** button — and once set, rebuilds
become **automatic**: every publish/unpublish/repair dispatches one debounced
rebuild, so `sitemap.xml` and the static pages keep up with the bot without
you touching GitHub. Pick the row set for where your site is hosted — both
sets at once is fine and fires both. Details (and the Search Console
checklist) live in [docs/google-search-console.md](google-search-console.md).

| Name | Value |
| --- | --- |
| `GITHUB_TOKEN` | A fine-grained PAT with **Actions: read and write** on this repo (GitHub Pages) |
| `GITHUB_REPO` | `Nior122/Afterdark` (GitHub Pages) |
| `GITHUB_WORKFLOW` | `deploy.yml` (default) |
| `GITHUB_BRANCH` | `main` (default) |
| `CLOUDFLARE_BUILD_HOOK` | The URL from your Pages project's **Settings → Builds & deployment → Build hooks** (Cloudflare Pages — no tokens needed) |
| `AUTO_REBUILD` | `off` to keep the button but stop the automatic triggers (Worker **variable**) |
| `REBUILD_GAP_MS` | debounce window for the automatic trigger, default `240000` (Worker **variable**) |

## Step 5 — Point Telegram at your Worker

Open this URL in your browser (replace the two placeholders):

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_WORKER>.workers.dev/telegram/webhook&secret_token=<YOUR_WEBHOOK_SECRET>
```

You should see `{"ok":true,"result":true,...}`. (This URL contains your
token — open it only yourself, never screenshot or share it.)

## Step 6 — Test the bot

1. Open a chat with your new bot and send `/start`.
   The first person to do this becomes the **owner** — only the owner can
   publish. Do this before telling anyone the bot's username.
2. Forward any video (≤ 20 MB) to the bot, ideally with a caption like:

   ```
   My great title #Homemade
   ```

   The bot replies `✅ Posted to the website!` with the video's id.

## Step 7 — Connect the website

1. In this GitHub repo: **Settings → Secrets and variables → Actions →
   Variables tab → New repository variable**
   - Name: `VITE_TELEGRAM_FEED_URL`
   - Value: your Worker URL, e.g. `https://afterdark-bot.<you>.workers.dev`
     (this is a public URL, not a secret — it ships in the site's JavaScript)
2. Redeploy the site: **Actions → Deploy to GitHub Pages → Run workflow**
   (or push any change to `main`).

From then on, every video you forward to the bot shows up in the catalogue
automatically (give it up to a minute for caches).

---

## Daily use

Every opened video page on the site also carries an animated **Watch Full Video** button that sends
viewers to `https://t.me/KasiQueenbot` — visitors one tap away from the bot that publishes the site.
The link is a one-line constant (`TELEGRAM_CTA_URL` in `src/components/TelegramCta.tsx`); it covers
every existing and future video automatically and needs nothing from the Worker.

### Publish a video file
Forward/send a video to the bot — it is published immediately, exactly as before.

- First line of the caption = **title** (links are stripped from it; line 1 wins,
  hashtags never end up in the title even when its line has none)
- `#Hashtags` one matching a site category set the **category** —
  `#POV`, `#MILF`, `#Big_Ass`, `#4K_Ultra_HD`. No match → `Homemade`.
- With the Workers AI binding the **description and hashtags are written per
  video** by the caption agent; extra caption text and hashtags are context for
  it, not published verbatim. No binding (or `CAPTION_AGENT=off`) → a
  deterministic fallback line plus category/orientation tags. `/caption` shows
  the status — see [docs/ai-caption-agent.md](ai-caption-agent.md).
- No caption → the file name becomes the title.

### Publish from a link (scrape → review → confirm)
Paste a link (or `/add <link>`) and the bot scrapes the page:

- **One video page** → title, poster, description, duration, playable
  embed/`og:video` source and inferred category. When the page hides the file
  in a JS player config, a `data-src` attribute or a plain DOWNLOAD link, it
  is still found and used as the playable source.
- **Tube sites that block robots** (eporner, iceporn) → a watch link like
  `eporner.com/video-<id>/slug` is converted to the stable `/embed/` player
  URL even when the page itself refuses the request — the draft plays, and the
  title comes from the link slug (`viral-couple` → "Viral Couple"). Pages that
  embed a known tube's player in an `<iframe>` (including
  `…/embed/redirect?target_url=…` wrappers) get the same treatment. The embed
  page is then read once to pull the tube's real **poster** and **duration**
  into the draft — best effort, playback never depends on it.
- **Obfuscated WordPress blogs** (darknaija-style download buttons, mzansi-style page builders) → when the served
  HTML hides the file behind escaped/encoded markup, the Worker also asks the
  site's public WordPress REST API (`/wp-json/wp/v2/posts?slug=…`) — that
  usually carries the raw post content with the `.mp4` and the real poster.
- **VideoPress and other player iframes** → WordPress.com-hosted video
  (`videopress.com/v/<id>`, the usual player on `…-wordpress-com` reposts)
  maps straight to the stable `videopress.com/embed/<id>` player. If a page
  still yields no playable source, the Worker follows the post's most
  player-looking `<iframe>` (up to two, known tubes first) and scrapes *that*
  target — a file inside the player page upgrades the draft to a real
  `.mp4`. This is why "This link cannot be embedded here" keeps getting rarer:
  the record stops pointing at a page.
- **Playback goes through the Worker** → for scraped `.mp4` records the feed
  offers `…/api/videos/<id>/stream.mp4` (and the same for posters, as
  `thumb.jpg`) instead of the raw CDN URL. The Worker refetches the file with
  a browser User-Agent and the source site as Referer, forwarding Range
  requests — so CDNs that block direct playback from `afterdark` (the
  "broken link / no video when I press play" case) still play, and nothing
  visitor-visible exposes the file host.
- **Re-paste = repair** → if an old listing for that exact page was published
  before these rescues existed (it only pointed at the page and never
  played), re-sending the link **fixes the existing record in place** — source,
  poster and duration — instead of answering "already on the site". Same for a
  record that merely lacks a poster. Nothing gets duplicated.
- **A gallery / category page** → every video it can find on that page
  (up to 24), each with its own title, thumbnail, link and category.
- **Already scraped?** A source URL that is already published — or already
  waiting in a draft — comes back reported as a **duplicate** instead of
  creating a second copy of the same video.

Nothing is public yet. The bot replies with a **draft card** (or a batch
summary) and buttons:

| Button | What it does |
| --- | --- |
| ✅ Publish | Publishes that one draft |
| ✏️ Edit title | Bot asks for a new title, then shows the updated card |
| 🏷 Category | Category picker (25 site categories) |
| ❌ Cancel | Discards the draft — nothing is published |

For a gallery: **✅ Publish all**, **🔎 Review each**, or **❌ Cancel all**.
Drafts expire after 7 days and never appear on the site until published.

Some sites block server-side requests (403 / JavaScript challenge). When that
happens the bot says so and suggests the alternative: paste the direct
embed/player link (e.g. `…/embed/abc123/`), forward the file, or share a
public `t.me` post.

### Choose how the site looks: `/mode`

One switch, two personalities. It is stored in the Worker's KV and the site
reads it live, so **switching needs no rebuild**.

| Mode | What visitors get |
| --- | --- |
| **Public catalogue** (default) | Home feed, categories, search, related videos — the normal tube |
| **Direct links only** | No home page, no menus, no related videos. Each video opens only from its own link (`/v/<id>/`). Google/Bing find the pages through `sitemap.xml`, which lists every video with its `<lastmod>` date; `robots.txt` allows all crawlers and points at it. Video pages keep their unique title/description, Open Graph/Twitter tags and `VideoObject` JSON-LD |

`/mode` shows the current mode with a check mark and two buttons — tap the one
you want. Both modes keep every link working.

### Manage what is published

| Command / button | What it does |
| --- | --- |
| `/videos` (or `/list`) | Every video the bot published, paged 5 at a time, with ids, categories and durations |
| **✏️ Rename n** | Ask for a new title and save it |
| **🗑 Delete n** | Asks for confirmation, then unpublishes |
| `/rename <id> <new title>` | Rename in one message |
| `/remove <id>` | Unpublish straight away |
| `/mode` | Switch between public catalogue and direct links only; also shows the redirect and ad status |
| `/redirect <url>` | In direct mode, send the home page (and every non-video URL) to that address with a real 302. `/redirect off` clears it, `/redirect` shows the current value |
| `/ads on` · `/ads off` | Switch the site's ad slots on or off; the status line also lists slots hidden by their per-slot switch. The code itself, the per-slot switches and preview outlines live in the dashboard's **Ads** tab |
| `/pending` | Drafts still waiting for review |
| `/cancel` | Abort a pending “send me the new title” step |
| `/id` | Show your Telegram user ID (useful below) |

Renames and deletions reach the website within about a minute (the feed is
cached for 60 s).

**Note:** the bot can only manage videos it published (Telegram files and
scraped links). The catalogue videos hard-coded in the website's
`src/data/seed.ts` are part of the site build, not the feed, so they are not
editable from Telegram.

## The admin dashboard

Everything the bot does, in a web page: **`https://YOURDOMAIN/admin/`**

1. Set the `ADMIN_TOKEN` secret on the Worker (Step 4) and deploy.
2. Open `/admin/` on your site and enter that token. It is kept in the browser
   tab only (sessionStorage) — never in the site's JavaScript or in a URL.
3. You get:
   - **Site mode** — the same on/off switch as `/mode`, with a note when a
     rebuild is needed, plus the **Home-page redirect** field (applies in
     direct mode only; blank = neutral 18+ page).
   - **Ads** — paste ad code per slot (header, native, sidebar, footer, video,
     popunder) and switch ads on/off. Slots reserve their height, so the page
     never jumps; with ads off nothing renders. Each slot also has its **own
     enable switch** (instant, like the global one) — a slot renders only when
     the global toggle *and* its own switch are on, so you can run one network
     without touching another. **Preview outlines** turns every site ad slot
     into a dashed, labelled box (`on` / `off` / `empty`) so you can check
     placement across pages without executing any third-party code. All of it
     is a runtime setting — switching needs no rebuild.
   - **Videos** — the published catalogue with management built for volume:
     **search** (title, id, tag, site), a **category filter**, **sorting** by
     views / newest / title, **pagination**, and a per-row thumbnail, real view
     count and added date. **Check any rows** (or “select all” the filtered
     set) and the bulk bar appears: **delete many** or **recategorise the
     selection** in one action. Per row: rename inline, change category,
     **copy link** (the canonical `/v/<id>/` URL), **open page**, delete with a
     confirm step. The tab header shows the **total view count**.
   - **Add from link** — paste one URL or a multi-line list of up to **20** and
     press *Scrape*: each link is scraped sequentially with a live status
     (`queued → scraping → scraped · N / blocked / duplicate — already on the
     site`). A single gallery URL behaves the same way and turns into one draft
     per video found. When the run ends: **Publish all**, **Review each** (jumps
     to Drafts) or **Discard batch** — only the drafts this run created.
   - **Drafts** — edit the title/category, publish one, publish all, discard
     one or **discard all**. Nothing is public until you publish.
   - **Rebuild site** — triggers the deploy workflow (needs `GITHUB_TOKEN` +
     `GITHUB_REPO`). Use it after adding videos so their pages and the sitemap
     are regenerated — with those secrets set this also happens **automatically**
     after every publish (debounced; see the rebuild note in Step 4).

Views shown in the dashboard are the site's own counter: every video page
(`/v/<id>/` in both modes, and `/watch/:id` in the catalogue) reports a view to
the Worker once per browser session, so reloads don't inflate it and no
visitor identity is stored. Deleting a video (one or many) clears its counter.

The dashboard is `noindex` and is not linked from any video page, so it stays
out of search results.

## Optional: auto-post everything from your own channel

If you later run a channel (public *or* private) and want every video post
to appear on the site automatically:

1. Add the bot as an **administrator** of the channel (keep *Post Messages*
   on — that is what lets it see the posts).
2. Post a video in the channel. The bot will DM you the channel's numeric ID
   (nothing is published yet). That message is also proof the channel's posts
   actually reach the Worker.
3. In the Worker → **Settings → Variables and Secrets**, add a **plain
   variable** (a secret works too — both reach the Worker the same way, a
   variable is just visible when you want to edit it) named
   `ALLOWED_CHANNEL_IDS` with that ID, then **Save and Deploy**. The ID format
   is forgiving: `2188686361`, `-1002188686361` and `-100 2188686361` all
   match the same channel. Comma-separate for several channels.
4. New video posts in that channel now publish automatically — caption line 1
   becomes the title, hashtags set the category, the AI agent (when enabled)
   writes the description. Only posts containing a **video** are ingested
   (text/photo/link posts are left alone), and files over Telegram's 20 MB
   bot limit can't be pulled — post a public `t.me` link for those instead.

Re-posting the same file does not duplicate the listing, and the channel's
videos go through the same proxy as everything else, so the source channel can
stay private.

The bot's own **command menu** is registered with Telegram by itself: the
first `/start` (or any `/help`/`/menu`) syncs it once a day — no BotFather
`/setcommands` needed. `/help` lists every command; `/admin` links to the
site's dashboard (set variable `SITE_URL` to your site's origin so the link is
real).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Bot never replies | Redo Step 5 (check for typos). Verify with `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` — `url` must be your Worker URL. |
| "🚫 You are not authorised" | Someone else sent `/start` first, or you use a second account. Send `/id`, then set a Worker variable `ALLOWED_USER_IDS` to your ID and deploy. |
| Bot says posted, site doesn't show it | Wait ~1 minute; make sure Step 7's variable is set and the site was redeployed **after** setting it. Check `https://<YOUR_WORKER>.workers.dev/api/videos` in a browser — the video should be listed there. If the bot said *Published* but the video is missing from both the site **and** the admin panel, the record was stored while its index write was lost (KV is not transactional): open `https://<SITE>/admin/` once — the dashboard re-indexes stored-but-unlisted videos on load, and the current Worker verifies every index write as it goes. Older Workers never self-heal: redeploy `worker/worker.js` first, then open the dashboard. |
| "I could not read that page" | The site blocked the Worker (403/Cloudflare challenge/JS-only). Paste the direct embed link, forward the file, or use a public `t.me` post. |
| Scraped video has the wrong title | Press ✏️ Edit title on the draft card before publishing, or /rename the id afterwards. |
| Wrong category | 🏷 Category on the draft card; re-infer it from the page's keywords if they were unclear. |
| `/help` says "Unknown command", or the bot's `/` menu is empty | The Worker is old. Redeploy the latest `worker/worker.js` — current code answers `/help`/`/menu` and registers the full command menu with Telegram by itself (first `/start`). Commands like `/admin` are bot shortcuts to information; the admin dashboard itself is the **website's** `/admin` page, not a chat command. |
| Channel video posted, nothing appears | The bot must be a channel **administrator**, and the channel must be in `ALLOWED_CHANNEL_IDS` — any ID format works now (bare digits or with `-100`). If posting a video never even earned you a 📺 DM, Telegram isn't delivering `channel_post` updates: open `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` and make sure `allowed_updates` is empty or includes `channel_post` (re-run the Step 5 `setWebhook` URL exactly as documented — it subscribes to everything). |
| Dashboard says "admin-disabled" | Set the `ADMIN_TOKEN` secret on the Worker and redeploy. |
| Video's title is just the site name (e.g. “DarkNaija”) | The source blog serves bots an obfuscated shell whose only title is its own brand; the real headline never was on that markup. The current Worker strips the brand off titles (“Headline – DarkNaija” → “Headline”), ignores logo/nav anchors so they can't masquerade as the video, lets the post's own download link win over sidebar thumbnails, and falls back to the WordPress REST post title or the URL slug (`/2026/10/29/kampala-lady-josephine-…/` → “Kampala Lady Josephine …”). Re-paste the link to upgrade an already-published listing in place — no delete/re-add. |
| New video isn't in sitemap.xml yet | The static sitemap is generated at build time: with a rebuild target set on the Worker (`GITHUB_TOKEN`/`GITHUB_REPO`, or `CLOUDFLARE_BUILD_HOOK` for Cloudflare Pages) it triggers itself a few minutes after each publish (or press **Rebuild site** in the dashboard; a nightly workflow covers anything missed on the GitHub copy). On Cloudflare Pages the video is already indexable regardless — its page is built live from the feed. Direct links work immediately either way. Full matrix: [google-search-console.md](google-search-console.md). |
| GSC says “Domain property” vs “URL prefix” — which? | Domain property (DNS TXT) if you control the domain — it covers every host and protocol. URL-prefix otherwise, verified with `VITE_GOOGLE_SITE_VERIFICATION` (meta tag on every page) or by dropping Google's `google….html` file into `public/`. Then submit `sitemap.xml`. |
| Video page says “This link cannot be embedded here” with an “Open original” button | The stored record points at a page, not a playable file — either it was added via the site's Create dialog (browser-local scratchpad, not a publish path), or it was scraped before the player-config parser existed. Delete the entry, then re-send the same link to the bot / Scrape panel on the updated Worker: it now reads `sources:[{file:"…mp4"}]` JS configs (Fluid Player etc.), VideoPress/known-tube iframes, and even chases unknown player iframes to their file, and stores whatever playable source it finds. If the blog exposes no direct file at all, “Open original” is the intended behaviour. |
| Scraped video opens but **play is broken** (“no video to play”, black player) | The blog's CDN serves the file only to its own site (hotlink protection) — a raw link from `afterdark` gets refused. On the current Worker this is already handled: scraped files and posters play through `…/api/videos/<id>/stream.mp4` / `thumb.jpg` with the source site's Referer. If you still see it, the Worker is stale — paste `worker/worker.js` into it, **Save and Deploy**, then open the video again (no re-publish needed; old records start working once the Worker proxies them). |
| Telegram video shows `0:00`, or a vertical clip looks cropped in the grid | The published record predates duration/shape scraping, or the Worker is stale. Redeploy the Worker from `worker/worker.js` (dashboard paste → Save and Deploy), then delete the video and re-add its `t.me` link — the new scrape stores the real duration and the portrait dimensions, and the site draws portrait cards with an intact (letterboxed) thumbnail and a timestamp badge. No site rebuild is needed for the shape; press **Rebuild site** to refresh the prerendered page text |
| Video links stay the old way after a mode switch | A `/v/<id>/` link open **before** a switch keeps its last paint until the tab refetches settings. It now follows the mode live: on a switch to public the video page hops to the full watch experience (and back to the standalone page on a switch to direct), on mount, on tab focus, and whenever the page regains visibility. |
| Mode switch seems ignored | Check two things. (1) `VITE_TELEGRAM_FEED_URL` must be set for the **site** build — without it the site has no Worker to ask. (2) The **Worker must be at least as new as the dashboard**: an older Worker accepts the save and echoes the *old* value, so nothing persists — the dashboard now catches this with a "This Worker predates the dashboard" banner and reports "The Worker did not save the site mode" on the toggle itself. Instant workaround that works on any Worker with a mode: send `/mode public` (or `/mode direct`) to the bot. Permanent fix: redeploy `worker/worker.js`. Confirm with `https://<YOUR_WORKER>.workers.dev/api/settings` — `mode` should flip within a minute. |
| Home page does not redirect | The redirect only applies in **direct** mode, and it needs `VITE_TELEGRAM_FEED_URL` on the Pages project so `functions/_middleware.ts` can read it. Rules take up to 60 s to refresh (settings are cached at the edge). |
| Ads do not show | Ads must be switched **on** (dashboard toggle or `/ads on`), the slot must contain code, **its own per-slot switch must be on** (the Ads tab shows each slot's state), and the page must be reloaded — the site fetches settings on load. Use **preview outlines** to confirm the slot is where you expect; remember nothing renders *or runs* while previewing, so switch it off afterwards. |
| Ad code appears as text / does nothing | The slot must contain a full tag (e.g. `<script src="…"></script>`), not a bare URL. Check the browser console for the network's own error. |
| Views stay at 0 in the dashboard | Views are counted by the site, not the bot: the build must have `VITE_TELEGRAM_FEED_URL` set (otherwise the pages have no Worker to report to), the video must be in the bot feed, and each browser session counts **once** — open the link from another browser or a private window to test. The feed itself is cached for 60 s. |
| Dashboard "not responding" / stuck on **Checking…** | Every dashboard call now has a 15 s deadline, so a hung Worker reports "The Worker at … did not answer within 15 s" instead of spinning forever. That message means the `VITE_TELEGRAM_FEED_URL` baked into the site build points at an origin that accepts connections but never answers (a sleeping host, a wrong URL that still resolves). Open `https://<YOUR_WORKER>.workers.dev/health` in a browser to confirm the Worker itself is live; redeploy the Worker if it is not, or fix the Pages environment variable and re-run the site build. A fresh push to `main` also takes 1–2 minutes to deploy — hard-reload (`Ctrl+Shift+R`) before diagnosing. |
| Site / dashboard keeps **redirecting** to an old address | Two separate things, both addressed in code now. (1) The direct-mode home redirect only applies while **direct mode is on with a redirect URL set**, and it never touches `/v/<id>/`, `/admin`, assets or crawler files; turn it off with `/mode public` (or the dashboard toggle) and it is gone within 60 s — the edge caches settings for a minute. (2) Pages used to answer a bare `/admin` with a permanent `308` to `/admin/`; a browser that once cached that (or an older redirect) replays it forever without asking the network, which looks like a stuck redirect. `functions/_middleware.ts` now serves `/admin` and `/admin/` with a plain `200` **before** anything is fetched, so the dashboard can never bounce. If your browser is already holding a stale entry, clear it once: DevTools → Network → **Disable cache** and reload (or clear site data for the Pages domain) — afterwards the redirect-free replies keep it clean. |
| Sign-in lands on **"Something went wrong"** (e.g. `Cannot read properties of undefined (reading 'enabled')`) | That was the dashboard crashing on a Worker older than the site: the deployed `/api/admin/settings` didn't return the `ads`/`slots` fields the new UI read unguarded. The client now normalises such replies (the dashboard opens, showing defaults for whatever the old Worker lacks) — but to make ads, bulk actions and views actually save and count, **redeploy the Worker** from the current `worker/worker.js` (Steps 2–3, or the "Upgrading an existing Worker" note). |
| "⚠️ … up to 20 MB" | Hard platform limit: bots can only download files up to 20 MB. Re-send a compressed copy (send as *video*, not *file*, in Telegram and pick a lower quality), or **keep the big file out of the bot entirely**: post it in a **public** channel, copy the post's `https://t.me/<name>/<id>` link and add that (bot `/add <link>` or the dashboard's *Add from link*). The video then links straight to the Telegram post page — no file ever passes through the bot, any size. |
| "That is a private Telegram link" | `t.me/c/…`, `t.me/+…` and `t.me/joinchat/…` links are member-only pages — no scraper, bot or dashboard can open them, so both refuse these **instantly** with this message instead of timing out. Fix: Channel Settings → Channel Type → **Public**, then **re-copy** the post link (old `/c/` links stay member-only even after the channel goes public — the new link reads `https://t.me/<name>/<id>`). |
| Token leaked | In @BotFather send `/revoke`, put the new token in the `BOT_TOKEN` secret, repeat Step 5. Old file links keep working via the Worker. |

## Notes

- Only forward content you own or have the right to distribute.
- Local development: copy `.env.example` to `.env.local`, uncomment
  `VITE_TELEGRAM_FEED_URL`, run `npm run dev`.
- Worker logic tests (no accounts needed): `node worker/test_local.mjs`.
- CLI alternative to the dashboard: `worker/wrangler.toml` + `npx wrangler deploy`.
