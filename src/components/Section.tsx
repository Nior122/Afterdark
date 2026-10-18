import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

interface SectionProps {
  title: string
  viewAllTo?: string
  children: ReactNode
}

export default function Section({ title, viewAllTo, children }: SectionProps) {
  return (
    <section className="mt-7 first:mt-4">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-[20px] font-bold tracking-[-0.02em] text-ink">{title}</h2>
        {viewAllTo && (
          <Link
            to={viewAllTo}
            className="group flex items-center gap-1 text-[14px] font-semibold text-brand-600 transition hover:text-brand-700"
          >
            View all
            <ChevronRight size={17} className="transition group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
