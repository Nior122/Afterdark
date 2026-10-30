import type { Ad, Video } from '../data/seed'
import VideoCard from './VideoCard'

/**
 * Masonry by CSS columns. Portrait uploads keep their shape instead of being
 * cropped into a landscape box, so the columns must flow freely: a plain row
 * grid would leave holes under every landscape card next to a tall one. The
 * chronological option uses rows so the latest feed reads newest-first across
 * the screen rather than down columns.
 */
export default function VideoGrid({ videos, chronological = false }: { videos: (Video | Ad)[]; chronological?: boolean }) {
  return (
    <div className={chronological
      ? 'grid grid-cols-1 items-start gap-x-5 sm:grid-cols-2 lg:grid-cols-3 feed:grid-cols-4'
      : 'gap-x-5 columns-1 sm:columns-2 lg:columns-3 feed:columns-4'}>
      {videos.map((video) => (
        <div key={video.id} className="mb-8 break-inside-avoid">
          <VideoCard video={video} />
        </div>
      ))}
    </div>
  )
}
