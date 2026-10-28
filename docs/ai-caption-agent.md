# AI caption agent

The Telegram bot Worker includes a bounded caption agent built on
[Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). It
writes a **short, non-explicit text caption/description** for Telegram video
uploads and, when the upload has no owner-supplied hashtags, generates hashtags
too. It is **not** speech-to-text subtitles: nothing is timed to the audio and
no WebVTT track is produced.

The generated caption is stored in the video's `description` field, appears on
the watch page and in video metadata, and is included in the public feed and
admin API.

## What it does

For each eligible Telegram upload, the Worker:

1. Reads the caption, title, file name, duration and pixel dimensions.
2. Optionally downloads the Telegram poster image and asks a vision model for
   a short, non-explicit visual hint (setting, framing, orientation, lighting).
3. Asks a text model for a caption of up to 280 characters and — when needed —
   2–6 hashtags from a fixed vocabulary.
4. Sanitises the caption, filters hashtags through the site's category/format
   allow-list, removes duplicates, and saves both fields in KV.
5. Exposes `captionSource` and `hashtagSource` on the feed/admin API so the
   dashboard can mark AI-written rows.

### What the owner supplies still wins

| Owner input | Agent behaviour |
| --- | --- |
| Caption line 1 | Becomes the title, exactly as before. |
| Extra caption lines | Become the owner description; no AI caption is generated. |
| `#Hashtags` in the caption or file name | Become tags/category; no AI hashtags are generated. |
| No description and no hashtags | The agent writes both. |
| Owner description + owner hashtags | No model call at all. |

The primary category is **not** changed by the agent. AI hashtags still affect
search and category browsing because `videoMatchesCategory()` also matches
tags. Only new Telegram uploads are processed; existing KV records are not
backfilled automatically.

## Inputs and privacy

The agent never receives the bot token, a video file ID, viewer data, or the
video/audio stream. The text model receives:

- caption (max 500 characters),
- title and file name (max 180 characters each),
- category, duration, resolution and orientation,
- deterministic metadata tags,
- the one-sentence poster hint, when enabled.

The poster image itself is streamed from Telegram to Workers AI and is never
stored in KV, the public feed, or the site bundle. Set
`CAPTION_AGENT_VISION_MODEL=off` to keep the agent text-only. The prompt treats
all metadata as untrusted data, captions are sanitised, and the hashtag
allow-list prevents prompt injection from putting arbitrary text into the
catalogue.

## Setup

### If you deploy with Wrangler

`worker/wrangler.toml` already contains:

```toml
[ai]
binding = "AI"

[vars]
CAPTION_AGENT = "on"
```

Deploy as usual:

```bash
cd worker
npx wrangler deploy
```

### If you paste `worker/worker.js` into the Cloudflare dashboard

1. Open your Worker → **Settings → Bindings → Add**.
2. Choose **Workers AI** (in some dashboards: **AI binding**).
3. Set the variable name to exactly `AI` and deploy.
4. Optional: add the variables below under **Variables and Secrets**.

No API key is required: the binding authenticates Workers AI calls. Workers AI
usage counts against your Cloudflare account's allocation; check
[Cloudflare's pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
for current limits.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CAPTION_AGENT` | `on` | Set to `off` to skip all model calls and use a deterministic caption/tags. |
| `CAPTION_AGENT_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Text model used for the caption and hashtags. |
| `CAPTION_AGENT_VISION_MODEL` | `@cf/llava-hf/llava-1.5-7b-hf` | Poster image-to-text model. Set to `off` for text-only captions. |

The previous `HASHTAG_AGENT`, `HASHTAG_AGENT_MODEL` and
`HASHTAG_AGENT_VISION_MODEL` names are still accepted as aliases, so an older
Worker configuration keeps working.

Model IDs are configurable because Cloudflare rotates its catalogue. The text
default supports [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/);
if a custom model rejects the structured response format, the Worker retries
once in plain chat mode. Check the current
[model catalogue](https://developers.cloudflare.com/workers-ai/models/) before
overriding either ID.

## Failure behaviour

Publishing never depends on AI. The Worker uses short timeouts and catches every
model, network and parsing error. The bot confirmation shows the AI caption and
hashtags it used, and says when any fallback text was substituted — including a
partial success where the caption worked but no hashtags passed the allow-list.
Both `captionSource` and `hashtagSource` can be:

| Value | Meaning |
| --- | --- |
| `ai` | Model returned a usable caption / at least one allow-listed tag. |
| `owner` | Owner supplied the description / hashtags; no model output used. |
| `fallback` | Model failed, timed out, or returned no usable output. |
| `unconfigured` | No `AI` binding on this Worker. |
| `disabled` | `CAPTION_AGENT=off` (or the legacy alias). |
| `skipped` | Too large for Telegram's bot feed; not published. |
| `manual` | Field was edited through the admin API. |
| `legacy` | Video was stored before this feature existed. |

Fallback captions are neutral catalogue lines such as
`New Homemade clip · 1:14 · vertical. Added to AfterDark. Homemade · Telegram · Vertical Video.`
Fallback tags always include the category and `Telegram` plus verifiable format
tags.

## Verify it

Send `/caption` to the bot (or `/hashtags`, which is kept as an alias): it
reports whether the `AI` binding is present, the text model in use, and whether
the poster hint is enabled. A Telegram upload with no description and no
hashtags should then produce `📝 AI caption:` and `🏷 AI hashtags:` lines in the
bot reply. The caption is visible on the video's watch page.

```bash
npm test
```

The mocked Worker suite covers: AI captions and hashtags, owner text winning,
admin API provenance, off switches and legacy aliases, model failure, missing
binding, text-only mode, duplicates and oversized files. No Cloudflare account
or network access is needed for these tests.
