# Telegram bot setup — post videos to AfterDark by forwarding them to a bot

Once set up, publishing a video is just this: **forward (or send) the video to
your Telegram bot → it appears on the website** with its real thumbnail, title
from the caption and category from a hashtag.

Each published video has its own direct link — `https://YOURDOMAIN/v/<id>/` —
and nothing on the site links to it. Share that link with whoever should watch
it; search engines find it through `sitemap.xml` after the next build.

How it works, in one line:

> Telegram bot → tiny free Cloudflare Worker (stores video IDs, streams
> playback) → the website reads the Worker's public feed.

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

Click **Deploy** after adding them.

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

Set two **build-time** variables wherever the site is built, then redeploy:

| Variable | Value |
| --- | --- |
| `VITE_SITE_URL` | The public origin of the site, e.g. `https://afterdark.com` or `https://nior122.github.io/Faceverify` (no trailing slash) |
| `VITE_TELEGRAM_FEED_URL` | Your Worker origin, e.g. `https://afterdark-bot.<you>.workers.dev` |

- **Cloudflare Pages:** Pages project → **Settings → Variables and secrets →
  Production** → add both → **Deployments → Retry deployment** (variables are
  applied at build time, so an existing deployment must be rebuilt).
- **GitHub Pages:** repo → **Settings → Secrets and variables → Actions →
  Variables** → add both → **Actions → Deploy to GitHub Pages → Run workflow**.

Both are public values — they ship in the site's JavaScript. The bot token and
`WEBHOOK_SECRET` stay only in the Worker's secret settings.

From then on, every video you forward to the bot is playable at
`https://YOURDOMAIN/v/<id>/` right away (give it up to a minute for caches).
Its page is prerendered and added to `sitemap.xml` on the next build, so
redeploy when you want newly published videos indexed.

---

## Daily use

- **Publish:** forward/send a video to the bot.
  - First line of the caption = **title**
  - `#Hashtags` = **tags**; one matching a site category sets the
    **category** — use underscores for multi-word ones: `#POV`, `#MILF`,
    `#Big_Ass`, `#Big_Tits`, `#4K_Ultra_HD`. No match → `Homemade`.
  - No caption → the file name becomes the title.
- **`/list`** — see your latest published videos and their ids.
- **`/remove tg-xxxxxxxxxxxx`** — take a video off the website (its `/v/<id>/`
  link stops working).
- **`/id`** — show your Telegram user ID (useful below).

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
| Bot says posted, but the `/v/<id>/` link 404s | Wait ~1 minute; make sure `VITE_TELEGRAM_FEED_URL` is set **and the site was rebuilt after setting it**. Check `https://<YOUR_WORKER>.workers.dev/api/videos` — the video should be listed there. |
| "⚠️ … up to 20 MB" | The video is too big for Telegram bots. Re-send a compressed copy (send as *video*, not *file*, in Telegram and pick a lower quality), or publish that one via a public `t.me` link instead. |
| Token leaked | In @BotFather send `/revoke`, put the new token in the `BOT_TOKEN` secret, repeat Step 5. Old file links keep working via the Worker. |

## Notes

- Only forward content you own or have the right to distribute.
- Local development: copy `.env.example` to `.env.local`, set
  `VITE_SITE_URL=http://localhost:5173` and `VITE_TELEGRAM_FEED_URL`, then run
  `npm run dev` and open `/v/<id>/`.
- Worker logic tests (no accounts needed): `node worker/test_local.mjs`.
- CLI alternative to the dashboard: `worker/wrangler.toml` + `npx wrangler deploy`.
