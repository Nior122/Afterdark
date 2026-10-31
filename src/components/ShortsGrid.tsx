import { Link } from 'react-router-dom'
import type { Ad, Video } from '../data/seed'
import { isShortVideo } from '../lib/video'
import ShortBadge from './ShortBadge'

/**
 * The Shorts wall on the home page. Deliberately NOT the VideoGrid masonry:
 * a Short is defined by its format, so every tile is framed as the same
 * upright 9:16 panel (cropped cover, duration bottom-right) in a strict
 * grid — two tiles per row on a phone up to five on a wide display, which
 * reads as "a wall of shorts" before any text does. Titles stay one line
 * clamped: the thumbnail is the whole pitch at this size.
 */
export default function ShortsGrid({ videos }: { videos: (Video | Ad)[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 feed:grid-cols-5">
      {videos.map((video) => (
        <Link key={video.id} to={`/watch/${video.id}`} className="group/short block min-w-0">
          <span className="relative block aspect-[9/16] overflow-hidden rounded-xl bg-raise">
            <img
              src={video.thumbnail}
              alt={video.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover transition duration-500 group-hover/short:scale-[1.04]"
            />
            <span className="absolute bottom-1.5 right-1.5 rounded-[5px] bg-black/80 px-1.5 py-[3px] text-[11px] font-semibold leading-none text-white">
              {video.duration}
            </span>
            {isShortVideo(video) && <ShortBadge inset="bottom-1.5 left-1.5" />}
          </span>
          <span className="mt-1.5 line-clamp-2 block text-[13px] font-semibold leading-snug text-ink">
            {video.title}
          </span>
          <span className="mt-0.5 block whitespace-nowrap text-[12px] text-muted">{video.views}</span>
        </Link>
      ))}
    </div>
  )
}
