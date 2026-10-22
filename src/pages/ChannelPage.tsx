import { Link, useParams } from 'react-router-dom'
import { BadgeCheck, Compass, Users } from 'lucide-react'
import VideoGrid from '../components/VideoGrid'
import EmptyState from '../components/EmptyState'
import NotFoundPage from './NotFoundPage'
import { ALL_CHANNEL_MAP, browsePath } from '../data/seed'
import { videosForChannel } from '../lib/uploader'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

/**
 * One uploader: the channel's own face and fake subscriber count, plus every
 * video attributed to it. Membership is computed, not stored — `videosForChannel`
 * resolves each listing's channel by category + id hash, so uploads and
 * Telegram imports land under their channel with no back-fill.
 */
export default function ChannelPage() {
  const { channelId = '' } = useParams()
  const channel = ALL_CHANNEL_MAP[channelId]
  const { allVideos, subscriptions, toggleSubscription } = useStore()

  usePageTitle(channel ? `${channel.name} — AfterDark` : 'Channel not found')

  if (!channel) return <NotFoundPage />

  const videos = videosForChannel(allVideos, channel)
  const isSubscribed = subscriptions.includes(channel.id)

  return (
    <>
      <header className="mt-5 mb-7 flex flex-wrap items-center gap-x-5 gap-y-4 rounded-2xl border border-line bg-panel p-5">
        <img
          src={channel.avatar}
          alt=""
          className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-black/[0.06] dark:ring-1 dark:ring-white/10 sm:h-20 sm:w-20"
        />

        <div className="min-w-0 flex-1">
          <h1 className="flex min-w-0 items-center gap-1.5 text-[22px] font-extrabold leading-tight tracking-[-0.03em] text-ink sm:text-[26px]">
            <span className="truncate">{channel.name}</span>
            {channel.verified && (
              <BadgeCheck size={19} className="shrink-0 text-brand-600" aria-label="Verified" />
            )}
          </h1>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
            <Users size={13} className="shrink-0" aria-hidden="true" />
            <span>{channel.subscribers} subscribers</span>
            <span aria-hidden="true">·</span>
            <span>
              {videos.length} {videos.length === 1 ? 'video' : 'videos'}
            </span>
            <span aria-hidden="true">·</span>
            <Link to={browsePath(channel.category)} className="text-body hover:text-ink">
              {channel.category}
            </Link>
          </p>
        </div>

        <button
          type="button"
          onClick={() => toggleSubscription(channel.id)}
          className={[
            'flex h-10 shrink-0 items-center gap-1.5 rounded-full px-5 text-[13.5px] font-semibold transition',
            isSubscribed ? 'bg-raise text-ink hover:bg-sunken' : 'bg-action text-on-action hover:opacity-90',
          ].join(' ')}
        >
          {isSubscribed ? 'Subscribed' : 'Subscribe'}
        </button>
      </header>

      {videos.length > 0 ? (
        <>
          <h2 className="mb-4 text-[15px] font-bold tracking-[-0.01em] text-ink">
            Published by {channel.name}
          </h2>
          <VideoGrid videos={videos} />
        </>
      ) : (
        <EmptyState
          icon={<Compass size={24} />}
          title="Nothing published yet"
          description={`${channel.name} has no videos in this catalogue yet. Anything added to ${channel.category} that lands on this uploader will show up here right away.`}
          action={
            <Link
              to={browsePath(channel.category)}
              className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13.5px] font-semibold text-white"
            >
              Browse {channel.category}
            </Link>
          }
        />
      )}
    </>
  )
}
