import { Link } from 'react-router-dom'
import { BadgeCheck } from 'lucide-react'
import type { Ad, Video } from '../data/seed'
import { ALL_CHANNEL_MAP } from '../data/seed'
import KebabMenu from './KebabMenu'

type FeedItem = Video | Ad

interface VideoRowProps {
  video: FeedItem
  description?: string
  compact?: boolean
}

export default function VideoRow({ video, description, compact = false }: VideoRowProps) {
  const channel = ALL_CHANNEL_MAP[video.channelId]
  const isAd = 'isAd' in video && video.isAd

  return (
    <div className={`group/row flex gap-3 ${compact ? '' : 'gap-4'}`}>
      <Link
        to={`/watch/${video.id}`}
        className={`relative shrink-0 overflow-hidden rounded-xl bg-[#f2f2f4] ${
          compact ? 'w-[168px]' : 'w-[240px] sm:w-[320px]'
        }`}
        style={{ aspectRatio: '16 / 9' }}
      >
        <img
          src={video.thumbnail}
          alt={video.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover transition duration-500 group-hover/row:scale-[1.03]"
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

            <p className={`mt-1 flex flex-wrap items-center gap-x-1.5 text-[#606060] ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
              <span>{video.views}</span>
              <span aria-hidden="true">·</span>
              <span>{video.publishedAt}</span>
            </p>

            <Link
              to={`/channel/${video.channelId}`}
              className={`mt-1 flex items-center gap-1.5 text-[#606060] hover:text-ink ${compact ? 'text-[12px]' : 'text-[13px]'}`}
            >
              <img src={channel?.avatar} alt="" className="h-5 w-5 rounded-full object-cover" />
              <span className="truncate">{channel?.name}</span>
              {channel?.verified && <BadgeCheck size={13} className="shrink-0 text-[#8a8a92]" />}
            </Link>

            {description && !compact && (
              <p className="mt-2 line-clamp-2 max-w-[560px] text-[13px] leading-relaxed text-[#606060]">
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
