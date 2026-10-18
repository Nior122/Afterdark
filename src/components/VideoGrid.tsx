import type { Ad, Video } from '../data/seed'
import VideoCard from './VideoCard'

export default function VideoGrid({ videos }: { videos: (Video | Ad)[] }) {
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 feed:grid-cols-4">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  )
}
