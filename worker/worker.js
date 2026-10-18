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
 * Endpoints
 * ---------
 *   POST /telegram/webhook         Telegram updates (messages, channel posts)
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
 *   /list             owner only: recently published videos
 *   /remove <id>      owner only: unpublish a video (id shown in confirmations)
 *   (send a video)    publish it. Caption's first line = title,
 *                     #Hashtags = tags; a hashtag matching a site category
 *                     (e.g. #POV, #Big_Ass) sets the category.
 *
 * Telegram Bot API limit: bots can only download files up to 20 MB, so
 * videos larger than that are registered but NOT published to the feed;
 * the bot tells you when this happens.
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

const filePathCache = new Map() // fileId -> { path, at }

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
    .map((v) => ({
      id: v.id,
      title: v.title,
      category: v.category,
      tags: v.tags,
      durationSec: v.durationSec,
      width: v.width,
      height: v.height,
      createdAt: v.createdAt,
      streamUrl: `${origin}/api/videos/${v.id}/stream.mp4`,
      thumbUrl: v.thumbFileId ? `${origin}/api/videos/${v.id}/thumb.jpg` : null,
    }))
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
  if (update.message) return processMessage(update.message, env)
  if (update.channel_post) return processChannelPost(update.channel_post, env)
}

async function processMessage(msg, env) {
  const chatId = msg.chat?.id
  const userId = msg.from?.id
  if (chatId == null || userId == null) return
  const owner = await resolveOwner(env, msg)

  const text = (msg.text || '').trim()
  if (text.startsWith('/')) {
    const [commandRaw, ...rest] = text.split(/\s+/)
    const command = commandRaw.split('@')[0].toLowerCase()
    const arg = rest.join(' ').trim()
    if (command === '/start') {
      return send(env, chatId,
        (owner.claimedNow
          ? '✅ You are now the owner of this bot — only you can publish videos.\n\n'
          : '👋 AfterDark publisher bot.\n\n') +
        'Forward or send me any video and I will post it on the website with its real thumbnail.\n' +
        '• The caption\'s first line becomes the title\n' +
        '• #Hashtags become tags; one matching a category (e.g. #POV, #Big_Ass) sets the category\n' +
        '• Videos must be 20 MB or smaller (Telegram bot limit)\n\n' +
        'Commands: /list · /remove <id> · /id')
    }
    if (command === '/id') {
      return send(env, chatId, `Your Telegram user ID: ${userId}`)
    }
    if (command === '/list') {
      if (!owner.isOwner) return deny(env, chatId, userId)
      const ids = (await readIndex(env)).slice(0, 10)
      if (!ids.length) return send(env, chatId, 'No videos published yet. Forward me a video to post the first one.')
      const recs = await Promise.all(ids.map((id) => readVideo(env, id)))
      const lines = recs.filter(Boolean).map((v, i) =>
        `${i + 1}. ${v.title} (${formatDuration(v.durationSec)}) — ${v.id}${v.tooLarge ? ' ⚠️ over 20 MB, not on site' : ''}`)
      return send(env, chatId, `Latest videos:\n${lines.join('\n')}`)
    }
    if (command === '/remove') {
      if (!owner.isOwner) return deny(env, chatId, userId)
      if (!arg) return send(env, chatId, 'Usage: /remove <id> — see ids with /list.')
      const ok = await removeVideo(env, arg)
      return send(env, chatId, ok ? `🗑 Removed ${arg} from the website.` : `No video with id ${arg}.`)
    }
    return send(env, chatId, 'Unknown command. Send me a video to publish it, or try /list.')
  }

  const video = extractVideo(msg)
  if (!video) {
    if (owner.isOwner || owner.needsClaim) {
      return send(env, chatId, owner.needsClaim
        ? 'Send /start first so I know you are the owner, then forward me a video.'
        : 'Send or forward me a video and I will post it on the website.')
    }
    return deny(env, chatId, userId)
  }
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
    `✅ Posted to the website!\n“${v.title}” · ${v.category} · ${formatDuration(v.durationSec)}\nVideo id: ${v.id} (use /remove ${v.id} to take it down)`)
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
  return tg(env, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true })
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

async function shortHash(input) {
  const data = new TextEncoder().encode(String(input))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')
}
