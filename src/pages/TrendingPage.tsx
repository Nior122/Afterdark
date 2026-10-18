import { Flame } from 'lucide-react'
import PageHeading from '../components/PageHeading'
import VideoGrid from '../components/VideoGrid'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

export default function TrendingPage() {
  const { allVideos } = useStore()
  usePageTitle('Trending')

  const trending = [...allVideos].sort((a, b) => {
    const rank = (views: string) => {
      const value = parseFloat(views.replace(/[^\d.]/g, '')) || 0
      if (/M/.test(views)) return value * 1_000_000
      if (/K/.test(views)) return value * 1_000
      return value
    }
    return rank(b.views) - rank(a.views)
  })

  return (
    <>
      <PageHeading
        title="Trending"
        subtitle="The videos everyone on GridWatch is watching right now."
        action={
          <span className="flex h-9 items-center gap-2 rounded-full bg-brand-100 px-3.5 text-[12.5px] font-semibold text-brand-700">
            <Flame size={16} /> Updated hourly
          </span>
        }
      />
      <VideoGrid videos={trending} />
    </>
  )
}
