import { useEffect } from 'react'
import { applyNeutralMeta } from '../lib/meta'

/**
 * Shown for `/` and for every unknown route.
 *
 * Intentionally bare: no video list, no search, no navigation, no links to a
 * video. A video is reachable only through its own `/v/<id>/` link (or the
 * sitemap).
 */
export default function NotFoundPage() {
  useEffect(() => {
    applyNeutralMeta()
  }, [])

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-[56px] font-extrabold leading-none tracking-[-0.06em] text-brand-600">404</p>
      <h1 className="mt-3 text-[20px] font-bold tracking-[-0.01em] text-ink sm:text-[22px]">
        This page isn’t available
      </h1>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted">
        The link may be wrong, or the video may have been removed. Videos here open only from
        their own direct link.
      </p>
    </main>
  )
}
