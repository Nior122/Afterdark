/**
 * AfterDark Telegram Bot — Cloudflare Worker (single file, no build step)
 * =======================================================================
 *
 * What it does
 * ------------
 * You forward/send a video to your Telegram bot -> this Worker stores the
 * video's Telegram file IDs (never the video itself) -> your website reads
 * the public JSON feed from this Worker and plays each video through a
 * streaming proxy on this Worker. The bot token lives only in this Worker's
 * secrets and never appears in the website, the feed, or any URL.
 *
 * You can also paste any web page link: the Worker scrapes the page (title,
 * poster, description, duration, categories, playable embed) and — when the
 * page is a listing — every video on it. Nothing is published until you press
 * ✅ Publish on the review card.
 *
 * Endpoints
 * ---------
 *   POST /telegram/webhook         Telegram updates (messages, channel posts, buttons)
 *   GET  /api/videos               Public feed consumed by the website
 *   GET  /api/videos/:id/stream.mp4  Video stream proxy (Range supported)
 *   GET  /api/videos/:id/thumb.jpg   Thumbnail proxy (the video's real poster)
 *   GET  /health                   "ok"
 *
 * Required configuration (Cloudflare dashboard -> Worker -> Settings)
 * -------------------------------------------------------------------
 *   Secret  BOT_TOKEN           token from @BotFather
 *   Secret  WEBHOOK_SECRET      any long random string, also used in setWebhook
 *   KV      binding name: VIDEOS  (Workers & Pages -> KV -> create namespace)
 * Optional:
 *   Var     ALLOWED_USER_IDS      comma-separated Telegram user IDs allowed to
 *                                 publish. If unset, the first person to send
 *                                 /start becomes the owner (stored in KV).
 *   Var     ALLOWED_CHANNEL_IDS   comma-separated channel IDs whose posts are
 *                                 auto-published when the bot is a channel admin.
 *
 * Bot commands (in a chat with the bot)
 * -------------------------------------
 *   /start            claim ownership (first run) + help
 *   /id               show your Telegram user ID
 *   /videos           every video this bot published, with Rename / Delete
 *   /list             same as /videos
 *   /pending          scraped drafts waiting for your review
 *   /add <url>        scrape a page and create drafts (a bare URL also works)
 *   /rename <id> <t>  rename a published video
 *   /remove <id>      unpublish a video
 *   /cancel           abort a pending edit
 *   (send a video)    publish it. Caption's first line = title,
 *                     #Hashtags = tags; a hashtag matching a site category
 *                     (e.g. #POV, #Big_Ass) sets the category.
 *   (send a link)     scrape it -> review card(s) -> Publish / Edit / Cancel
 *
 * Telegram Bot API limit: bots can only download files up to 20 MB, so
 * videos larger than that are registered but NOT published to the feed;
 * the bot tells you when this happens. Scraped links are never uploaded,
 * only referenced (link-only, nothing stored).
 */

// Keep in sync with CATEGORIES in src/data/seed.ts (minus "All").
const CATEGORIES = [
  'POV', 'Amateur', 'MILF', 'Blowjob', 'Big Tits', 'Big Ass', 'Latina',
  'Brunette', 'Pornstar', 'Hardcore', 'Anal', 'Homemade', 'Mature',
  'Big Dick', 'Cumshot', 'Creampie', 'Threesome', 'Lesbian', 'Ebony',
  'Interracial', 'Hotwife', 'Webcam', 'ASMR', 'Toys', '4K Ultra HD',
]
const DEFAULT_CATEGORY = 'Homemade'
const BOT_MAX_FILE_BYTES = 20 * 1024 * 1024 // Telegram Bot API getFile limit
const MAX_INDEX = 500
const FILE_PATH_TTL_MS = 50 * 60 * 1000 // Telegram file paths last >= 1 hour

// Drafts (scraped, not yet published)
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_DRAFTS = 200
const MAX_BATCH_DRAFTS = 24 // videos taken from a single listing page
const STATE_TTL_MS = 10 * 60 * 1000 // "waiting for your new title" window

// Listing / paging
const LIST_PAGE_SIZE = 5
const TEXT_LIMIT = 3800 // Telegram messages cap at 4096 chars

const filePathCache = new Map() // fileId -> { path, at }

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0 Safari/537.36'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname } = url

    if (pathname === '/' || pathname === '/health') {
      return new Response('AfterDark Telegram bot worker: ok', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    if (pathname === '/telegram/webhook' && request.method === 'POST') {
      return handleWebhook(request, env, ctx)
    }

    if (pathname === '/api/videos' && request.method === 'GET') {
      return handleFeed(env, url.origin)
    }

    const media = pathname.match(/^\/api\/videos\/([A-Za-z0-9-]+)\/(stream(?:\.mp4)?|thumb(?:\.jpg)?)$/)
    if (media && request.method === 'GET') {
      const [, id, kind] = media
      return kind.startsWith('stream')
        ? handleMedia(env, id, 'video', request)
        : handleMedia(env, id, 'thumb', request)
    }

    return new Response('Not found', { status: 404 })
  },
}

/* ------------------------------ public feed ------------------------------ */

async function handleFeed(env, origin) {
  const ids = await readIndex(env)
  const records = await Promise.all(ids.map((id) => readVideo(env, id)))
  const videos = records
    .filter((v) => v && !v.tooLarge)
    .map((v) => {
      const isLink = v.kind === 'link'
      return {
        id: v.id,
        title: v.title,
        category: v.category,
        tags: v.tags,
        durationSec: v.durationSec,
        width: v.width,
        height: v.height,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt || null,
        description: v.description || '',
        site: v.site || '',
        sourceUrl: isLink ? v.sourceUrl : null,
        streamUrl: isLink ? null : `${origin}/api/videos/${v.id}/stream.mp4`,
        thumbUrl: v.thumbFileId
          ? `${origin}/api/videos/${v.id}/thumb.jpg`
          : v.thumbUrl || null,
      }
    })
  return new Response(JSON.stringify({ videos }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  })
}

/* --------------------------- media proxying ------------------------------ */

async function handleMedia(env, id, kind, request) {
  const video = await readVideo(env, id)
  if (!video) return new Response('Not found', { status: 404 })
  const fileId = kind === 'video' ? video.fileId : video.thumbFileId
  if (!fileId) return new Response('Not found', { status: 404 })

  const upstream = await fetchTelegramFile(env, fileId, request)
  if (!upstream) return new Response('Upstream error', { status: 502 })

  const headers = new Headers()
  const type = upstream.headers.get('content-type') || (kind === 'video' ? 'video/mp4' : 'image/jpeg')
  headers.set('Content-Type', type)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cache-Control', kind === 'video' ? 'no-store' : 'public, max-age=86400')
  if (kind === 'video') headers.set('Accept-Ranges', 'bytes')
  for (const h of ['content-length', 'content-range']) {
    const v = upstream.headers.get(h)
    if (v) headers.set(h, v)
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}

async function fetchTelegramFile(env, fileId, request, allowRetry = true) {
  const path = await telegramFilePath(env, fileId)
  if (!path) return null
  const headers = {}
  const range = request.headers.get('range')
  if (range) headers.Range = range
  let res
  try {
    res = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`, {
      headers,
      redirect: 'follow',
    })
  } catch {
    return null
  }
  // A cached file path can go stale; refresh once and retry.
  if ((res.status === 404 || res.status === 410) && allowRetry) {
    filePathCache.delete(fileId)
    return fetchTelegramFile(env, fileId, request, false)
  }
  return res.ok || res.status === 206 ? res : null
}

async function telegramFilePath(env, fileId) {
  const hit = filePathCache.get(fileId)
  if (hit && Date.now() - hit.at < FILE_PATH_TTL_MS) return hit.path
  const data = await tg(env, 'getFile', { file_id: fileId })
  const path = data?.result?.file_path
  if (!path) return null
  filePathCache.set(fileId, { path, at: Date.now() })
  return path
}

/* ------------------------------ webhook ---------------------------------- */

async function handleWebhook(request, env, ctx) {
  const secret = request.headers.get('x-telegram-bot-api-secret-token')
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  let update
  try {
    update = await request.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  // Process without blocking Telegram's delivery acknowledgement.
  ctx.waitUntil(processUpdate(update, env).catch(() => {}))
  return new Response('ok')
}

async function processUpdate(update, env) {
  if (update.callback_query) return processCallback(update.callback_query, env)
  if (update.message) return processMessage(update.message, env)
  if (update.channel_post) return processChannelPost(update.channel_post, env)
}

/* --------------------------- button callbacks ---------------------------- */

/**
 * Inline keyboard data is limited to 64 bytes, so every action is a short
 * code plus an id:  p: publish · e: edit title · c: category · x: cancel draft
 * aa/ar/ca: publish-all / review / cancel a batch · r: rename · d/dc/dx: delete
 * g: page · k: set category by index · q: dismiss
 */
async function processCallback(query, env) {
  const chatId = query.message?.chat?.id
  const userId = query.from?.id
  const data = String(query.data || '')
  if (chatId == null || userId == null) return

  if (!(await isOwner(env, userId))) {
    return answerCallback(env, query.id, 'Only the site owner can do that.', true)
  }
  await answerCallback(env, query.id, '')

  const [op, a, b] = data.split(':')

  if (op === 'p') return publishDraftById(env, chatId, a, query.message?.message_id)
  if (op === 'e') return beginEdit(env, chatId, userId, 'title', { draftId: a }, 'draft')
  if (op === 'c') return sendCategoryPicker(env, chatId, a, 'draft')
  if (op === 'k') return setDraftCategory(env, chatId, a, Number(b), query.message?.message_id)
  if (op === 'x') return cancelDraft(env, chatId, a, query.message?.message_id)

  if (op === 'aa') return publishBatch(env, chatId, a)
  if (op === 'ar') return reviewBatch(env, chatId, a)
  if (op === 'ca') return cancelBatch(env, chatId, a)

  if (op === 'r') return beginRename(env, chatId, userId, a)
  if (op === 'd') return confirmDelete(env, chatId, a)
  if (op === 'dc') return deleteVideo(env, chatId, a, query.message?.message_id)
  if (op === 'dx') return editMessage(env, chatId, query.message?.message_id, 'Delete cancelled.')
  if (op === 'g') return sendVideoList(env, chatId, Number(a) || 0)
  if (op === 'q') return editMessage(env, chatId, query.message?.message_id, 'Dismissed.')
  if (op === 'v') return sendCategoryPicker(env, chatId, a, 'video')
  if (op === 'V') return setVideoCategory(env, chatId, a, Number(b), query.message?.message_id)
}

/* ------------------------------ messages --------------------------------- */

async function processMessage(msg, env) {
  const chatId = msg.chat?.id
  const userId = msg.from?.id
  if (chatId == null || userId == null) return
  const owner = await resolveOwner(env, msg)

  const text = (msg.text || '').trim()

  // A pending "send me the new title" step consumes the next plain message.
  if (!text.startsWith('/') && (owner.isOwner || owner.needsClaim)) {
    const handled = await consumeEditState(env, msg)
    if (handled) return handled
  }

  if (text.startsWith('/')) {
    const [commandRaw, ...rest] = text.split(/\s+/)
    const command = commandRaw.split('@')[0].toLowerCase()
    const arg = rest.join(' ').trim()

    if (command === '/start') {
      return send(env, chatId,
        (owner.claimedNow
          ? '✅ You are now the owner of this bot — only you can publish videos.\n\n'
          : '👋 AfterDark publisher bot.\n\n') +
        'Forward or send me a video and I will post it on the website with its real thumbnail.\n' +
        'Or paste a link (page, gallery, embed) and I will scrape it into a draft you can review.\n' +
        '• Caption\'s first line becomes the title\n' +
        '• #Hashtags become tags; one matching a category (e.g. #POV, #Big_Ass) sets the category\n' +
        '• Videos must be 20 MB or smaller (Telegram bot limit)\n\n' +
        'Commands: /videos · /pending · /add <url> · /rename <id> <title> · /remove <id> · /id\n' +
        'Nothing scraped is published until you press ✅ Publish.')
    }
    if (command === '/id') {
      return send(env, chatId, `Your Telegram user ID: ${userId}`)
    }
    if (command === '/videos' || command === '/list') {
      if (!owner.isOwner) return deny(env, chatId, userId)
      return sendVideoList(env, chatId, 0)
    }
    if (command === '/pending') {
      if (!owner.isOwner) return deny(env, chatId, userId)
      return sendPending(env, chatId)
    }
    if (command === '/add') {
      if (!owner.isOwner) return deny(env, chatId, userId)
      if (!arg) return send(env, chatId, 'Usage: /add https://example.com/video-page — or just paste the link.')
      return scrapeIntoDrafts(env, chatId, arg)
    }
    if (command === '/rename') {
      if (!owner.isOwner) return deny(env, chatId, userId)
      const [id, ...titleParts] = arg.split(/\s+/)
      const title = titleParts.join(' ').trim()
      if (!id) return send(env, chatId, 'Usage: /rename <video id> <new title> — ids are in /videos.')
      if (!title) return beginRename(env, chatId, userId, id)
      return applyRename(env, chatId, id, title)
    }
    if (command === '/remove' || command === '/delete') {
      if (!owner.isOwner) return deny(env, chatId, userId)
      if (!arg) return send(env, chatId, 'Usage: /remove <id> — see ids with /videos.')
      const ok = await removeVideo(env, arg)
      return send(env, chatId, ok ? `🗑 Removed ${arg} from the website.` : `No video with id ${arg}.`)
    }
    if (command === '/cancel') {
      await clearState(env, userId)
      return send(env, chatId, 'Cancelled.')
    }
    return send(env, chatId, 'Unknown command. Send me a video or a link, or try /videos.')
  }

  // 1) A video file: keep the original instant-publish behaviour.
  const video = extractVideo(msg)
  if (video) {
    if (owner.needsClaim) {
      return send(env, chatId, 'Send /start first so I know you are the owner, then re-send the video.')
    }
    if (!owner.isOwner) return deny(env, chatId, userId)

    const result = await ingest(env, video, msg.caption || '', 'forward')
    if (result.duplicate) {
      return send(env, chatId, `↩️ That video is already on the website: “${result.record.title}” (${result.record.id}).`)
    }
    const v = result.record
    if (v.tooLarge) {
      return send(env, chatId,
        `⚠️ “${v.title}” is ${(v.fileSize / 1048576).toFixed(1)} MB. Telegram bots can only stream files up to 20 MB, ` +
        'so I saved it but cannot put it on the website. Send a compressed/smaller version, or post it in a public channel and share the t.me link instead.')
    }
    return send(env, chatId,
      `✅ Posted to the website!\n“${v.title}” · ${v.category} · ${formatDuration(v.durationSec)}\nVideo id: ${v.id} (use /videos to rename or delete)`)
  }

  // 2) A link: scrape it into drafts for review.
  const links = extractUrls(text)
  if (links.length) {
    if (owner.needsClaim) {
      return send(env, chatId, 'Send /start first so I know you are the owner, then paste the link again.')
    }
    if (!owner.isOwner) return deny(env, chatId, userId)
    return scrapeIntoDrafts(env, chatId, links[0])
  }

  if (owner.isOwner || owner.needsClaim) {
    return send(env, chatId, owner.needsClaim
      ? 'Send /start first so I know you are the owner, then send a video or a link.'
      : 'Send or forward me a video, or paste a link to scrape. /videos lists what is published.')
  }
  return deny(env, chatId, userId)
}

async function processChannelPost(post, env) {
  const chatId = post.chat?.id
  const video = extractVideo(post)
  if (chatId == null || !video) return
  const allowed = parseIdList(env.ALLOWED_CHANNEL_IDS)
  if (allowed.includes(String(chatId))) {
    await ingest(env, video, post.caption || '', 'channel')
    return
  }
  // Unknown channel: tell the owner once a day per channel how to enable it.
  const ownerChat = await ownerChatId(env)
  if (!ownerChat) return
  const seenKey = `seenchan:${chatId}`
  const seen = await env.VIDEOS.get(seenKey)
  if (seen && Date.now() - Number(seen) < 24 * 3600 * 1000) return
  await env.VIDEOS.put(seenKey, String(Date.now()))
  await send(env, ownerChat,
    `📺 A video was posted in channel “${post.chat.title || chatId}” (id ${chatId}), but auto-posting is off for it.\n` +
    `To publish this channel's videos automatically, add ${chatId} to the ALLOWED_CHANNEL_IDS variable in the Worker settings.`)
}

/* ------------------------------ ingestion -------------------------------- */

function extractVideo(msg) {
  const v = msg.video || (msg.document?.mime_type?.startsWith('video/') ? msg.document : null) || msg.animation
  if (!v?.file_id) return null
  return {
    fileId: v.file_id,
    fileUniqueId: v.file_unique_id || v.file_id,
    thumbFileId: (v.thumbnail || v.thumb)?.file_id || null,
    fileName: v.file_name || null,
    durationSec: typeof v.duration === 'number' ? v.duration : 0,
    width: v.width || 0,
    height: v.height || 0,
    fileSize: v.file_size || 0,
  }
}

async function ingest(env, video, caption, source) {
  const id = `tg-${await shortHash(video.fileUniqueId)}`
  const existing = await readVideo(env, id)
  if (existing) return { duplicate: true, record: existing }

  const { title, tags, category } = parseCaption(caption, video.fileName)
  const record = {
    id,
    kind: 'telegram',
    fileId: video.fileId,
    thumbFileId: video.thumbFileId,
    title,
    category,
    tags,
    durationSec: video.durationSec,
    width: video.width,
    height: video.height,
    fileSize: video.fileSize,
    tooLarge: video.fileSize > BOT_MAX_FILE_BYTES,
    source,
    createdAt: Date.now(),
  }
  await env.VIDEOS.put(`v:${id}`, JSON.stringify(record))
  const ids = await readIndex(env)
  ids.unshift(id)
  await env.VIDEOS.put('idx', JSON.stringify(ids.slice(0, MAX_INDEX)))
  return { duplicate: false, record }
}

function parseCaption(caption, fileName) {
  const raw = (caption || '').trim()
  const hashtags = [...raw.matchAll(/#([A-Za-z0-9_]+)/g)].map((m) => m[1].replace(/_/g, ' '))
  const firstLine = raw.split('\n').map((l) => l.replace(/#[A-Za-z0-9_]+/g, '').trim()).find(Boolean)
  let category = DEFAULT_CATEGORY
  for (const tag of hashtags) {
    const match = CATEGORIES.find((c) => c.toLowerCase() === tag.toLowerCase())
    if (match) { category = match; break }
  }
  const tags = [...new Set(hashtags.map((t) => titleCase(t)).filter((t) => t.toLowerCase() !== category.toLowerCase()))]
  if (!tags.some((t) => t.toLowerCase() === category.toLowerCase())) tags.unshift(category)
  const fromFile = (fileName || '').replace(/\.[A-Za-z0-9]+$/, '').replace(/[_-]+/g, ' ').trim()
  return { title: firstLine || fromFile || 'Telegram video', tags: [...new Set([...tags, 'Telegram'])], category }
}

/* ------------------------------ scraping --------------------------------- */

function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"')]+/gi) || []
  return [...new Set(matches.map((url) => url.replace(/[.,;]+$/, '')))].slice(0, 3)
}

/** Fetch a page the way a browser would; returns null on any failure. */
async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(15000)
        : undefined,
    })
    if (!response.ok) return { error: `HTTP ${response.status}` }
    const type = response.headers.get('content-type') || ''
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      return { error: `not a web page (${type.split(';')[0] || 'unknown type'})` }
    }
    const html = (await response.text()).slice(0, 900000)
    return { html, finalUrl: response.url || url }
  } catch (error) {
    return { error: error?.name === 'TimeoutError' ? 'timed out' : 'could not be reached' }
  }
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      const named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
        ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘',
        ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', middot: '·',
      }
      const key = String(entity).toLowerCase()
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16) || 32)
      if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)) || 32)
      return named[key] ?? match
    })
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function metaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match) return decodeEntities(match[1]).trim()
  }
  return ''
}

/** Walk every JSON-LD block and collect objects whose @type mentions VideoObject. */
function jsonLdVideoObjects(html) {
  const objects = []
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const block of blocks) {
    const raw = block[1].replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim()
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    const walk = (node, depth = 0) => {
      if (!node || depth > 6) return
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1))
        return
      }
      if (typeof node !== 'object') return
      const type = node['@type']
      const types = Array.isArray(type) ? type.map(String) : [String(type || '')]
      if (types.some((t) => /videoobject/i.test(t))) objects.push(node)
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') walk(value, depth + 1)
      }
    }
    walk(parsed)
  }
  return objects
}

function firstString(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found) return found
    }
    return ''
  }
  if (value && typeof value === 'object') {
    for (const key of ['url', 'contentUrl', '@id', 'name']) {
      const found = firstString(value[key])
      if (found) return found
    }
  }
  return ''
}

/** "PT1H2M3S" or "1:02:03" or 3723 -> seconds. */
function parseDurationToSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value))
  const raw = String(value || '').trim()
  if (!raw) return 0
  const iso = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(raw)
  if (iso) {
    const [, d, h, m, s] = iso
    return Math.round(
      Number(d || 0) * 86400 + Number(h || 0) * 3600 + Number(m || 0) * 60 + Number(s || 0),
    )
  }
  if (/^\d+$/.test(raw)) return Number(raw)
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw)
  if (match) {
    const [a, b, c] = [Number(match[1]), Number(match[2]), Number(match[3] || 0)]
    return match[3] ? a * 3600 + b * 60 + c : a * 60 + b
  }
  return 0
}

/** Playable source for a scraped item: direct file, or an embeddable player. */
function pickSourceUrl(candidates) {
  for (const candidate of candidates) {
    const url = String(candidate || '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url)) return { sourceUrl: url, kind: 'file' }
    if (/(\/embed\/|\/e\/|player\.|embed\.|youtube\.com\/embed|player\.vimeo\.com)/i.test(url)) {
      return { sourceUrl: url, kind: 'embed' }
    }
  }
  return null
}

function inferCategory(...hints) {
  // Order matters: the page's own keyword list is passed first, so the earliest
  // explicit mention wins ("MILF, hotel, big ass" -> MILF, not Big Ass).
  const haystack = hints.filter(Boolean).join(' ').toLowerCase().replace(/[_\-/]+/g, ' ')
  let best = null
  for (const category of CATEGORIES) {
    const needle = category.toLowerCase()
    const at = haystack.indexOf(needle)
    if (at === -1) continue
    if (!best || at < best.at || (at === best.at && needle.length > best.needle.length)) {
      best = { category, at, needle }
    }
  }
  // A few common aliases the strict names miss.
  const aliases = [
    [/big\s*(ass|booty)|booty|pa?w?g/, 'Big Ass'],
    [/big\s*tit|huge\s*tit|boob/, 'Big Tits'],
    [/big\s*(dick|cock)|bbc/, 'Big Dick'],
    [/girl\s*on\s*girl|sapphic/, 'Lesbian'],
    [/step\s*(mom|mother)|housewife/, 'MILF'],
    [/teen|college/, 'Amateur'],
    [/latina|latino|mexican|brazil/, 'Latina'],
    [/asian|japanese|korean|pinay|thai/, 'Amateur'],
    [/ebony|black\b/, 'Ebony'],
    [/4k|uhd|2160/, '4K Ultra HD'],
    [/anal/, 'Anal'],
    [/creampie/, 'Creampie'],
    [/threesome|3some/, 'Threesome'],
    [/cumshot|facial/, 'Cumshot'],
    [/blowjob|bj\b|oral/, 'Blowjob'],
    [/mature|granny|gilf|cougar/, 'Mature'],
    [/webcam|cam\s*girl|live\s*cam/, 'Webcam'],
    [/asmr|whisper/, 'ASMR'],
    [/toy|vibrator|dildo/, 'Toys'],
    [/hotwife|cuck/, 'Hotwife'],
    [/interracial|ir\b/, 'Interracial'],
    [/hardcore|rough/, 'Hardcore'],
    [/pornstar|xxx\s*star/, 'Pornstar'],
    [/amateur|homemade|selfie/, 'Amateur'],
  ]
  if (best) return best.category
  for (const [pattern, category] of aliases) {
    if (pattern.test(haystack)) return category
  }
  return DEFAULT_CATEGORY
}

function cleanTitle(value) {
  return stripTags(value)
    .replace(/\s*[|–—·]\s*(free\s+)?(hd\s+)?(porn|sex|tube|videos?)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function collectTags(...sources) {
  const tags = []
  for (const source of sources) {
    if (!source) continue
    const parts = Array.isArray(source) ? source : String(source).split(/[,;|]/)
    for (const part of parts) {
      const tag = titleCase(stripTags(part).replace(/^#/, '').trim())
      if (tag.length >= 2 && tag.length <= 28 && !tags.includes(tag)) tags.push(tag)
    }
  }
  return tags.slice(0, 10)
}

/**
 * Scrape one page into draft(s).
 * Returns { items: [...], site, pageTitle, error }.
 */
function scrapePage(html, pageUrl) {
  let host = ''
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '')
  } catch {
    host = ''
  }
  const site = metaContent(html, 'og:site_name') || host
  const pageTitle = cleanTitle(metaContent(html, 'og:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  const pageThumb = metaContent(html, 'og:image') || metaContent(html, 'twitter:image')
  const pageDescription =
    metaContent(html, 'og:description') || metaContent(html, 'description') || ''
  const pageKeywords = metaContent(html, 'keywords')
  const pathHint = (() => {
    try {
      return decodeURIComponent(new URL(pageUrl).pathname)
    } catch {
      return ''
    }
  })()

  const items = []
  const seen = new Set()
  const push = (item) => {
    const key = item.sourceUrl || item.title.toLowerCase()
    if (!item.title || item.title.length < 3) return
    if (seen.has(key)) return
    seen.add(key)
    items.push(item)
  }

  // 1) schema.org VideoObject entries — single videos and ItemList galleries.
  for (const node of jsonLdVideoObjects(html)) {
    const title = cleanTitle(firstString(node.name) || firstString(node.headline))
    if (!title) continue
    const source = pickSourceUrl([
      firstString(node.contentUrl),
      firstString(node.embedUrl),
      firstString(node.url),
    ])
    push({
      title,
      sourceUrl: source?.sourceUrl || pageUrl,
      sourceKind: source?.kind || 'page',
      thumbnail: firstString(node.thumbnailUrl) || firstString(node.image) || pageThumb,
      description: stripTags(firstString(node.description) || '').slice(0, 600),
      durationSec: parseDurationToSeconds(node.duration),
      category: inferCategory(
        firstString(node.genre),
        title,
        Array.isArray(node.keywords) ? node.keywords.join(' ') : node.keywords,
        pathHint,
      ),
      tags: collectTags(node.genre, node.keywords, title),
      site,
    })
  }

  // 2) Anchor scan — catches galleries that do not expose JSON-LD.
  if (items.length < 2) {
    const anchorPattern = /<a\b([^>]*)>([\s\S]{0,600}?)<\/a>/gi
    let match
    while ((match = anchorPattern.exec(html))) {
      const attrs = match[1]
      const inner = match[2]
      const href = /\bhref=["']([^"']+)["']/i.exec(attrs)?.[1]
      if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue

      let absolute
      try {
        absolute = new URL(decodeEntities(href), pageUrl).toString()
      } catch {
        continue
      }
      const sameHost = (() => {
        try {
          return new URL(absolute).hostname.replace(/^www\./, '') === host
        } catch {
          return false
        }
      })()
      if (!sameHost) continue

      const linkPath = new URL(absolute).pathname
      const looksLikeVideo =
        /\/(video|videos|watch|embed|v|clip|post|p)\/[^/]/i.test(linkPath) ||
        /[?&](v|video|id|watch)=/i.test(absolute)
      const imgTag = /<img\b[^>]*>/i.exec(inner)?.[0] || ''
      const imgAlt = imgTag ? /\balt=["']([^"']*)["']/i.exec(imgTag)?.[1] : ''
      const imgSrc = imgTag ? /\bsrc=["']([^"']+)["']/i.exec(imgTag)?.[1] : ''
      const titleAttr = /\btitle=["']([^"']*)["']/i.exec(attrs)?.[1]
      const text = stripTags(inner)

      if (!looksLikeVideo && !(imgTag && (imgAlt || titleAttr))) continue

      const title = cleanTitle(titleAttr || imgAlt || text.split(/\s{2,}/)[0] || '')
      if (!title || title.length < 4 || title.length > 160) continue

      let thumbnail = ''
      if (imgSrc) {
        try {
          thumbnail = new URL(decodeEntities(imgSrc), pageUrl).toString()
        } catch {
          thumbnail = ''
        }
      }
      // Only list-style pages produce more than one; keep single-page results clean.
      push({
        title,
        sourceUrl: absolute,
        sourceKind: 'page',
        thumbnail,
        description: '',
        durationSec: 0,
        category: inferCategory(title, linkPath, pathHint),
        tags: collectTags(title),
        site,
      })
    }
  }

  // 3) Nothing structured: fall back to the page itself as a single video.
  if (!items.length && pageTitle) {
    const source = pickSourceUrl([
      metaContent(html, 'og:video:secure_url'),
      metaContent(html, 'og:video:url'),
      metaContent(html, 'og:video'),
      /<video\b[^>]*src=["']([^"']+)["']/i.exec(html)?.[1],
      /<source\b[^>]*src=["']([^"']+)["']/i.exec(html)?.[1],
      /<iframe\b[^>]*src=["']([^"']+)["']/i.exec(html)?.[1],
    ])
    push({
      title: pageTitle,
      sourceUrl: source?.sourceUrl || pageUrl,
      sourceKind: source?.kind || 'page',
      thumbnail: pageThumb,
      description: stripTags(pageDescription).slice(0, 600),
      durationSec: parseDurationToSeconds(metaContent(html, 'og:video:duration')),
      category: inferCategory(pageKeywords, pageTitle, pageDescription, pathHint),
      tags: collectTags(pageKeywords, pageTitle),
      site,
    })
  }

  return { items: items.slice(0, MAX_BATCH_DRAFTS), site, pageTitle }
}

async function scrapeIntoDrafts(env, chatId, rawUrl) {
  const url = String(rawUrl || '').trim()
  if (!/^https?:\/\//i.test(url)) {
    return send(env, chatId, 'That does not look like a link. It should start with http:// or https://')
  }
  await send(env, chatId, `🔎 Scraping ${url}\nThis can take a few seconds…`)

  const page = await fetchPage(url)
  if (page.error) {
    return send(env, chatId,
      `⚠️ I could not read that page (${page.error}).\n\n` +
      'Many adult sites block server-side requests or require JavaScript. You can still add the video:\n' +
      '• Paste the direct embed/player link (e.g. …/embed/abc123/)\n' +
      '• Or forward the video file to me (≤ 20 MB)\n' +
      '• Or send it in a public Telegram channel and share the t.me link')
  }

  const parsed = scrapePage(page.html, page.finalUrl || url)
  if (!parsed.items.length) {
    return send(env, chatId,
      `🤔 I reached that page but found no video on it.\nTitle looked like: “${parsed.pageTitle || 'unknown'}”.\n` +
      'Send the link to the video itself, or forward the file instead.')
  }

  const batchId = `b${randomId(8)}`
  const draftIds = []
  for (const item of parsed.items) {
    const draft = {
      id: `d${randomId(9)}`,
      batchId,
      title: item.title,
      sourceUrl: item.sourceUrl,
      sourceKind: item.sourceKind,
      thumbUrl: item.thumbnail || '',
      description: item.description || '',
      durationSec: item.durationSec || 0,
      category: item.category || DEFAULT_CATEGORY,
      tags: item.tags || [],
      site: item.site || '',
      pageUrl: page.finalUrl || url,
      createdAt: Date.now(),
    }
    await env.VIDEOS.put(`draft:${draft.id}`, JSON.stringify(draft))
    await addDraftToIndex(env, draft.id)
    draftIds.push(draft.id)
  }
  await trimDrafts(env)
  await env.VIDEOS.put(`batch:${batchId}`, JSON.stringify(draftIds))

  if (draftIds.length === 1) {
    const draft = await readDraft(env, draftIds[0])
    await sendDraftCard(env, chatId, draft)
    return
  }

  const lines = draftIds.slice(0, 15).map((id, index) => {
    const item = parsed.items[index] || {}
    return `${index + 1}. ${previewTitleFor(item)}\n    ${item.category || DEFAULT_CATEGORY}`
  })
  const more = draftIds.length > 15 ? `\n…and ${draftIds.length - 15} more.` : ''
  return sendWithKeyboard(env, chatId,
    `🔎 Found ${draftIds.length} videos on ${parsed.site || 'that page'}.\n\n` +
    `${lines.join('\n')}${more}\n\n` +
    'Nothing is published yet. Publish them all, or review one by one.',
    [
      [
        { text: `✅ Publish all (${draftIds.length})`, callback_data: `aa:${batchId}` },
      ],
      [
        { text: '🔎 Review each', callback_data: `ar:${batchId}` },
        { text: '❌ Cancel all', callback_data: `ca:${batchId}` },
      ],
    ])
}

function previewTitleFor(item) {
  return String(item?.title || '').slice(0, 90)
}

/* ------------------------------- drafts ---------------------------------- */

async function readDraft(env, id) {
  try {
    const raw = await env.VIDEOS.get(`draft:${id}`)
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (Date.now() - Number(draft.createdAt || 0) > DRAFT_TTL_MS) return null
    return draft
  } catch {
    return null
  }
}

async function trimDrafts(env) {
  const list = await readDraftIndex(env)
  const keep = []
  for (const id of list) {
    const draft = await readDraft(env, id)
    if (draft) keep.push(id)
    else await env.VIDEOS.delete(`draft:${id}`)
  }
  if (keep.length > MAX_DRAFTS) {
    for (const id of keep.slice(MAX_DRAFTS)) await env.VIDEOS.delete(`draft:${id}`)
    keep.length = MAX_DRAFTS
  }
  await env.VIDEOS.put('drafts:idx', JSON.stringify(keep))
}

async function addDraftToIndex(env, id) {
  const list = await readDraftIndex(env)
  const next = [id, ...list.filter((entry) => entry !== id)]
  await env.VIDEOS.put('drafts:idx', JSON.stringify(next.slice(0, MAX_DRAFTS)))
}

async function readDraftIndex(env) {
  try {
    const raw = await env.VIDEOS.get('drafts:idx')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function removeDraftEverywhere(env, id) {
  await env.VIDEOS.delete(`draft:${id}`)
  const list = await readDraftIndex(env)
  await env.VIDEOS.put('drafts:idx', JSON.stringify(list.filter((entry) => entry !== id)))
}

async function sendDraftCard(env, chatId, draft) {
  if (!draft) return send(env, chatId, 'That draft expired or was already handled.')
  const lines = [
    '🆕 Draft — not published yet',
    '',
    `📝 ${draft.title}`,
    `🏷 ${draft.category}${draft.durationSec ? ` · ⏱ ${formatDuration(draft.durationSec)}` : ''}`,
    draft.site ? `🌐 ${draft.site}` : '',
    `🔗 ${draft.sourceUrl}`,
    draft.description ? `\n${truncate(draft.description, 240)}` : '',
    `\nid: ${draft.id}`,
  ].filter(Boolean)
  return sendWithKeyboard(env, chatId, lines.join('\n'), [
    [
      { text: '✅ Publish', callback_data: `p:${draft.id}` },
      { text: '✏️ Edit title', callback_data: `e:${draft.id}` },
    ],
    [
      { text: '🏷 Category', callback_data: `c:${draft.id}` },
      { text: '❌ Cancel', callback_data: `x:${draft.id}` },
    ],
  ])
}

async function publishDraftById(env, chatId, draftId, messageId) {
  const draft = await readDraft(env, draftId)
  if (!draft) {
    if (messageId) await editMessage(env, chatId, messageId, 'That draft expired or was already published.')
    return
  }
  const video = await publishDraft(env, draft)
  await removeDraftEverywhere(env, draft.id)
  const done =
    `✅ Published\n📝 ${video.title}\n🏷 ${video.category}` +
    `${video.durationSec ? ` · ${formatDuration(video.durationSec)}` : ''}\nid: ${video.id}`
  if (messageId) await editMessage(env, chatId, messageId, done)
  else await send(env, chatId, done)
  if (draft.batchId) await advanceBatch(env, chatId, draft.batchId)
}

/** Sends the next unreviewed draft of a gallery batch, if any are left. */
async function advanceBatch(env, chatId, batchId) {
  const ids = await readBatch(env, batchId)
  for (const id of ids) {
    const draft = await readDraft(env, id)
    if (draft) {
      await send(env, chatId, `🔎 Next draft (${ids.length} in this batch):`)
      return sendDraftCard(env, chatId, draft)
    }
  }
  await env.VIDEOS.delete(`batch:${batchId}`)
  return send(env, chatId, '✅ That gallery batch is finished — nothing left to review.')
}

async function publishDraft(env, draft) {
  const id = `w-${randomId(10)}`
  const record = {
    id,
    kind: 'link',
    title: draft.title,
    sourceUrl: draft.sourceUrl,
    sourceKind: draft.sourceKind || 'page',
    thumbUrl: draft.thumbUrl || '',
    description: draft.description || '',
    durationSec: draft.durationSec || 0,
    category: draft.category || DEFAULT_CATEGORY,
    tags: draft.tags?.length ? draft.tags : [draft.category || DEFAULT_CATEGORY],
    site: draft.site || '',
    source: 'scrape',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await env.VIDEOS.put(`v:${id}`, JSON.stringify(record))
  const ids = await readIndex(env)
  ids.unshift(id)
  await env.VIDEOS.put('idx', JSON.stringify(ids.slice(0, MAX_INDEX)))
  return record
}

async function publishBatch(env, chatId, batchId) {
  const ids = await readBatch(env, batchId)
  if (!ids.length) return send(env, chatId, 'That batch is empty or expired.')
  let published = 0
  for (const draftId of ids) {
    const draft = await readDraft(env, draftId)
    if (!draft) continue
    await publishDraft(env, draft)
    await removeDraftEverywhere(env, draftId)
    published += 1
  }
  return send(env, chatId,
    `✅ Published ${published} video${published === 1 ? '' : 's'}.\nSee them with /videos.`)
}

async function reviewBatch(env, chatId, batchId) {
  const ids = await readBatch(env, batchId)
  if (!ids.length) return send(env, chatId, 'That batch is empty or expired.')
  const remaining = []
  for (const id of ids) {
    const draft = await readDraft(env, id)
    if (draft) remaining.push(draft)
  }
  if (!remaining.length) return send(env, chatId, 'Nothing left in that batch.')
  return sendDraftCard(env, chatId, remaining[0])
}

async function cancelBatch(env, chatId, batchId) {
  const ids = await readBatch(env, batchId)
  for (const id of ids) await removeDraftEverywhere(env, id)
  await env.VIDEOS.delete(`batch:${batchId}`)
  return send(env, chatId, `❌ Discarded ${ids.length} draft${ids.length === 1 ? '' : 's'}. Nothing was published.`)
}

async function readBatch(env, batchId) {
  try {
    const raw = await env.VIDEOS.get(`batch:${batchId}`)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function cancelDraft(env, chatId, draftId, messageId) {
  const draft = await readDraft(env, draftId)
  await removeDraftEverywhere(env, draftId)
  if (messageId) await editMessage(env, chatId, messageId, '❌ Draft discarded — nothing was published.')
  else await send(env, chatId, '❌ Draft discarded — nothing was published.')
  if (draft?.batchId) await advanceBatch(env, chatId, draft.batchId)
}

async function sendPending(env, chatId) {
  const ids = await readDraftIndex(env)
  const drafts = []
  for (const id of ids) {
    const draft = await readDraft(env, id)
    if (draft) drafts.push(draft)
  }
  if (!drafts.length) {
    return send(env, chatId, 'No drafts waiting. Paste a link and I will scrape it for review.')
  }
  const shown = drafts.slice(0, 10)
  const lines = ['🕒 Drafts waiting for review:', '']
  for (const [index, draft] of shown.entries()) {
    lines.push(`${index + 1}. ${truncate(draft.title, 70)}\n    ${draft.category} · ${draft.sourceUrl}`)
  }
  if (drafts.length > shown.length) lines.push(`…and ${drafts.length - shown.length} more.`)
  const keyboard = shown.map((draft) => ([
    { text: `✅ ${index1(shown, draft)} ${truncate(draft.title, 28)}`, callback_data: `p:${draft.id}` },
  ]))
  return sendWithKeyboard(env, chatId, truncate(lines.join('\n'), TEXT_LIMIT), keyboard)
}

function index1(list, item) {
  return list.indexOf(item) + 1
}

/* --------------------------- published list ------------------------------ */

async function sendVideoList(env, chatId, page = 0) {
  const ids = await readIndex(env)
  if (!ids.length) {
    return send(env, chatId, 'No videos published by this bot yet. Send me a video or a link to add the first one.')
  }
  const pages = Math.max(1, Math.ceil(ids.length / LIST_PAGE_SIZE))
  const current = Math.min(Math.max(0, page), pages - 1)
  const slice = ids.slice(current * LIST_PAGE_SIZE, current * LIST_PAGE_SIZE + LIST_PAGE_SIZE)

  const lines = [`🎬 Videos published by this bot — page ${current + 1}/${pages} (${ids.length} total)`, '']
  const keyboard = []
  for (const [offset, id] of slice.entries()) {
    const video = await readVideo(env, id)
    if (!video) continue
    const number = current * LIST_PAGE_SIZE + offset + 1
    lines.push(
      `${number}. ${truncate(video.title, 70)}\n` +
      `    🏷 ${video.category}${video.durationSec ? ` · ⏱ ${formatDuration(video.durationSec)}` : ''}` +
      `${video.kind === 'link' ? ' · link' : ''}\n` +
      `    id: ${id}`,
    )
    keyboard.push([
      { text: `✏️ Rename ${number}`, callback_data: `r:${id}` },
      { text: `🗑 Delete ${number}`, callback_data: `d:${id}` },
    ])
  }

  const nav = []
  if (current > 0) nav.push({ text: '◀ Prev', callback_data: `g:${current - 1}` })
  if (current < pages - 1) nav.push({ text: 'Next ▶', callback_data: `g:${current + 1}` })
  if (nav.length) keyboard.push(nav)

  return sendWithKeyboard(env, chatId, truncate(lines.join('\n'), TEXT_LIMIT), keyboard)
}

async function beginRename(env, chatId, userId, videoId) {
  const video = await readVideo(env, videoId)
  if (!video) return send(env, chatId, `No video with id ${videoId}. See /videos.`)
  await setState(env, userId, { action: 'rename-video', videoId })
  return send(env, chatId,
    `✏️ Send the new title for:\n“${video.title}”\n\nOr /cancel to keep it.`)
}

async function applyRename(env, chatId, videoId, title) {
  const video = await readVideo(env, videoId)
  if (!video) return send(env, chatId, `No video with id ${videoId}. See /videos.`)
  const clean = title.trim().slice(0, 180)
  if (!clean) return send(env, chatId, 'The title cannot be empty.')
  video.title = clean
  video.updatedAt = Date.now()
  await env.VIDEOS.put(`v:${video.id}`, JSON.stringify(video))
  return send(env, chatId, `✅ Renamed to:\n“${clean}”\n\nThe website picks this up within a minute.`)
}

async function confirmDelete(env, chatId, videoId) {
  const video = await readVideo(env, videoId)
  if (!video) return send(env, chatId, `No video with id ${videoId}.`)
  return sendWithKeyboard(env, chatId,
    `🗑 Delete “${truncate(video.title, 100)}”?\nThis removes it from the website.`,
    [[
      { text: '🗑 Yes, delete', callback_data: `dc:${videoId}` },
      { text: '↩️ Keep it', callback_data: `dx:${videoId}` },
    ]])
}

async function deleteVideo(env, chatId, videoId, messageId) {
  const video = await readVideo(env, videoId)
  const ok = await removeVideo(env, videoId)
  if (messageId) {
    await editMessage(env, chatId, messageId,
      ok ? `🗑 Deleted “${truncate(video?.title || videoId, 90)}”.` : `No video with id ${videoId}.`)
    return
  }
  return send(env, chatId, ok ? `🗑 Deleted ${videoId}.` : `No video with id ${videoId}.`)
}

/* ------------------------- category / edit state ------------------------- */

async function sendCategoryPicker(env, chatId, id, target) {
  // 25 categories in rows of 5; callback carries the index to stay under 64 bytes.
  const rows = []
  for (let index = 0; index < CATEGORIES.length; index += 5) {
    rows.push(
      CATEGORIES.slice(index, index + 5).map((category, offset) => ({
        text: category,
        callback_data: `${target === 'draft' ? 'k' : 'V'}:${id}:${index + offset}`,
      })),
    )
  }
  return sendWithKeyboard(env, chatId,
    target === 'draft' ? '🏷 Pick a category for this draft:' : '🏷 Pick a new category:',
    rows)
}

async function setDraftCategory(env, chatId, draftId, index, messageId) {
  const draft = await readDraft(env, draftId)
  const category = CATEGORIES[index]
  if (!draft || !category) return send(env, chatId, 'That draft expired.')
  draft.category = category
  if (!draft.tags?.length) draft.tags = [category]
  await env.VIDEOS.put(`draft:${draft.id}`, JSON.stringify(draft))
  if (messageId) await editMessage(env, chatId, messageId, `🏷 Category set to ${category}. Publishing next?`)
  return sendDraftCard(env, chatId, draft)
}

async function setVideoCategory(env, chatId, videoId, index, messageId) {
  const video = await readVideo(env, videoId)
  const category = CATEGORIES[index]
  if (!video || !category) return send(env, chatId, 'No such video.')
  video.category = category
  video.updatedAt = Date.now()
  await env.VIDEOS.put(`v:${video.id}`, JSON.stringify(video))
  if (messageId) await editMessage(env, chatId, messageId, `🏷 Category set to ${category}.`)
  return send(env, chatId, `✅ “${truncate(video.title, 80)}” is now in ${category}.`)
}

async function beginEdit(env, chatId, userId, action, payload, target) {
  if (target === 'draft') {
    const draft = await readDraft(env, payload.draftId)
    if (!draft) return send(env, chatId, 'That draft expired.')
    await setState(env, userId, { action: `draft-${action}`, draftId: draft.id })
    return send(env, chatId, `✏️ Send the new title for:\n“${draft.title}”\n\nOr /cancel.`)
  }
  return send(env, chatId, 'Nothing to edit.')
}

async function setState(env, userId, state) {
  try {
    await env.VIDEOS.put(`state:${userId}`, JSON.stringify({ ...state, at: Date.now() }), {
      expirationTtl: Math.ceil(STATE_TTL_MS / 1000),
    })
  } catch {
    /* KV without TTL support still works; state just lives longer */
    await env.VIDEOS.put(`state:${userId}`, JSON.stringify({ ...state, at: Date.now() }))
  }
}

async function getState(env, userId) {
  try {
    const raw = await env.VIDEOS.get(`state:${userId}`)
    if (!raw) return null
    const state = JSON.parse(raw)
    if (Date.now() - Number(state.at || 0) > STATE_TTL_MS) return null
    return state
  } catch {
    return null
  }
}

async function clearState(env, userId) {
  await env.VIDEOS.delete(`state:${userId}`)
}

/** Applies the "send me the new title" step. Returns a Response or null. */
async function consumeEditState(env, msg) {
  const state = await getState(env, msg.from.id)
  if (!state) return null
  const chatId = msg.chat.id
  const text = (msg.text || '').trim()
  if (!text) return null

  if (state.action === 'draft-title') {
    const draft = await readDraft(env, state.draftId)
    await clearState(env, msg.from.id)
    if (!draft) {
      await send(env, chatId, 'That draft expired.')
      return new Response('ok')
    }
    draft.title = text.slice(0, 180)
    await env.VIDEOS.put(`draft:${draft.id}`, JSON.stringify(draft))
    await sendDraftCard(env, chatId, draft)
    return new Response('ok')
  }

  if (state.action === 'rename-video') {
    await clearState(env, msg.from.id)
    await applyRename(env, chatId, state.videoId, text)
    return new Response('ok')
  }

  return null
}

/* -------------------------------- storage -------------------------------- */

async function readIndex(env) {
  try {
    const raw = await env.VIDEOS.get('idx')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function readVideo(env, id) {
  try {
    const raw = await env.VIDEOS.get(`v:${id}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function removeVideo(env, id) {
  const existing = await readVideo(env, id)
  if (!existing) return false
  await env.VIDEOS.delete(`v:${id}`)
  const ids = (await readIndex(env)).filter((x) => x !== id)
  await env.VIDEOS.put('idx', JSON.stringify(ids))
  return true
}

/* -------------------------------- ownership ------------------------------- */

async function resolveOwner(env, msg) {
  const allowlist = parseIdList(env.ALLOWED_USER_IDS)
  if (allowlist.length) {
    return { isOwner: allowlist.includes(String(msg.from.id)), needsClaim: false, claimedNow: false }
  }
  const stored = await env.VIDEOS.get('cfg:owner')
  if (stored) {
    const owner = JSON.parse(stored)
    return { isOwner: String(owner.userId) === String(msg.from.id), needsClaim: false, claimedNow: false }
  }
  if ((msg.text || '').trim().toLowerCase().startsWith('/start')) {
    await env.VIDEOS.put('cfg:owner', JSON.stringify({ userId: msg.from.id, chatId: msg.chat.id }))
    return { isOwner: true, needsClaim: false, claimedNow: true }
  }
  return { isOwner: false, needsClaim: true, claimedNow: false }
}

async function isOwner(env, userId) {
  const allowlist = parseIdList(env.ALLOWED_USER_IDS)
  if (allowlist.length) return allowlist.includes(String(userId))
  const stored = await env.VIDEOS.get('cfg:owner')
  if (!stored) return false
  try {
    return String(JSON.parse(stored).userId) === String(userId)
  } catch {
    return false
  }
}

async function ownerChatId(env) {
  const stored = await env.VIDEOS.get('cfg:owner')
  if (stored) {
    try { return JSON.parse(stored).chatId } catch { /* fall through */ }
  }
  const [first] = parseIdList(env.ALLOWED_USER_IDS)
  return first ? Number(first) : null
}

function deny(env, chatId, userId) {
  return send(env, chatId,
    `🚫 You are not authorised to publish to this website.\nYour Telegram user ID is ${userId} — the site owner can add it to ALLOWED_USER_IDS in the Worker settings.`)
}

/* -------------------------------- helpers ---------------------------------- */

async function tg(env, method, body) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  } catch {
    return null
  }
}

function send(env, chatId, text) {
  return tg(env, 'sendMessage', {
    chat_id: chatId,
    text: truncate(text, 4096),
    disable_web_page_preview: true,
  })
}

/** sendMessage with an inline keyboard (rows of buttons). */
function sendWithKeyboard(env, chatId, text, keyboard) {
  return tg(env, 'sendMessage', {
    chat_id: chatId,
    text: truncate(text, 4096),
    disable_web_page_preview: true,
    ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })
}

function editMessage(env, chatId, messageId, text) {
  if (!messageId) return send(env, chatId, text)
  return tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: truncate(text, 4096),
    disable_web_page_preview: true,
  })
}

function answerCallback(env, callbackId, text, alert = false) {
  return tg(env, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    ...(text ? { text } : {}),
    ...(alert ? { show_alert: true } : {}),
  })
}

function truncate(value, limit) {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function parseIdList(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean)
}

function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
}

function formatDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

/** URL-safe random id (no crypto.getRandomValues dependency in tests). */
function randomId(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  try {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) out += alphabet[byte % alphabet.length]
    return out
  } catch {
    for (let index = 0; index < length; index += 1) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)]
    }
    return out
  }
}

async function shortHash(input) {
  const data = new TextEncoder().encode(String(input))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')
}
