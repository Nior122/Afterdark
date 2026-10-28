# Telegram bot setup — post videos to AfterDark by forwarding them to a bot

Once set up, publishing a video is just this: **forward (or send) the video to
your Telegram bot → it appears on the website** with its real thumbnail, title
from the caption, an AI-written description when you did not supply one, and
AI-suggested tags when you supply no hashtags.

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

## Step 3b — Enable automatic AI captions (optional)

The Worker works without this step; uploads get a deterministic fallback
caption and tags. To let the AI agent write a short description and suggest
missing hashtags:

1. In your Worker go to **Settings → Bindings → Add → Workers AI**
   (some dashboards call it an **AI binding**).
2. Set **Variable name** to exactly `AI` and **Deploy**. No API key is needed.
3. Optional variables under **Settings → Variables and Secrets**:
   `CAPTION_AGENT=off` disables the agent, and
   `CAPTION_AGENT_VISION_MODEL=off` keeps it text-only. Model IDs can also be
   overridden there; see [ai-caption-agent.md](ai-caption-agent.md).

Workers AI usage counts against your Cloudflare account's allocation. The agent
sends only text metadata and — unless disabled — the Telegram poster image to
Cloudflare; it never sends the bot token, viewer data or the video/audio stream.

## Step 4 — Add the secrets

In your Worker → **Settings → Variables and Secrets → Add**, create two
**Secret** entries:

| Name | Value |
| --- | --- |
| `BOT_TOKEN` | The token from BotFather (Step 1) |
| `WEBHOOK_SECRET` | A long random string you invent (24+ characters, letters/digits) — you'll reuse it in Step 5 |
| `ADMIN_TOKEN` | *(optional but recommended)* a long random password for the `/admin` dashboard. Without it the dashboard is disabled and only the bot can manage videos |

Click **Deploy** after adding them.

Optional, for the dashboard's **Rebuild site** button (needed to put new videos
into `sitemap.xml` without touching GitHub):

| Name | Value |
| --- | --- |
| `GITHUB_TOKEN` | A fine-grained PAT with **Actions: read and write** on this repo |
| `GITHUB_REPO` | `Nior122/Afterdark` |
| `GITHUB_WORKFLOW` | `deploy.yml` (default) |
| `GITHUB_BRANCH` | `main` (default) |

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

### Publish a video file
Forward/send a video to the bot — it is published immediately, exactly as before.

- First line of the caption = **title**
- Extra caption lines = **description**; the AI will not replace them.
- `#Hashtags` = **tags**; one matching a site category sets the
  **category** — use underscores for multi-word ones: `#POV`, `#MILF`,
  `#Big_Ass`, `#Big_Tits`, `#4K_Ultra_HD`. No match → `Homemade`.
- No caption → the file name becomes the title.
- **No description** → the AI agent writes a short, non-explicit caption. It
  appears on the watch page; the bot reply shows it as `📝 AI caption: …`.
- **No hashtags** → the same agent suggests 2–6 allow-listed site tags. The bot
  reply shows them as `🏷 AI hashtags: #POV #Amateur`. Owner text and tags are
  never replaced; if Workers AI is unavailable the video still publishes with
  a fallback caption and tags. See
  [ai-caption-agent.md](ai-caption-agent.md) for setup and privacy details.

### Publish from a link (scrape → review → confirm)
Paste a link (or `/add <link>`) and the bot scrapes the page:

- **One video page** → title, poster, description, duration, playable
  embed/`og:video` source and inferred category.
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
| `/caption` (`/hashtags` also works) | Show whether the AI caption agent is configured and which model it uses |
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
     are regenerated.

Views shown in the dashboard are the site's own counter: every video page
(`/v/<id>/` in both modes, and `/watch/:id` in the catalogue) reports a view to
the Worker once per browser session, so reloads don't inflate it and no
visitor identity is stored. Deleting a video (one or many) clears its counter.

The dashboard is `noindex` and is not linked from any video page, so it stays
out of search results.

## Optional: auto-post everything from your own channel

If you later run a channel (public *or* private) and want every video post
to appear on the site automatically:

1. Add the bot as an **administrator** of the channel.
2. Post a video in the channel. The bot will DM you the channel's numeric ID
   (nothing is published yet).
3. In the Worker → **Settings → Variables and Secrets**, add a plain variable
   `ALLOWED_CHANNEL_IDS` with that ID (comma-separated for several) and deploy.
4. New video posts in that channel now publish automatically.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Bot never replies | Redo Step 5 (check for typos). Verify with `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` — `url` must be your Worker URL. |
| "🚫 You are not authorised" | Someone else sent `/start` first, or you use a second account. Send `/id`, then set a Worker variable `ALLOWED_USER_IDS` to your ID and deploy. |
| Bot says posted, site doesn't show it | Wait ~1 minute; make sure Step 7's variable is set and the site was redeployed **after** setting it. Check `https://<YOUR_WORKER>.workers.dev/api/videos` in a browser — the video should be listed there. |
| "I could not read that page" | The site blocked the Worker (403/Cloudflare challenge/JS-only). Paste the direct embed link, forward the file, or use a public `t.me` post. |
| Scraped video has the wrong title | Press ✏️ Edit title on the draft card before publishing, or /rename the id afterwards. |
| Wrong category | 🏷 Category on the draft card; re-infer it from the page's keywords if they were unclear. |
| Dashboard says "admin-disabled" | Set the `ADMIN_TOKEN` secret on the Worker and redeploy. |
| New video isn't in sitemap.xml yet | The sitemap is generated at build time. Press **Rebuild site** in the dashboard (or re-run the deploy workflow) after publishing. Direct links work immediately either way. |
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
