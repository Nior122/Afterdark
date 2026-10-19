import { Link, useSearchParams } from 'react-router-dom'
import { Search, UserPlus, Check } from 'lucide-react'
import PageHeading from '../components/PageHeading'
import VideoRow from '../components/VideoRow'
import EmptyState from '../components/EmptyState'
import { channelForVideo } from '../lib/uploader'
import { CHANNELS, channelPath } from '../data/seed'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

export default function ResultsPage() {
  const [params] = useSearchParams()
  const query = (params.get('q') ?? '').trim()
  const { allVideos, ads, subscriptions, toggleSubscription } = useStore()
  usePageTitle(query ? `Search: ${query}` : 'Search')

  const needle = query.toLowerCase()
  const results = [...allVideos, ...ads].filter((video) => {
    if (!needle) return false
    const channelName = channelForVideo(video).name
    return (
      video.title.toLowerCase().includes(needle) ||
      channelName.toLowerCase().includes(needle) ||
      video.category.toLowerCase().includes(needle) ||
      (video.description?.toLowerCase().includes(needle) ?? false) ||
      (video.tags?.some((tag) => tag.toLowerCase().includes(needle)) ?? false)
    )
  })

  const channelResults = needle
    ? CHANNELS.filter(
        (channel) =>
          channel.name.toLowerCase().includes(needle) ||
          channel.name.toLowerCase().replace(/\s/g, '').includes(needle),
      )
    : []

  if (!query) {
    return (
      <>
        <PageHeading title="Search" subtitle="Search adult videos, pornstars, categories and tags." />
        <EmptyState
          icon={<Search size={24} />}
          title="What are you looking for?"
          description="Use the search bar at the top to look up adult videos, pornstars, categories and tags."
          action={
            <Link
              to="/"
              className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13.5px] font-semibold text-white"
            >
              Browse home
            </Link>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeading
        title={`Results for “${query}”`}
        subtitle={`${results.length} ${results.length === 1 ? 'result' : 'results'}`}
      />

      {channelResults.length > 0 && (
        <div className="mb-8 rounded-2xl border border-line p-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted">Channels</p>
          <div className="flex flex-col divide-y divide-line">
            {channelResults.map((channel) => {
              const isSubscribed = subscriptions.includes(channel.id)
              return (
                <div key={channel.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                  <Link to={channelPath(channel.id)} className="shrink-0" aria-label={`${channel.name} channel`}>
                    <img src={channel.avatar} alt="" className="block h-12 w-12 rounded-full object-cover" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={channelPath(channel.id)}
                      className="block truncate text-[14.5px] font-semibold hover:text-brand-700 hover:underline"
                    >
                      {channel.name}
                    </Link>
                    <p className="text-[12.5px] text-muted">{channel.subscribers} subscribers</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSubscription(channel.id)}
                    className={[
                      'flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold transition',
                      isSubscribed ? 'bg-raise text-ink' : 'bg-action text-on-action hover:opacity-90',
                    ].join(' ')}
                  >
                    {isSubscribed ? <><Check size={14} /> Subscribed</> : <><UserPlus size={14} /> Subscribe</>}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {results.length > 0 ? (
        <div className="flex flex-col gap-5">
          {results.map((video) => (
            <VideoRow
              key={video.id}
              video={video}
              description={
                video.description ??
                `${video.category} · ${video.views} · ${video.publishedAt}. Watch ${video.title} in full on AfterDark.`
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Search size={24} />}
          title="No results found"
          description={`Nothing matched “${query}”. Try a different keyword, or add a video with a link.`}
        />
      )}
    </>
  )
}
