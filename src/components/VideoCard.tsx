import { Link } from 'react-router-dom'
import { BadgeCheck } from 'lucide-react'
import type { Ad, Video } from '../data/seed'
import { channelForVideo, faceForVideo } from '../lib/uploader'
import { channelPath } from '../data/seed'
import { avatarFallbackFor } from '../lib/avatars'
import { useStore } from '../lib/store'
import KebabMenu from './KebabMenu'

type FeedItem = Video | Ad

function adData(item: FeedItem): Ad | null {
  return 'isAd' in item && item.isAd ? (item as Ad) : null
}

export default function VideoCard({ video }: { video: FeedItem }) {
  const { removeVideo } = useStore()
  // Resolved, not stored: uploads carry no channel of their own, so the
  // category decides which uploader gets the credit.
  const channel = channelForVideo(video)
  const ad = adData(video)
  const headline = ad?.adHeadline?.trim()
  const isOwn = video.id.startsWith('u-')

  return (
    <article className="group/video min-w-0">
      <Link
        to={`/watch/${video.id}`}
        className={`relative block w-full overflow-hidden rounded-xl bg-raise ${
          video.isPortrait ? 'aspect-[9/16]' : 'aspect-video'
        }`}
      >
        <img
          src={video.thumbnail}
          alt={video.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`h-full w-full transition duration-500 group-hover/video:scale-[1.03] ${
            video.isPortrait ? 'object-contain' : 'object-cover'
          }`}
        />

        {ad && (
          <div className="absolute left-2.5 top-2.5 flex max-w-[72%] flex-col items-start gap-1.5">
            <span className="rounded-[4px] bg-black/60 px-1.5 py-[3px] text-[11px] font-semibold leading-none text-white backdrop-blur-sm">
              Ad
            </span>
            {headline && (
              <span className="rounded-[6px] bg-brand-600/95 px-2.5 py-2 text-[12.5px] font-semibold leading-[1.25] text-white shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
                {headline}
              </span>
            )}
          </div>
        )}

        <span className="absolute bottom-2 right-2 rounded-[5px] bg-black/80 px-1.5 py-[3px] text-[11px] font-semibold leading-none text-white">
          {video.duration}
        </span>

        {isOwn && (
          <span className="absolute right-2 top-2 rounded-[4px] bg-white/90 px-1.5 py-[3px] text-[10.5px] font-bold uppercase tracking-wide text-brand-700">
            Yours
          </span>
        )}
      </Link>

      <div className="mt-3 flex items-start gap-3">
        {/* The uploader's face, i.e. the face of the channel the video is
            attributed to, so all uploads from one uploader look alike. Both
            the face and the name lead to that channel's page. */}
        <Link
          to={channelPath(channel.id)}
          aria-label={`More from ${channel.name}`}
          className="mt-0.5 shrink-0"
        >
          <img
            src={faceForVideo(video)}
            onError={(event) => {
              event.currentTarget.src = avatarFallbackFor(video)
            }}
            alt=""
            className="block h-9 w-9 rounded-full ring-1 ring-black/[0.06] dark:ring-1 dark:ring-white/10"
          />
        </Link>

        <div className="min-w-0 flex-1">
          <Link
            to={`/watch/${video.id}`}
            className="line-clamp-2 text-[15px] font-semibold leading-[1.35] tracking-[-0.01em] text-ink"
          >
            {video.title}
          </Link>

          <div className="mt-1 flex min-w-0 items-center gap-1 text-[13px] text-muted">
            <Link
              to={channelPath(channel.id)}
              className="truncate hover:text-ink hover:underline"
            >
              {channel.name}
            </Link>
            <span className="shrink-0 text-faint">· {channel.subscribers}</span>
            {channel.verified && (
              <BadgeCheck
                size={13}
                strokeWidth={2.2}
                className="shrink-0 text-faint"
                aria-label="Verified"
              />
            )}
          </div>

          <p className="mt-0.5 whitespace-nowrap text-[13px] text-muted">
            {video.views} · {video.publishedAt}
          </p>
        </div>

        <KebabMenu
          videoId={video.id}
          advertiser={ad?.advertiser}
          onDelete={isOwn ? () => removeVideo(video.id) : undefined}
        />
      </div>
    </article>
  )
}
