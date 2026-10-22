#!/usr/bin/env node
/**
 * Serve dist/ the way GitHub Pages / Cloudflare Pages do:
 *
 *   npm run preview:static           (after `npm run build`, port 4173)
 *
 * `/v/<id>/` resolves to `v/<id>/index.html` (200). Anything that does not
 * exist falls back to `404.html` with a real 404 status, which is what those
 * hosts do and what keeps "/" and unknown routes out of search indexes.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const port = Number(process.env.PORT || 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
}

async function fileAt(path) {
  try {
    const info = await stat(path)
    return info.isFile() ? path : null
  } catch {
    return null
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname.includes('..')) {
    response.writeHead(400).end('Bad request')
    return
  }

  const candidates = []
  if (pathname.endsWith('/')) candidates.push(join(dist, pathname, 'index.html'))
  else {
    candidates.push(join(dist, pathname))
    candidates.push(join(dist, `${pathname}.html`))
    candidates.push(join(dist, pathname, 'index.html'))
  }

  for (const candidate of candidates) {
    const file = await fileAt(normalize(candidate))
    if (file) {
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
      createReadStream(file).pipe(response)
      return
    }
  }

  const fallback = await fileAt(join(dist, '404.html'))
  response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
  if (fallback) createReadStream(fallback).pipe(response)
  else response.end('Not found')
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Serving dist/ on http://0.0.0.0:${port}`)
})
