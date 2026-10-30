import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import CategoryBar from '../components/CategoryBar'
import Section from '../components/Section'
import VideoGrid from '../components/VideoGrid'
import { browsePath, CATEGORIES, videoMatchesCategory } from '../data/seed'
import { useStore } from '../lib/store'
import { usePageTitle } from '../lib/hooks'

export default function HomePage() {
  const { ads, allVideos, userVideos } = useStore()
  usePageTitle('')

  const recommendedAds = ads.slice(0, 4)
  const trendingAds = ads.slice(4, 8)
  const latest = allVideos

  const popularCategories = CATEGORIES.filter((category) => category !== 'All')
    .map((category) => ({
      category,
      count: allVideos.filter((video) => videoMatchesCategory(video, category)).length,
    }))
    .slice(0, 12)

  return (
    <>
      <CategoryBar active="All" />

      {userVideos.length > 0 && (
        <Section title="Your videos" viewAllTo="/library">
          <VideoGrid videos={userVideos.slice(0, 4)} />
        </Section>
      )}

      {recommendedAds.length > 0 && (
        <Section title="Recommended for you" viewAllTo="/explore">
          <VideoGrid videos={recommendedAds} />
        </Section>
      )}

      {trendingAds.length > 0 && (
        <Section title="Trending now" viewAllTo="/trending">
          <VideoGrid videos={trendingAds} />
        </Section>
      )}

      {latest.length > 0 && (
        <Section title="Latest videos">
          <VideoGrid videos={latest} chronological />
        </Section>
      )}

      <Section title="Popular categories" viewAllTo="/explore">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 feed:grid-cols-4">
          {popularCategories.map(({ category, count }) => (
            <Link
              key={category}
              to={browsePath(category)}
              className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 transition hover:border-brand-200 hover:bg-brand-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-ink">{category}</span>
                <span className="block text-[12px] text-muted">
                  {count} {count === 1 ? 'video' : 'videos'}
                </span>
              </span>
              <ChevronRight
                size={17}
                className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand-700"
              />
            </Link>
          ))}
        </div>
      </Section>
    </>
  )
}
