import { Link, useInRouterContext } from 'react-router-dom'

/**
 * The wordmark. It is a link home, but it is also used by the age gate, which
 * renders *before* any router exists — so it must survive having no router
 * around it. Rendering a <Link> outside a router throws and blanks the page
 * (that was a real bug), hence the context check.
 */
export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  const inRouter = useInRouterContext()
  const className = 'flex shrink-0 items-center gap-2.5 rounded-lg outline-offset-4'
  const content = (
    <>
      <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-[0_5px_14px_-6px_rgba(190,18,60,0.8)]">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] translate-x-[1px]" aria-hidden="true">
          <path d="M7 4.8 20 12 7 19.2Z" fill="white" stroke="white" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && (
        <span className="flex items-center gap-2 text-[22px] font-extrabold leading-none tracking-[-0.035em] text-ink">
          AfterDark
          <span className="rounded-md bg-brand-600 px-1.5 py-1 text-[10px] font-extrabold leading-none tracking-normal text-white">
            18+
          </span>
        </span>
      )}
    </>
  )

  if (!inRouter) {
    // No router yet (age gate): a plain, non-clickable wordmark is correct —
    // there is nowhere to navigate to before the gate is passed.
    return (
      <span className={className} aria-label="AfterDark">
        {content}
      </span>
    )
  }

  return (
    <Link to="/" className={className} aria-label="AfterDark home">
      {content}
    </Link>
  )
}
