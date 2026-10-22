/**
 * Build-time catalogue loader.
 *
 * The catalogue lives in TypeScript (`src/data/seed.ts`), so the prerender step
 * bundles just that module with esbuild and reads the exported array. Nothing
 * is written to disk; the JSON is returned to the caller.
 */
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function loadCatalogue() {
  const outfile = join(root, 'node_modules/.tmp/catalogue.cjs')
  const entry = join(root, 'scripts/catalogue-entry.ts')

  await mkdir(dirname(outfile), { recursive: true })
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'warning',
    define: {
      'import.meta.env': JSON.stringify({ BASE_URL: '/', VITE_TELEGRAM_FEED_URL: undefined }),
    },
  })

  const module = await import(`${outfile}?v=${Date.now()}`)
  await rm(outfile, { force: true })
  return module.SEED_VIDEOS
}
