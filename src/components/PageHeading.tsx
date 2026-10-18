import type { ReactNode } from 'react'

interface PageHeadingProps {
  title: string
  subtitle?: string
  action?: ReactNode
  children?: ReactNode
}

export default function PageHeading({ title, subtitle, action, children }: PageHeadingProps) {
  return (
    <div className="mb-6 mt-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.035em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>}
        {children}
      </div>
      {action}
    </div>
  )
}
