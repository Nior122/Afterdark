/**
 * Resolve a file from /public so the build works at any base path
 * (domain root or a GitHub Pages sub-directory). Absolute URLs pass through.
 */
export function asset(path: string): string {
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}
