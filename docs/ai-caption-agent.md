# AI caption agent

The Telegram bot Worker includes a bounded caption agent built on
[Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). For
every eligible Telegram video upload it writes a **fresh, short,
non-explicit description with one or two emojis and 2–6 hashtags**, even if
you supplied a caption or hashtags. The first caption line remains the video
title; extra caption text and supplied hashtags are context only. URLs are
stripped before caption text is used or published. This is **not**
speech-to-text subtitles: nothing is timed to the audio and no WebVTT track is
produced.

The generated description includes hashtag text on its own line and is stored in
the video's `description` field, so it appears on the watch page and in video
metadata, the public feed and admin API. The hashtags are also stored in the
searchable `tags` field.

## What it does

For each eligible Telegram upload, the Worker:

1. Keeps the first caption line as the title, strips URLs from the caption, and
   gathers the remaining caption text, file name, duration and pixel dimensions
   as model context.
2. Optionally downloads the Telegram poster image and asks a vision model for
   a short, non-explicit visual hint (setting, framing, orientation, lighting).
3. Always asks the text model for a fresh caption (up to 280 characters) with
   one or two emojis and 2–6 hashtags from a fixed vocabulary.
4. Sanitises the caption, filters hashtags through the site's category/format
   allow-list, removes duplicates, appends hashtags to the description, and
   saves the description/tags in KV.
5. Exposes `captionSource` and `hashtagSource` on the feed/admin API so the
   dashboard can mark AI-written rows.

### How uploaded caption text is handled

| Telegram input | Agent behaviour |
| --- | --- |
| First caption line | Kept as the video title and used as model context. |
| Extra caption lines | Used as context; the AI-generated description replaces them. |
| `#Hashtags` in the caption or file name | Used as context/category evidence; AI hashtags replace them when AI succeeds. |
| Link in caption (`https://…`, `www.…`, `t.me/…`) | URL is removed before title parsing, model input and publication; other words remain. |
| Any new Telegram upload | Gets an AI-written caption and hashtag set (except duplicates, oversized files, or when the agent is off/unconfigured). |

The primary category is inferred from the caption but is not changed by the
agent. AI hashtags affect search and category browsing because
`videoMatchesCategory()` also matches tags. Only new Telegram uploads are
processed; existing KV records are not backfilled automatically.

## Inputs and privacy

The agent never receives the bot token, a video file ID, viewer data, or the
video/audio stream. URLs are removed from uploaded caption text before the
model sees it. The text model receives:

- sanitized caption (max 500 characters),
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
If the model is unavailable, owner-supplied hashtags may be retained as
fallback tags, but the description still uses a neutral fallback caption.
Both `captionSource` and `hashtagSource` can be:

| Value | Meaning |
| --- | --- |
| `ai` | Model returned a usable caption / at least one allow-listed tag. |
| `owner` | Owner-supplied hashtags were retained as fallback tags, or an older record used owner text. |
| `fallback` | Model failed, timed out, or returned no usable output. |
| `unconfigured` | No `AI` binding on this Worker. |
| `disabled` | `CAPTION_AGENT=off` (or the legacy alias). |
| `skipped` | Too large for Telegram's bot feed; not published. |
| `manual` | Field was edited through the admin API. |
| `legacy` | Video was stored before this feature existed. |

Fallback captions are neutral catalogue lines such as
`🎬 New Homemade clip · 1:14 · vertical. Added to AfterDark.` followed by a
line of hashtags such as `#Homemade #Telegram #Vertical_Video`. Fallback tags
always include the category and `Telegram` plus verifiable format tags.

## Verify it

Send `/caption` to the bot (or `/hashtags`, which is kept as an alias): it
reports whether the `AI` binding is present, the text model in use, and whether
the poster hint is enabled. A new Telegram upload should produce
`📝 AI caption:` and `🏷 AI hashtags:` lines even if the upload has caption text
or hashtags. The first caption line stays the title; generated hashtags also
appear at the end of the watch-page description.

```bash
npm test
```

The mocked Worker suite covers: AI captions and hashtags generated from
owner caption context, automatic URL removal, admin API provenance, off
switches and legacy aliases, model failure, missing binding, text-only mode,
duplicates and oversized files. No Cloudflare account
or network access is needed for these tests.
