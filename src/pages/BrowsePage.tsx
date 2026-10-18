import { useParams, Link } from 'react-router-dom'
import { Compass, Plus } from 'lucide-react'
import CategoryBar from '../components/CategoryBar'
import VideoGrid from '../components/VideoGrid'
import EmptyState from '../components/EmptyState'
import PageHeading from '../components/PageHeading'
import { CATEGORIES } from '../data/seed'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

export default function BrowsePage() {
  const { category = '' } = useParams()
  const { allVideos } = useStore()
  const match = CATEGORIES.find((item) => item.toLowerCase() === category.toLowerCase())
  const title = match ?? category
  usePageTitle(title)

  const videos = allVideos.filter((video) => video.category.toLowerCase() === title.toLowerCase())

  return (
    <>
      <CategoryBar active={title} />
      <PageHeading
        title={title}
        subtitle={`${videos.length} ${videos.length === 1 ? 'video' : 'videos'} in ${title}`}
      />

      {videos.length > 0 ? (
        <VideoGrid videos={videos} />
      ) : (
        <EmptyState
          icon={<Compass size={24} />}
          title={`Nothing in ${title} yet`}
          description="Add a video to this category and it will show up here right away."
          action={
            <Link
              to="/"
              className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13.5px] font-semibold text-white"
            >
              <Plus size={17} /> Back to home
            </Link>
          }
        />
      )}
    </>
  )
}
