import type { Ad, Video } from '../data/seed'
import VideoCard from './VideoCard'

/**
 * Masonry by CSS columns. Portrait uploads keep their shape instead of being
 * cropped into a landscape box, so the columns must flow freely: a plain row
 * grid would leave holes under every landscape card next to a tall one.
 */
export default function VideoGrid({ videos }: { videos: (Video | Ad)[] }) {
  return (
    <div className="gap-x-5 columns-1 sm:columns-2 lg:columns-3 feed:columns-4">
      {videos.map((video) => (
        <div key={video.id} className="mb-8 break-inside-avoid">
          <VideoCard video={video} />
        </div>
      ))}
    </div>
  )
}
