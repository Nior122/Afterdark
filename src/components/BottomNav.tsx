import { Link, useLocation } from 'react-router-dom'
import { Clapperboard, Compass, Flame, Home } from 'lucide-react'

/**
 * The tab bar below the content — Home · Categories · Shorts · Trending —
 * the four routes that matter on a phone, where most of this site's traffic
 * arrives from. Shown below the sidebar breakpoint (wide screens already
 * have the rail), only inside the catalogue app, so direct-link mode and the
 * standalone /v/ pages never see it. The active tab carries a filled brand
 * chip and aria-current; the bottom edge respects iOS safe-area insets so
 * the pills sit above the home indicator, and the main column keeps enough
 * bottom padding that nothing hides behind the bar.
 */
const TABS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/explore', label: 'Categories', icon: Compass },
  { to: '/shorts', label: 'Shorts', icon: Clapperboard },
  { to: '/trending', label: 'Trending', icon: Flame },
]

export default function BottomNav() {
  const { pathname } = useLocation()
  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/92 backdrop-blur-md pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="mx-auto grid max-w-xl grid-cols-4 gap-1 px-2 py-1.5">
        {TABS.map(({ to, label, icon: Icon }) => {
          const active = isActive(to)
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              className="group/tab flex flex-col items-center gap-1 rounded-xl py-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <span
                className={`grid h-9 w-16 place-items-center rounded-full transition-colors ${
                  active ? 'bg-brand-100 text-brand-700' : 'text-muted group-active/tab:bg-raise'
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.3 : 1.9} />
              </span>
              <span className={`text-[11px] leading-none ${active ? 'font-bold text-ink' : 'font-medium text-muted'}`}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
