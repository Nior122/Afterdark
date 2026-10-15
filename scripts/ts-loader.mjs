/**
 * Minimal module hooks so `node --test` and the verification tools can import the
 * app's TypeScript sources directly.
 *
 * Node 22.18+ strips types natively, so we do not need a transpiler — only
 * resolution of the extensionless specifiers a bundler would normally handle
 * (`./arkit` -> `./arkit.ts`, `../lib` -> `../lib/index.ts`).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function resolveCandidate(url) {
  const href = typeof url === 'string' ? url : url.href
  if (href.endsWith('.ts') || href.endsWith('.tsx')) {
    return existsSync(fileURLToPath(href)) ? href : null
  }
  for (const ext of CANDIDATES) {
    const candidate = href + ext
    if (existsSync(fileURLToPath(candidate))) return candidate
  }
  // No TS variant found; let the default resolver have a go.
  return null
}

export async function resolve(specifier, context, nextResolve) {
  // Leave bare package specifiers to Node itself.
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:')) {
    return nextResolve(specifier, context)
  }

  // Bare '@/...' style aliases are not used here, but resolve plain relative paths.
  const base = context.parentURL ?? new URL('file:///').href
  try {
    const direct = new URL(specifier, base)
    const resolved = resolveCandidate(direct)
    if (resolved) return { url: resolved, shortCircuit: true }
  } catch {
    /* fall through to the default resolver */
  }

  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const direct = new URL(specifier, base)
    const resolved = resolveCandidate(direct)
    if (resolved) return { url: resolved, shortCircuit: true }
    throw err
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8')
    return { format: 'module-typescript', source, shortCircuit: true }
  }
  return nextLoad(url, context)
}
