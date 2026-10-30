# AI caption agent — every forwarded video gets a written description

When you send a video to the bot, a Workers AI agent turns the raw upload into
a proper catalogue entry: a short, emoji-led description plus a handful of
hashtags, generated fresh for that video. No API keys, no external accounts —
it runs on Cloudflare Workers AI, bound to the same Worker as the bot.

Scraped link-imports are **not** captioned by the agent (their pages already
carry descriptions); the agent runs only on Telegram video uploads. Those
scraped descriptions *are* published — with links removed: promo URLs are
stripped when the draft is created, and the public feed re-strips stored text
on every response, so even records published by an older Worker serve clean
pages without any republishing.

## What the agent does with your caption

| Input | Result |
| --- | --- |
| Caption line 1 | becomes the video **title**, verbatim (links removed) |
| Later caption lines, `#hashtags`, the file name | **context for the model only** — they are never published as-is |
| Published description | the AI-written caption + the AI-picked hashtags on one line below it |
| Published tags | baseline metadata tags (category, orientation, length, resolution, `Telegram`) + the AI's picks |

Before anything reaches the model, URLs are stripped (and they are stripped
again from the generated caption — the owner's own media links must never leak
into public text). The prompt treats all supplied metadata as untrusted data
and instructs the model to ignore instructions inside it.

## Enable it

1. Cloudflare dashboard → your Worker → **Settings → Bindings → Add →
   Workers AI** → namespace variable name **`AI`**. Deploy.
2. That's all. With the binding present, every Telegram upload is captioned.

Send `/caption` to the bot any time for the live status (`on · <model>`,
`off (…)`, or `unconfigured — add the Workers AI binding named AI`).

## Environment variables (all optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `CAPTION_AGENT` | on | `off` (or `false`/`0`/`no`) disables the agent — uploads publish with the fallback caption instead. The legacy name `HASHTAG_AGENT` still works. |
| `CAPTION_AGENT_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | the text model; Cloudflare rotates model ids, override here if one is retired |
| `CAPTION_AGENT_VISION_MODEL` | `@cf/llava-hf/llava-1.5-7b-hf` | describes the Telegram poster for an extra hint; `off` keeps the agent text-only (the old `HASHTAG_AGENT_VISION_MODEL` alias still works). Image bytes are fetched, passed to the model and discarded — never stored. |

Model calls have fixed budgets (9 s text, 6 s poster); if the poster pass
times out or fails the caption simply proceeds text-only.

## Guarantees a caption is always produced

The webhook never blocks on the model: hard timeouts (9 s text, 6 s poster),
one automatic retry without JSON mode if a model override can't honour the
response schema, and a deterministic fallback caption —
`🎬 New <Category> clip · <duration> · <vertical|widescreen>. Added to
AfterDark.` plus the baseline tags whenever the model errors, times out or
returns nothing usable. Videos over Telegram's 20 MB bot limit are registered
without a model call (`source: skipped`).

Where a caption came from is recorded per video (`captionAgent.source` /
`hashtagAgent.source`: `ai`, `fallback`, `disabled`, `unconfigured`, `skipped`,
and `manual` once you edit it) and surfaced as `captionSource` /
`hashtagSource` in `/api/videos` and the dashboard. Editing a description or
tags in `/admin/` marks them `manual`, and nothing re-runs automatically over
your edit. The bot's `✅ Posted` reply quotes the generated caption and tags.

The hashtag list is capped (10) and filtered against a fixed vocabulary — the
site categories plus `Vertical Video`, `Landscape Video`, `Short Clip`,
`Long Clip`, `HD`, `Full HD`, `Telegram` — so a model hallucinating a tag can't
sprawl tags across the site; the caption itself (≤ 280 chars) carries any
specific detail, and `#tags` in it are normalised back into the tag list.
