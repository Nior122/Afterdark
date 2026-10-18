import { asset } from '../lib/asset'
import { useCallback, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  Menu,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  User,
  Video,
} from 'lucide-react'
import BrandLogo from './BrandLogo'
import { AVATARS } from '../data/seed'
import { useClickOutside, useEscape } from '../lib/hooks'

interface HeaderProps {
  onCreate: () => void
  onToggleSidebar: () => void
}

const NOTIFICATIONS = [
  { id: 1, avatar: asset("/avatars/chillwave.svg"), text: 'ChillWave uploaded “Inside the Neon Tour”', time: '2h ago' },
  { id: 2, avatar: asset("/avatars/techbit.svg"), text: 'TechBit is live: Building a silent PC', time: '5h ago' },
  { id: 3, avatar: asset("/avatars/newsnow.jpg"), text: 'NewsNow posted a new morning brief', time: '8h ago' },
]

export default function Header({ onCreate, onToggleSidebar }: HeaderProps) {
  const [query, setQuery] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const navigate = useNavigate()

  const closeNotifications = useCallback(() => setNotificationsOpen(false), [])
  const closeAccount = useCallback(() => setAccountOpen(false), [])
  const notificationsRef = useClickOutside<HTMLDivElement>(closeNotifications, notificationsOpen)
  const accountRef = useClickOutside<HTMLDivElement>(closeAccount, accountOpen)
  useEscape(closeNotifications, notificationsOpen)

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const value = query.trim()
    navigate(value ? `/results?q=${encodeURIComponent(value)}` : '/')
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center gap-2 border-b border-[#f2f2f4] bg-white px-3 sm:px-5">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition hover:bg-[#f2f2f4] lg:hidden"
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
          <div className="flex h-10 w-full items-center rounded-full border border-[#e6e6ea] bg-white pl-5 pr-1 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search videos, channels, or topics..."
              aria-label="Search"
              className="h-full min-w-0 flex-1 bg-transparent pr-2 text-[15px] text-ink placeholder:text-[#8f8f97]"
            />
            <button
              type="submit"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#606060] transition hover:bg-[#f2f2f4] hover:text-ink"
              aria-label="Search"
            >
              <Search size={19} strokeWidth={2} />
            </button>
          </div>
        </form>

        <button
          type="button"
          className="hidden h-10 w-10 shrink-0 place-items-center rounded-full text-ink transition hover:bg-[#f2f2f4] md:grid"
          aria-label="Search filters"
          onClick={() => navigate('/results' + (query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''))}
        >
          <SlidersHorizontal size={20} strokeWidth={1.9} />
        </button>

        <Link
          to="/results"
          className="grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-[#f2f2f4] md:hidden"
          aria-label="Search"
        >
          <Search size={21} strokeWidth={1.9} />
        </Link>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-3.5 text-[14px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(109,40,217,0.9)] transition hover:brightness-105 active:scale-[0.98] sm:px-4"
        >
          <Plus size={19} strokeWidth={2.4} />
          <span className="hidden sm:inline">Create</span>
        </button>

        <div className="relative" ref={notificationsRef}>
          <button
            type="button"
            onClick={() => {
              setNotificationsOpen((open) => !open)
              setAccountOpen(false)
            }}
            className="relative grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-[#f2f2f4]"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
          >
            <Bell size={21} strokeWidth={1.8} />
            <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-white bg-brand-600 px-1 text-[10px] font-bold leading-none text-white">
              3
            </span>
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 top-12 w-[340px] overflow-hidden rounded-2xl border border-line bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)]">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-[15px] font-semibold">Notifications</p>
                <button className="text-[12px] font-semibold text-brand-600 hover:underline">
                  Mark all read
                </button>
              </div>
              <ul className="max-h-[320px] overflow-y-auto py-1">
                {NOTIFICATIONS.map((item) => (
                  <li key={item.id}>
                    <button className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[#f7f7f9]">
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

        <div className="relative" ref={accountRef}>
          <button
            type="button"
            onClick={() => {
              setAccountOpen((open) => !open)
              setNotificationsOpen(false)
            }}
            className="flex items-center gap-1 rounded-full p-0.5 transition hover:bg-[#f2f2f4]"
            aria-label="Account menu"
            aria-expanded={accountOpen}
          >
            <img
              src={AVATARS.user}
              alt="Your avatar"
              className="h-9 w-9 rounded-full object-cover ring-1 ring-black/5"
            />
          </button>

          {accountOpen && (
            <div className="absolute right-0 top-12 w-[280px] overflow-hidden rounded-2xl border border-line bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)]">
              <div className="flex items-center gap-3 border-b border-line px-4 py-4">
                <img src={AVATARS.user} alt="" className="h-11 w-11 rounded-full object-cover" />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">Alex Rivera</p>
                  <p className="truncate text-[13px] text-muted">alex@gridwatch.tv</p>
                </div>
              </div>
              <div className="py-1.5">
                <Link
                  to="/channel/you"
                  onClick={closeAccount}
                  className="flex items-center gap-3 px-4 py-2.5 text-[14px] hover:bg-[#f7f7f9]"
                >
                  <User size={18} className="text-muted" /> Your channel
                </Link>
                <Link
                  to="/library"
                  onClick={closeAccount}
                  className="flex items-center gap-3 px-4 py-2.5 text-[14px] hover:bg-[#f7f7f9]"
                >
                  <Video size={18} className="text-muted" /> Your videos
                </Link>
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] hover:bg-[#f7f7f9]">
                  <Settings size={18} className="text-muted" /> Settings
                </button>
              </div>
              <div className="border-t border-line py-1.5">
                <button className="w-full px-4 py-2.5 text-left text-[14px] text-muted hover:bg-[#f7f7f9] hover:text-ink">
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
