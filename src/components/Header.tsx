import { CHANNEL_MAP } from '../data/seed'
import { useCallback, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  Menu,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import BrandLogo from './BrandLogo'
import ThemeToggle from './ThemeToggle'
import { useClickOutside, useEscape } from '../lib/hooks'

interface HeaderProps {
  onToggleSidebar: () => void
}

// The bell feed shows the uploader's own face, pulled from the channel
// roster, so it matches the avatar on the video it announces.
const POV = CHANNEL_MAP['pov-central']!
const NOTIFICATIONS = [
  { id: 1, avatar: POV.avatar, text: 'POV Central uploaded “POV MILF Slut With Huge Watermelons Takes On A Huge Cock [Kat Mar10]”', time: '2h ago' },
  { id: 2, avatar: POV.avatar, text: 'POV Central uploaded “Tatum Christine - Sister Wants Step Brothers Cock”', time: '5h ago' },
  { id: 3, avatar: POV.avatar, text: 'POV Central uploaded “!! Risky Proposition!! Innocent Hooters Waitress Reveals Her Dirtiest Secrets”', time: '8h ago' },
]

export default function Header({ onToggleSidebar }: HeaderProps) {
  const [query, setQuery] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const navigate = useNavigate()

  const closeNotifications = useCallback(() => setNotificationsOpen(false), [])
  const notificationsRef = useClickOutside<HTMLDivElement>(closeNotifications, notificationsOpen)
  useEscape(closeNotifications, notificationsOpen)

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const value = query.trim()
    navigate(value ? `/results?q=${encodeURIComponent(value)}` : '/')
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center gap-2 border-b border-line bg-surface px-3 sm:px-5">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition hover:bg-raise lg:hidden"
        aria-label="Toggle menu"
      >
        <Menu size={22} strokeWidth={1.8} />
      </button>

      <div className="hidden w-[192px] shrink-0 lg:block">
        <BrandLogo />
      </div>
      <div className="lg:hidden">
        <BrandLogo compact />
      </div>

      <div className="ml-2 flex flex-1 items-center justify-center gap-2 sm:ml-4">
        <form onSubmit={submitSearch} className="hidden max-w-[620px] flex-1 items-center md:flex">
          <div className="flex h-10 w-full items-center rounded-full border border-line bg-surface pl-5 pr-1 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search videos, pornstars, categories..."
              aria-label="Search"
              className="h-full min-w-0 flex-1 bg-transparent pr-2 text-[15px] text-ink placeholder:text-faint"
            />
            <button
              type="submit"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-raise hover:text-ink"
              aria-label="Search"
            >
              <Search size={19} strokeWidth={2} />
            </button>
          </div>
        </form>

        <button
          type="button"
          className="hidden h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition hover:bg-raise md:grid"
          aria-label="Search filters"
          onClick={() => navigate('/results' + (query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''))}
        >
          <SlidersHorizontal size={20} strokeWidth={1.9} />
        </button>

        <Link
          to="/results"
          className="grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-raise md:hidden"
          aria-label="Search"
        >
          <Search size={21} strokeWidth={1.9} />
        </Link>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <ThemeToggle />

        <div className="relative" ref={notificationsRef}>
          <button
            type="button"
            onClick={() => setNotificationsOpen((open) => !open)}
            className="relative grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-raise"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
          >
            <Bell size={21} strokeWidth={1.8} />
            <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-surface bg-brand-600 px-1 text-[10px] font-bold leading-none text-white">
              3
            </span>
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 top-12 w-[340px] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] dark:bg-panel dark:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)]">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-[15px] font-semibold">Notifications</p>
                <button className="text-[12px] font-semibold text-brand-600 hover:underline">
                  Mark all read
                </button>
              </div>
              <ul className="max-h-[320px] overflow-y-auto py-1">
                {NOTIFICATIONS.map((item) => (
                  <li key={item.id}>
                    <button className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-raise">
                      <img src={item.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
                      <span className="min-w-0">
                        <span className="block text-[13px] leading-snug text-ink">{item.text}</span>
                        <span className="mt-0.5 block text-[12px] text-muted">{item.time}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
