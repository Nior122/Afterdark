import { ThumbsUp } from 'lucide-react'
import PageHeading from '../components/PageHeading'
import VideoGrid from '../components/VideoGrid'
import EmptyState from '../components/EmptyState'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

export default function LikedPage() {
  const { liked, getVideo } = useStore()
  usePageTitle('Liked videos')

  const videos = liked.flatMap((id) => {
    const video = getVideo(id)
    return video ? [video] : []
  })

  return (
    <>
      <PageHeading
        title="Liked videos"
        subtitle={`${videos.length} ${videos.length === 1 ? 'video' : 'videos'} you liked.`}
      />
      {videos.length > 0 ? (
        <VideoGrid videos={videos} />
      ) : (
        <EmptyState
          icon={<ThumbsUp size={24} />}
          title="No liked videos"
          description="Tap the like button on a video and it will be collected here."
        />
      )}
    </>
  )
}
