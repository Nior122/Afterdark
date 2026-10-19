import { Link } from 'react-router-dom'
import { Clock3, History, PlaySquare, ThumbsUp } from 'lucide-react'
import PageHeading from '../components/PageHeading'
import Section from '../components/Section'
import VideoGrid from '../components/VideoGrid'
import EmptyState from '../components/EmptyState'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

export default function LibraryPage() {
  const { userVideos, watchLater, liked, history } = useStore()
  usePageTitle('Library')

  const quickLinks = [
    { to: '/history', label: 'History', icon: History, count: history.length },
    { to: '/watch-later', label: 'Watch later', icon: Clock3, count: watchLater.length },
    { to: '/liked', label: 'Liked videos', icon: ThumbsUp, count: liked.length },
  ]

  return (
    <>
      <PageHeading title="Library" subtitle="Everything you have saved, liked and uploaded." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {quickLinks.map(({ to, label, icon: Icon, count }) => (
          <Link
            key={to}
            to={to}
            className="flex h-[88px] items-center gap-3 rounded-xl border border-line bg-panel px-4 transition hover:border-brand-200 hover:bg-brand-50"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700">
              <Icon size={19} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-ink">{label}</span>
              <span className="block text-[12px] text-muted">{count} {count === 1 ? 'item' : 'items'}</span>
            </span>
          </Link>
        ))}
      </div>

      <Section title="Your videos">
        {userVideos.length > 0 ? (
          <VideoGrid videos={userVideos} />
        ) : (
          <EmptyState
            icon={<PlaySquare size={24} />}
            title="No videos added yet"
            description="Paste a video URL to publish it instantly. No database or storage is involved — AfterDark only remembers the link."
          />
        )}
      </Section>
    </>
  )
}
