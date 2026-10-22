import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  AudioLines,
  Camera,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Crown,
  Eye,
  Flame,
  Folder,
  Globe,
  Heart,
  History,
  Home,
  ListVideo,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react'
import AdSlot from './AdSlot'
import { ALL_CHANNEL_MAP, browsePath, channelPath } from '../data/seed'
import { useStore } from '../lib/store'

interface SidebarProps {
  open: boolean
  onClose: () => void
}

const MAIN_LINKS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/trending', label: 'Trending', icon: TrendingUp },
  { to: '/subscriptions', label: 'Subscriptions', icon: ListVideo },
  { to: '/library', label: 'Library', icon: Folder },
  { to: '/history', label: 'History', icon: History },
]

const CATEGORY_LINKS = [
  { category: 'POV', icon: Eye },
  { category: 'Amateur', icon: Camera },
  { category: 'MILF', icon: Crown },
  { category: 'Blowjob', icon: Heart },
  { category: 'Big Tits', icon: Sparkles },
  { category: 'Big Ass', icon: Flame },
  { category: 'Latina', icon: Globe },
  { category: 'Hardcore', icon: Zap },
]

const MORE_LINKS = [
  { to: '/watch-later', label: 'Watch Later', icon: Clock },
  { to: '/liked', label: 'Liked Videos', icon: AudioLines },
]

const VISIBLE_SUBS = 4

function itemClasses(active: boolean) {
  return [
    'flex h-10 items-center gap-3 rounded-[10px] px-3 text-[13px] transition-colors',
    active
      ? 'bg-brand-100 font-semibold text-ink'
      : 'font-medium text-body hover:bg-raise',
  ].join(' ')
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { watchLater, subscriptions } = useStore()
  const [showAllSubs, setShowAllSubs] = useState(false)

  const subscribedChannels = subscriptions
    .map((id) => ALL_CHANNEL_MAP[id])
    .filter((channel): channel is NonNullable<typeof channel> => Boolean(channel))

  const visibleSubs = showAllSubs ? subscribedChannels : subscribedChannels.slice(0, VISIBLE_SUBS)

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <aside
        className={[
          'fixed bottom-0 left-0 top-16 z-40 w-[192px] overflow-y-auto border-r border-line bg-surface px-3 pb-10 pt-2 no-scrollbar transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0 shadow-[20px_0_50px_-30px_rgba(0,0,0,0.35)]' : '-translate-x-full',
        ].join(' ')}
      >
        <nav className="flex flex-col gap-0.5">
          {MAIN_LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={onClose} className={({ isActive }) => itemClasses(isActive)}>
              {({ isActive }) => (
                <>
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.1 : 1.8}
                    className={isActive ? 'text-brand-600' : 'text-body'}
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <hr className="mx-1 my-3 border-line" />

        <p className="px-3 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          Categories
        </p>
        <nav className="flex flex-col gap-0.5">
          {CATEGORY_LINKS.map(({ category, icon: Icon }) => (
            <NavLink
              key={category}
              to={browsePath(category)}
              onClick={onClose}
              className={({ isActive }) => itemClasses(isActive)}
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.1 : 1.8}
                    className={isActive ? 'text-brand-600' : 'text-body'}
                  />
                  <span className="min-w-0 flex-1 truncate">{category}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <hr className="mx-1 my-3 border-line" />

        <nav className="flex flex-col gap-0.5">
          {MORE_LINKS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={onClose} className={({ isActive }) => itemClasses(isActive)}>
              {({ isActive }) => (
                <>
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.1 : 1.8}
                    className={isActive ? 'text-brand-600' : 'text-body'}
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {label === 'Watch Later' && watchLater.length > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-raise px-1.5 py-0.5 text-[10.5px] font-medium text-muted">
                      {watchLater.length}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <hr className="mx-1 my-3 border-line" />

        <AdSlot slot="sidebar" className="mx-1 my-3 rounded-xl" />

        <div className="flex h-10 items-center justify-between rounded-[10px] px-3">
          <Link
            to="/subscriptions"
            onClick={onClose}
            className="text-[13.5px] font-semibold text-ink hover:text-brand-700"
          >
            Subscriptions
          </Link>
          <Link to="/subscriptions" onClick={onClose} aria-label="All subscriptions">
            <ChevronRight size={17} className="text-muted" />
          </Link>
        </div>

        <div className="mt-0.5 flex flex-col gap-0.5">
          {visibleSubs.map((channel) => (
            <Link
              key={channel.id}
              to={channelPath(channel.id)}
              onClick={onClose}
              className="flex h-10 items-center gap-3 rounded-[10px] px-3 text-[13px] font-medium text-body transition-colors hover:bg-raise"
            >
              <img src={channel.avatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
              <span className="min-w-0 flex-1 truncate">{channel.name}</span>
              {channel.id === 'pov-central' && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
            </Link>
          ))}
          {subscribedChannels.length === 0 && (
            <p className="px-3.5 py-2 text-[12.5px] leading-relaxed text-muted">
              Channels you subscribe to will appear here.
            </p>
          )}
        </div>

        {subscribedChannels.length >= VISIBLE_SUBS && (
          <button
            type="button"
            onClick={() => setShowAllSubs((value) => !value)}
            className="mt-1 flex h-10 w-full items-center gap-5 rounded-[10px] px-3 text-[13px] font-medium text-body transition hover:bg-raise"
          >
            <ChevronDown
              size={20}
              strokeWidth={1.8}
              className={`text-body transition-transform ${showAllSubs ? 'rotate-180' : ''}`}
            />
            {showAllSubs ? 'Show less' : 'Show more'}
          </button>
        )}

        <div className="mt-5 border-t border-line px-3 pt-4">
          <p className="text-[11px] leading-[1.9] text-faint">
            18+ only · Terms · Privacy · DMCA
            <br />
            Content removal · Contact
            <br />
            <span className="mt-2 inline-block text-[11px] text-faint">© 2026 AfterDark</span>
          </p>
        </div>
      </aside>
    </>
  )
}
