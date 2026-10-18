import { Clock3 } from 'lucide-react'
import PageHeading from '../components/PageHeading'
import VideoGrid from '../components/VideoGrid'
import EmptyState from '../components/EmptyState'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

export default function WatchLaterPage() {
  const { watchLater, getVideo } = useStore()
  usePageTitle('Watch later')

  const videos = watchLater.flatMap((id) => {
    const video = getVideo(id)
    return video ? [video] : []
  })

  return (
    <>
      <PageHeading
        title="Watch later"
        subtitle={`${videos.length} ${videos.length === 1 ? 'video' : 'videos'} saved for later.`}
      />
      {videos.length > 0 ? (
        <VideoGrid videos={videos} />
      ) : (
        <EmptyState
          icon={<Clock3 size={24} />}
          title="Nothing saved yet"
          description="Use the menu on any video card to save it to Watch later."
        />
      )}
    </>
  )
}
