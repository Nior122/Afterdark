import { Clapperboard } from 'lucide-react'
import EmptyState from '../components/EmptyState'
import PageHeading from '../components/PageHeading'
import ShortsGrid from '../components/ShortsGrid'
import { usePageTitle } from '../lib/hooks'
import { isShortVideo } from '../lib/video'
import { useStore } from '../lib/store'

/**
 * The Shorts wall as a full page: every sub-minute clip in the catalogue,
 * newest first, same tiles as the home section. Membership is the exact
 * `isShortVideo` rule the home split and the red badge use, so the page,
 * the wall and the badge can never disagree about what counts as a short.
 */
export default function ShortsPage() {
  const { allVideos } = useStore()
  usePageTitle('Shorts')

  const shorts = allVideos.filter((video) => isShortVideo(video))

  return (
    <>
      <PageHeading
        title="Shorts"
        subtitle="Every clip under a minute, newest first."
      />
      {shorts.length > 0 ? (
        <ShortsGrid videos={shorts} />
      ) : (
        <EmptyState
          icon={<Clapperboard size={22} />}
          title="No shorts yet"
          description="Videos under 60 seconds published by the bot appear here as a wall of upright clips."
        />
      )}
    </>
  )
}
