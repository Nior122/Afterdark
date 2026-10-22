import { History, Trash2 } from 'lucide-react'
import PageHeading from '../components/PageHeading'
import VideoGrid from '../components/VideoGrid'
import EmptyState from '../components/EmptyState'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

export default function HistoryPage() {
  const { history, getVideo, clearHistory } = useStore()
  usePageTitle('History')

  const videos = history.flatMap((entry) => {
    const video = getVideo(entry.id)
    return video ? [video] : []
  })

  return (
    <>
      <PageHeading
        title="Watch history"
        subtitle="Videos you have opened recently."
        action={
          videos.length > 0 ? (
            <button
              type="button"
              onClick={clearHistory}
              className="flex h-10 items-center gap-2 rounded-full bg-raise px-4 text-[13.5px] font-semibold text-ink transition hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 size={16} /> Clear all history
            </button>
          ) : undefined
        }
      />

      {videos.length > 0 ? (
        <VideoGrid videos={videos} />
      ) : (
        <EmptyState
          icon={<History size={24} />}
          title="Your history is empty"
          description="Videos you watch will show up here so you can find them again."
        />
      )}
    </>
  )
}
