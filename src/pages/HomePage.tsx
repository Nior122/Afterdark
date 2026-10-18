import { Plus, Sparkles } from 'lucide-react'
import CategoryBar from '../components/CategoryBar'
import Section from '../components/Section'
import VideoGrid from '../components/VideoGrid'
import { useStore } from '../lib/store'
import { usePageTitle } from '../lib/hooks'

export default function HomePage({ onCreate }: { onCreate: () => void }) {
  const { ads, allVideos, userVideos } = useStore()
  usePageTitle('')

  const recommendedAds = ads.slice(0, 4)
  const trendingAds = ads.slice(4, 8)
  const regular = allVideos
  const music = regular.filter((video) => video.category === 'Music').slice(0, 4)
  const gaming = regular.filter((video) => video.category === 'Gaming').slice(0, 4)
  const news = regular.filter((video) => video.category === 'News').slice(0, 4)
  const more = regular.slice(0, 8)

  return (
    <>
      <CategoryBar active="All" />

      {userVideos.length > 0 && (
        <Section title="Your videos" viewAllTo="/library">
          <VideoGrid videos={userVideos.slice(0, 4)} />
        </Section>
      )}

      <Section title="Recommended for you" viewAllTo="/explore">
        <VideoGrid videos={recommendedAds} />
      </Section>

      <Section title="Trending now" viewAllTo="/trending">
        <VideoGrid videos={trendingAds} />
      </Section>

      {userVideos.length === 0 && (
        <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 via-white to-white p-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700">
              <Sparkles size={21} />
            </span>
            <div>
              <p className="text-[15px] font-bold text-ink">Add your first video</p>
              <p className="mt-0.5 text-[13px] text-muted">
                Paste a YouTube, Vimeo or MP4 link. No uploads, no database — just the URL.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(109,40,217,0.9)] transition hover:brightness-105"
          >
            <Plus size={17} strokeWidth={2.4} />
            Create
          </button>
        </div>
      )}

      <Section title="More for you" viewAllTo="/explore">
        <VideoGrid videos={more} />
      </Section>

      <Section title="Music" viewAllTo="/browse/Music">
        <VideoGrid videos={music} />
      </Section>

      <Section title="Gaming" viewAllTo="/browse/Gaming">
        <VideoGrid videos={gaming} />
      </Section>

      <Section title="News" viewAllTo="/browse/News">
        <VideoGrid videos={news} />
      </Section>
    </>
  )
}
