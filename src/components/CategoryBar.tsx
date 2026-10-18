import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { CATEGORIES } from '../data/seed'

export default function CategoryBar({ active = 'All' }: { active?: string }) {
  const scroller = useRef<HTMLDivElement>(null)

  function scrollNext() {
    const el = scroller.current
    if (!el) return
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8
    el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + 360, behavior: 'smooth' })
  }

  return (
    <div className="sticky top-16 z-20 -mx-4 bg-white/95 px-4 pb-2 pt-2 backdrop-blur sm:-mx-5 sm:px-5 xl:-mx-6 xl:px-6">
      <div className="relative">
        <div
          ref={scroller}
          className="no-scrollbar flex items-center gap-3 overflow-x-auto pr-14 scroll-smooth"
        >
          {CATEGORIES.map((category) => {
            const isActive = category.toLowerCase() === active.toLowerCase()
            return (
              <Link
                key={category}
                to={category === 'All' ? '/' : `/browse/${category}`}
                className={[
                  'flex h-[38px] shrink-0 items-center rounded-full px-4 text-[14px] font-medium transition',
                  isActive
                    ? 'bg-brand-600 text-white shadow-[0_4px_12px_-4px_rgba(109,40,217,0.6)]'
                    : 'bg-[#f2f2f4] text-ink hover:bg-[#e8e8ec]',
                ].join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                {category}
              </Link>
            )
          })}
        </div>

        <div className="pointer-events-none absolute right-0 top-0 flex h-full w-20 items-center justify-end bg-gradient-to-l from-white via-white/90 to-transparent">
          <button
            type="button"
            onClick={scrollNext}
            aria-label="Scroll categories"
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full border border-[#e6e6ea] bg-white text-ink shadow-sm transition hover:bg-[#f7f7f9]"
          >
            <ChevronRight size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
