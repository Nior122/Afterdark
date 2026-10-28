# Cloudflare setup — a slow, click-by-click walkthrough

This is the beginner version of [telegram-bot-setup.md](telegram-bot-setup.md):
same thing, but every click is spelled out, with checkpoints so you know a step
worked before moving on.

You are setting up **three** things that talk to each other:

```
Telegram bot  ──►  Cloudflare Worker  ◄──  the website (GitHub Pages)
 (you send          (stores video ids,      (reads the Worker's feed,
  videos here)       serves the feed,        and asks it which site mode
                     runs the dashboard)     is on)
                            │
                            └──► Workers AI (optional caption agent)
```

Nothing is installed on your computer. Everything happens in a browser. The
Workers AI branch is optional: without it, videos still publish with a simple
fallback caption and tags derived from their metadata.

**Time:** about 15 minutes the first time.
**Cost:** nothing (Cloudflare's free tier covers this many times over).

---

## Before you start — collect these

| You need | Where to get it | Notes |
| --- | --- | --- |
| A Cloudflare account | <https://dash.cloudflare.com/sign-up> | Free. Email + password only |
| Your bot token | Telegram → **@BotFather** → `/newbot` | Looks like `123456789:AAH…`. **Secret** |
| Your Telegram account | The app on your phone | This will be the "owner" who can publish |
| Access to the GitHub repo | `Nior122/Afterdark` | You already have it |

> 🔒 **Never paste your bot token, your `ADMIN_TOKEN` or your `WEBHOOK_SECRET`
> into this chat, a screenshot, an issue, or the website code.** They go only
> into Cloudflare's secret fields. If you want me to check your work, send me
> the **Worker URL** (`https://something.something.workers.dev`) — that one is
> public and harmless.

---

## Already have the Worker and bot? You only *update* it

Nothing gets recreated. The Worker is the same Worker, the KV namespace is the
same namespace, the bot token and webhook stay exactly as they are — you are
only replacing the code inside it, adding one secret and (optionally) turning
on Workers AI. **Five minutes, four steps.**

1. Cloudflare → **Workers & Pages** → click your existing worker (e.g.
   `afterdark-bot`).
2. **Edit code** → click in the editor → `Ctrl/⌘ + A` → `Delete` → paste the
   latest <https://raw.githubusercontent.com/Nior122/Afterdark/arena/512b1aba-afterdark/worker/worker.js>
   → **Deploy**.
3. **Settings** → **Variables and Secrets** → **Add** → **Secret** →
   `ADMIN_TOKEN` = a long random string you invent (this is the dashboard
   password) → **Deploy**.
4. **Optional — automatic captions:** **Settings → Bindings → Add → Workers
   AI**, variable name exactly `AI`, then **Deploy**. No API key is needed.
   Skip this and uploads still publish with a fallback caption and tags.
   Details: [ai-caption-agent.md](ai-caption-agent.md).

Then check it worked:

| Open | Old code | Updated code |
| --- | --- | --- |
| `/health` | `ok` | `ok` |
| `/api/settings` | `Not found` (404) | `{"mode":"public","modes":["public","direct"],"updatedAt":…}` |

| Keep exactly as it is | Why |
| --- | --- |
| Worker **name** | Its URL is already wired into the website |
| KV namespace + `VIDEOS` binding | All published videos live there |
| `BOT_TOKEN`, `WEBHOOK_SECRET` secrets | Re-adding them is harmless but pointless |
| The `setWebhook` call from Part 5 | The URL hasn't changed — **do not re-run it** |
| Your owner account (`/start`) | Stored in KV; untouched |
| Repo variable `VITE_TELEGRAM_FEED_URL` | Already pointing at this Worker |

Do **not** delete the Worker, create a second KV namespace, or run `/start`
again — none of that is needed, and a second namespace is how people lose
their video list.

The **website** side is already updated: merging the new code rebuilt and
redeployed `nior122.github.io/Afterdark`, which is where `/v/<id>/`,
`sitemap.xml`, `/robots.txt` and `/admin/` came from. If the feed was working
before, it keeps working.

If anything looks wrong after the update, Cloudflare keeps previous versions
under your Worker's **Deployments** tab — you can roll back in one click.

---

## Part 1 — Cloudflare account and your `.workers.dev` address

1. Sign in at <https://dash.cloudflare.com>.
2. In the left sidebar click **Workers & Pages** (newer dashboards call this
   **Compute (Workers)**).
3. The first time, Cloudflare asks you to **choose a subdomain** — something
   like `yourname`. This becomes part of every Worker URL:
   `https://<worker-name>.<yourname>.workers.dev`.
4. Pick it, accept, and continue.

✅ **Checkpoint:** the page now shows a **Create** / **Create application**
button. That's the whole of Part 1.

---

## Part 2 — Create the Worker and paste the code

1. Click **Create** → **Workers** → **Create Worker** (older UI:
   **Create application** → **Create Worker**).
2. **Name:** `afterdark-bot` (lowercase, dashes only — the name becomes part of
   the URL). Leave the rest alone.
3. Click **Deploy**. It publishes a "Hello World" — that is expected.
4. Now click **Edit code** (or **Continue to project** → **Edit code**).
5. In the editor: click inside the code area, press `Ctrl/⌘ + A` to select all,
   press `Delete` so the box is completely empty.
6. Open the bot's source in a new tab:
   👉 <https://raw.githubusercontent.com/Nior122/Afterdark/arena/512b1aba-afterdark/worker/worker.js>
   Select everything there (`Ctrl/⌘ + A`), copy it, and paste it into the
   Cloudflare editor.
7. Click **Deploy** (top right). Wait for "Deployed" / "Success".

✅ **Checkpoint:** open this in a new browser tab, with your own subdomain:

```
https://afterdark-bot.<yourname>.workers.dev/health
```

You should see exactly `ok` on a blank page.
If you see `Hello World` instead, the paste didn't take — repeat steps 5–7.

---

## Part 3 — Give the Worker a place to store data (KV)

The Worker does not keep videos; it keeps small records (ids, titles,
categories) in Cloudflare **KV**.

1. Sidebar → **Storage & Databases** → **KV** (older UI: **Workers & Pages →
   KV**) → **Create namespace**.
2. **Namespace name:** `afterdark-videos` → **Add**.
3. Go back to your Worker → **Settings** → **Bindings** (older UI:
   **Settings → Variables → KV Namespace Bindings**).
4. **Add** → **KV namespace**.
   - **Variable name:** `VIDEOS` — exactly this, all capitals. The code looks
     for this name; a typo here breaks everything later.
   - **KV namespace:** pick `afterdark-videos`.
5. Click **Save** / **Deploy** so the binding takes effect.

✅ **Checkpoint:** the Worker's **Settings → Bindings** list now shows
`VIDEOS → afterdark-videos`.

---

## Part 3b — Turn on AI captions (optional, one more binding)

The site and bot work without this, using fallback text. With it, every
eligible Telegram video gets a fresh AI-written description with emojis and
2–6 hashtags, even if you supplied caption text or hashtags. The first caption
line remains the title; links are removed from the caption.

1. Still in your Worker → **Settings → Bindings → Add**.
2. Choose **Workers AI** (or **AI binding**). Set **Variable name** to exactly
   `AI`.
3. Click **Save** / **Deploy**.

✅ **Checkpoint:** **Settings → Bindings** now lists both `VIDEOS` and `AI`.
Send `/caption` to the bot; it should answer `Status: on` with the model name.
Then send a new video with any caption or hashtags; the reply contains
`📝 AI caption:` and `🏷 AI hashtags:` lines. If Workers AI is unavailable, the
reply says it used fallback text instead — publishing is never blocked.

No API key is needed. Workers AI has its own account-level usage allocation;
see [ai-caption-agent.md](ai-caption-agent.md) to switch the agent off, make it
text-only, or change model IDs.

---

## Part 4 — Add the secrets (the passwords of this setup)

Worker → **Settings** → **Variables and Secrets** → **Add** → type **Secret**
(not "Text") for each row below.

| Name (exact) | What to put |
| --- | --- |
| `BOT_TOKEN` | the token from BotFather — paste it, no spaces |
| `WEBHOOK_SECRET` | a long random string **you invent**: 30+ letters and digits, no spaces (e.g. mash the keyboard, then add `7Kq` in the middle). You will paste this again in Part 5 |
| `ADMIN_TOKEN` | a **different** long random string — this is the password for your `/admin/` dashboard. 30+ characters |

Two beginner-proof rules:

- **Secret**, never **Text**: variables of type "Text" are readable in the
  dashboard by anyone with access; secrets are write-only.
- Write `WEBHOOK_SECRET` and `ADMIN_TOKEN` down in your phone's notes (or a
  password manager) before you click save — Cloudflare will not show them again.

Click **Add** after each one, then **Deploy**.

Optional — only if you want the dashboard's **Rebuild site** button (it
regenerates `sitemap.xml` without opening GitHub):

| Name | Value |
| --- | --- |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token → *Only select repositories:* `Nior122/Afterdark` → *Repository permissions* → **Actions: Read and write** → generate → copy `github_pat_…` |
| `GITHUB_REPO` | `Nior122/Afterdark` |

✅ **Checkpoint:** **Settings → Variables and Secrets** lists `BOT_TOKEN`,
`WEBHOOK_SECRET`, `ADMIN_TOKEN` (and optionally the two GitHub ones) with the
word **Secret** next to them.

---

## Part 5 — Tell Telegram where your Worker is

Telegram must forward messages to your Worker. You do that once, with a URL.

1. Copy the text below into your browser's address bar and replace **four**
   placeholders — `<BOT_TOKEN>`, `<YOURNAME>`, `<WORKER-NAME>` (if you used
   `afterdark-bot`, it's already right) and `<WEBHOOK_SECRET>`:

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://afterdark-bot.<YOURNAME>.workers.dev/telegram/webhook&secret_token=<WEBHOOK_SECRET>
```

2. Press Enter.

✅ **Checkpoint:** the page shows `{"ok":true,"result":true,"description":"Webhook was set"}`.

- `{"ok":false,...}` → the token or the secret has a typo, or a space slipped in.
- `401`/blank page → you left the angle brackets `< >` in the URL.

> ⚠️ That URL contains your bot token, so it is now in your browser history.
> That's fine and normal — just don't share the address bar or a screenshot.

Optional sanity check (safe to share): open
`https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo` and look for
`"last_error_message"`. No error means Telegram is reaching your Worker.

---

## Part 6 — Claim the bot and try the new switch

1. Open Telegram, find your bot, send **`/start`**.
   The **first** person to do this becomes the owner. Do it now, from your own
   account, before sharing the bot's username with anyone.
2. Send **`/mode`**. You should get a card with two buttons:
   **Public catalogue** (✓) and **Direct links only**.
3. Tap **Direct links only**, then tap **Public catalogue** again. That is the
   whole toggle — it is stored in your Worker, so it can never be lost by a
   website rebuild.
4. Send **`/videos`** — it lists published videos, or says the list is empty.

✅ **Checkpoint:** `/mode` answers and the check mark moves when you tap.
If the bot stays silent, jump to **Troubleshooting** below.

---

## Part 7 — Connect the website to your Worker

The site is a static build; it learns the Worker's address at build time.

1. GitHub → `Nior122/Afterdark` → **Settings** → **Secrets and variables** →
   **Actions** → tab **Variables** → **New repository variable**.
   - **Name:** `VITE_TELEGRAM_FEED_URL`
   - **Value:** `https://afterdark-bot.<YOURNAME>.workers.dev` — no trailing
     slash, no `/api/videos` on the end.
2. *(Only if you use a custom domain)* add a second variable
   **`VITE_SITE_URL`** = `https://yourdomain.com`. Skip this while the site is
   on `nior122.github.io/Afterdark`.
3. Go to the **Actions** tab → **Deploy to GitHub Pages** (left side) →
   **Run workflow** → **Run workflow** (green button). Wait ~1 minute for the
   green tick.

✅ **Checkpoint:** open <https://nior122.github.io/Afterdark/admin/> and you
should see **Owner sign-in**.

---

## Part 8 — Sign in to the dashboard

1. Open `https://nior122.github.io/Afterdark/admin/`.
2. Paste your **`ADMIN_TOKEN`** (the one you invented in Part 4) → **Sign in**.
3. You now have, on one page:
   - **Site mode** — the same toggle as `/mode` in the bot, with a switch.
   - **Videos** — rename, change category, delete.
   - **Add from link** — paste a URL to scrape it into drafts.
   - **Drafts** — edit / publish / publish all / discard.
   - **Rebuild site** — regenerates the video pages and `sitemap.xml`
     (needs `GITHUB_TOKEN` + `GITHUB_REPO` from Part 4).

✅ **Checkpoint:** the Videos tab lists what the bot published.

> The dashboard token is kept only in that browser tab. Closing the tab signs
> you out; that's intended. There is nothing to "log out" of.

---

## Part 9 — Where to look afterwards

| Page | What it is |
| --- | --- |
| `https://nior122.github.io/Afterdark/` | the site (catalogue, or the neutral page when direct mode is on) |
| `https://nior122.github.io/Afterdark/v/<id>/` | one video, shareable and indexable |
| `https://nior122.github.io/Afterdark/admin/` | your dashboard |
| `https://afterdark-bot.<you>.workers.dev/health` | Worker alive check |
| `https://afterdark-bot.<you>.workers.dev/api/settings` | what mode is currently on |

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `/health` shows `Hello World` | The code paste didn't replace everything. Part 2, steps 5–7 |
| `/health` shows `ok` but the bot never answers | Webhook not set or wrong secret → redo Part 5, then check `getWebhookInfo` |
| Bot answers `/start` with "not the owner" | Someone else already claimed it. Send `/start` from that account, or delete the `cfg:owner` key in KV (Storage → KV → `afterdark-videos` → `cfg:owner` → Delete) and send `/start` again |
| `/mode` says the switch is unavailable | The Worker is running old code. Re-paste the latest `worker/worker.js` and Deploy |
| `/videos` works but the site shows nothing new | Part 7 step 1–3: the `VITE_TELEGRAM_FEED_URL` variable, then re-run the deploy workflow |
| Dashboard says "admin-disabled" | `ADMIN_TOKEN` secret missing on the Worker → add it and Deploy |
| Dashboard says "Wrong token" | Typo, or a trailing space when pasting. Paste again carefully |
| Dashboard loads but every tab is empty and the console shows CORS | The Worker URL variable has a trailing slash or a path. It must be exactly `https://…workers.dev` |
| Mode switch flips, but the site keeps showing the catalogue | The site build has no `VITE_TELEGRAM_FEED_URL` (Part 7), or you're looking at a cached tab — reload it |
| New video is missing from `sitemap.xml` | Sitemaps are rebuilt at build time. Press **Rebuild site** in the dashboard (Part 4 GitHub secrets needed) or re-run the deploy workflow |
| "Too large" when forwarding a video | Telegram bots cannot download files over 20 MB. Compress it, or post a `t.me` link instead |
| Bot says "used a safe fallback caption and tags" | The `AI` binding is missing, the model timed out, or Workers AI quota was reached. The video is still published with neutral text. Check Part 3b and [ai-caption-agent.md](ai-caption-agent.md) |
| No `📝 AI caption` line on a new upload | The upload was a duplicate, `CAPTION_AGENT=off`, or the AI binding/model is unavailable (check for the fallback warning). New caption text is replaced by AI output |
| No `🏷 AI hashtags` line on a new upload | The upload was a duplicate, `CAPTION_AGENT=off`, or the AI binding/model is unavailable. Owner hashtags do not prevent AI tag generation |

---

## Hard rules (the ones that waste an evening if broken)

1. Secrets go in **Secret** fields only — never in the code, never in chat.
2. After changing a binding, secret, or variable on the Worker, click
   **Deploy** again. Changes without a deploy are not live.
3. The KV binding name must be exactly `VIDEOS`.
4. The optional Workers AI binding name must be exactly `AI`.
5. The site variable is the Worker **origin** only — no path, no slash.
6. `ADMIN_TOKEN` and `WEBHOOK_SECRET` must be different strings.

---

## Tear-down (if you ever want it gone)

Cloudflare dashboard → your Worker → **Settings** → **Delete**; then KV →
`afterdark-videos` → delete. The site falls back to its built-in catalogue and
public mode. Nothing on the website needs changing.
