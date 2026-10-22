#!/usr/bin/env node
/**
 * Owner tool: add or remove a video in src/data/videos.json (no UI, no storage).
 *
 *   node scripts/videos.mjs add <url> "<title>" [category] [options]
 *       --description "short text"   optional description shown on the page
 *       --thumbnail <url>            optional remote poster (recommended)
 *       --duration 8:31              optional length, used in metadata
 *
 *   node scripts/videos.mjs remove <id>
 *
 * Adding a video creates a random 12-character id, so its link cannot be
 * guessed or enumerated. Rebuild the site afterwards (`npm run build`) to
 * regenerate its page, sitemap.xml and robots.txt.
 */
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataFile = join(root, 'src/data/videos.json')

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function newId(taken) {
  for (;;) {
    const bytes = randomBytes(12)
    const id = [...bytes].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('')
    if (!taken.has(id)) return id
  }
}

function takeFlags(args) {
  const flags = {}
  const rest = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value.startsWith('--')) {
      const key = value.slice(2)
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for --${key}`)
      flags[key] = next
      index += 1
    } else {
      rest.push(value)
    }
  }
  return { flags, rest }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function readCatalogue() {
  return JSON.parse(await readFile(dataFile, 'utf8'))
}

async function saveCatalogue(videos) {
  await writeFile(dataFile, `${JSON.stringify(videos, null, 2)}\n`, 'utf8')
}

async function add(args) {
  const { flags, rest } = takeFlags(args)
  const [url, title, category = 'POV'] = rest
  if (!url || !title) {
    throw new Error('Usage: node scripts/videos.mjs add <url> "<title>" [category] [--thumbnail url] [--description text] [--duration 8:31]')
  }
  const parsed = new URL(url)
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('The video URL must start with http:// or https://')

  const videos = await readCatalogue()
  const id = newId(new Set(videos.map((video) => video.id)))
  videos.unshift({
    id,
    title: title.trim(),
    thumbnail: (flags.thumbnail || '').trim(),
    duration: (flags.duration || '').trim(),
    views: '',
    addedAt: today(),
    category,
    videoUrl: url.trim(),
    ...(flags.description ? { description: flags.description } : {}),
  })
  await saveCatalogue(videos)

  console.log(`Added “${title.trim()}”`)
  console.log(`  id:   ${id}`)
  console.log(`  page: /v/${id}/`)
  console.log('\nNext: run `npm run build` so the page, sitemap.xml and robots.txt pick it up.')
}

async function remove(args) {
  const [id] = args
  if (!id) throw new Error('Usage: node scripts/videos.mjs remove <id>')
  const videos = await readCatalogue()
  const remaining = videos.filter((video) => video.id !== id)
  if (remaining.length === videos.length) throw new Error(`No video with id ${id}`)
  await saveCatalogue(remaining)
  console.log(`Removed ${id}. Run \`npm run build\` to update the page, sitemap and robots.txt.`)
}

async function list() {
  const videos = await readCatalogue()
  for (const video of videos) {
    console.log(`${video.id}  /v/${video.id}/  ${video.title}`)
  }
}

const [command, ...args] = process.argv.slice(2)
const commands = { add, remove, list }

try {
  const run = commands[command]
  if (!run) throw new Error('Usage: node scripts/videos.mjs <add|remove|list> …')
  await run(args)
} catch (error) {
  console.error(`✗ ${error.message}`)
  process.exit(1)
}
