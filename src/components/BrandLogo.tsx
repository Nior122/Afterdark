/**
 * Brand mark — deliberately not a link. The site has no home page to go to.
 */
export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2.5">
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
    </span>
  )
}
