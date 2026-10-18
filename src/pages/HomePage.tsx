import { Link } from 'react-router-dom'
import { ChevronRight, Plus, Sparkles } from 'lucide-react'
import CategoryBar from '../components/CategoryBar'
import Section from '../components/Section'
import VideoGrid from '../components/VideoGrid'
import { browsePath, CATEGORIES, videoMatchesCategory } from '../data/seed'
import { useStore } from '../lib/store'
import { usePageTitle } from '../lib/hooks'

export default function HomePage({ onCreate }: { onCreate: () => void }) {
  const { ads, allVideos, userVideos } = useStore()
  usePageTitle('')

  const recommendedAds = ads.slice(0, 4)
  const trendingAds = ads.slice(4, 8)
  const latest = allVideos.slice(0, 8)

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

      {userVideos.length === 0 && (
        <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 via-white to-white p-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
              <Sparkles size={21} />
            </span>
            <div>
              <p className="text-[15px] font-bold text-ink">Add an adult video</p>
              <p className="mt-0.5 text-[13px] text-muted">
                Paste an embed, MP4 or video link and file it under an adult category. No uploads,
                no database — just the URL.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(225,29,72,0.9)] transition hover:brightness-105"
          >
            <Plus size={17} strokeWidth={2.4} />
            Create
          </button>
        </div>
      )}

      {latest.length > 0 && (
        <Section title="Latest videos" viewAllTo="/explore">
          <VideoGrid videos={latest} />
        </Section>
      )}

      <Section title="Popular categories" viewAllTo="/explore">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 feed:grid-cols-4">
          {popularCategories.map(({ category, count }) => (
            <Link
              key={category}
              to={browsePath(category)}
              className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-[#fafafb] px-4 py-3.5 transition hover:border-brand-200 hover:bg-brand-50"
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
