#!/usr/bin/env node
/**
 * Bundles scripts/render-check.tsx with esbuild and runs it.
 *
 * The checker imports the real React tree (App, store, seed catalogue), so it
 * validates what visitors and crawlers actually get, not the source code.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, 'node_modules/.tmp/render-check.cjs')

await mkdir(dirname(outfile), { recursive: true })
await build({
  entryPoints: [join(root, 'scripts/render-check.tsx')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  outfile,
  logLevel: 'warning',
  define: {
    'import.meta.env': JSON.stringify({
      VITE_SITE_URL: 'http://localhost:4173',
      VITE_TELEGRAM_FEED_URL: '',
    }),
  },
})

await import(`${outfile}?run=${Date.now()}`)
