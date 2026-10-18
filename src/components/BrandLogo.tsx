import { Link } from 'react-router-dom'

export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      className="flex shrink-0 items-center gap-2.5 rounded-lg outline-offset-4"
      aria-label="GridWatch home"
    >
      <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-[0_5px_14px_-6px_rgba(109,40,217,0.8)]">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] translate-x-[1px]" aria-hidden="true">
          <path d="M7 4.8 20 12 7 19.2Z" fill="white" stroke="white" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && (
        <span className="text-[22px] font-extrabold leading-none tracking-[-0.035em] text-ink">
          GridWatch
        </span>
      )}
    </Link>
  )
}
