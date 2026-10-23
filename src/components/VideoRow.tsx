import { Link } from 'react-router-dom'
import { BadgeCheck } from 'lucide-react'
import type { Ad, Video } from '../data/seed'
import { channelForVideo, faceForVideo } from '../lib/uploader'
import { channelPath } from '../data/seed'
import { avatarFallbackFor } from '../lib/avatars'
import KebabMenu from './KebabMenu'

type FeedItem = Video | Ad

interface VideoRowProps {
  video: FeedItem
  description?: string
  compact?: boolean
}

export default function VideoRow({ video, description, compact = false }: VideoRowProps) {
  const channel = channelForVideo(video)
  const isAd = 'isAd' in video && video.isAd

  return (
    <div className={`group/row flex gap-3 ${compact ? '' : 'gap-4'}`}>
      <Link
        to={`/watch/${video.id}`}
        className={`relative shrink-0 overflow-hidden rounded-xl bg-raise ${
          video.isPortrait
            ? compact
              ? 'w-[120px]'
              : 'w-[180px] sm:w-[220px]'
            : compact
              ? 'w-[168px]'
              : 'w-[240px] sm:w-[320px]'
        }`}
        style={{ aspectRatio: video.isPortrait ? '9 / 16' : '16 / 9' }}
      >
        <img
          src={video.thumbnail}
          alt={video.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`h-full w-full transition duration-500 group-hover/row:scale-[1.03] ${
            video.isPortrait ? 'object-contain' : 'object-cover'
          }`}
        />
        {isAd && (
          <span className="absolute left-2 top-2 rounded-[4px] bg-black/60 px-1.5 py-[2px] text-[10.5px] font-semibold text-white">
            Ad
          </span>
        )}
        <span className="absolute bottom-2 right-2 rounded-[4px] bg-black/80 px-1.5 py-[2px] text-[11px] font-semibold leading-none text-white">
          {video.duration}
        </span>
      </Link>

      <div className={`min-w-0 flex-1 ${compact ? 'py-0' : 'py-0.5'}`}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Link
              to={`/watch/${video.id}`}
              className={`line-clamp-2 font-semibold leading-[1.35] text-ink ${
                compact ? 'text-[14px]' : 'text-[17px]'
              }`}
            >
              {video.title}
            </Link>

            <p className={`mt-1 flex flex-wrap items-center gap-x-1.5 text-muted ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
              <span>{video.views}</span>
              <span aria-hidden="true">·</span>
              <span>{video.publishedAt}</span>
            </p>

            <div
              className={`mt-1 flex items-center gap-1.5 text-muted ${compact ? 'text-[12px]' : 'text-[13px]'}`}
            >
              <Link to={channelPath(channel.id)} className="shrink-0" aria-label={`More from ${channel.name}`}>
                <img
                  src={faceForVideo(video)}
                  alt=""
                  className="block h-5 w-5 rounded-full"
                  onError={(event) => {
                    event.currentTarget.src = avatarFallbackFor(video)
                  }}
                />
              </Link>
              <Link to={channelPath(channel.id)} className="truncate hover:text-ink hover:underline">
                {channel.name}
              </Link>
              <span className="shrink-0 text-faint">· {channel.subscribers}</span>
              {channel.verified && <BadgeCheck size={13} className="shrink-0 text-faint" />}
            </div>

            {description && !compact && (
              <p className="mt-2 line-clamp-2 max-w-[560px] text-[13px] leading-relaxed text-muted">
                {description}
              </p>
            )}
          </div>

          {!compact && <KebabMenu videoId={video.id} />}
        </div>
      </div>
    </div>
  )
}
