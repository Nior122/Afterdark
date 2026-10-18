import { Link } from 'react-router-dom'
import { ListVideo, Plus, UserPlus } from 'lucide-react'
import PageHeading from '../components/PageHeading'
import VideoGrid from '../components/VideoGrid'
import EmptyState from '../components/EmptyState'
import { ALL_CHANNEL_MAP, CHANNELS } from '../data/seed'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

export default function SubscriptionsPage() {
  const { subscriptions, toggleSubscription, allVideos } = useStore()
  usePageTitle('Subscriptions')

  const subscribed = subscriptions.map((id) => ALL_CHANNEL_MAP[id]).filter(Boolean)
  const videos = allVideos.filter((video) => subscriptions.includes(video.channelId))

  return (
    <>
      <PageHeading
        title="Subscriptions"
        subtitle="The latest from the channels you follow."
        action={
          <Link
            to="/explore"
            className="flex h-10 items-center gap-2 rounded-full bg-[#f2f2f4] px-4 text-[13.5px] font-semibold text-ink transition hover:bg-[#e8e8ec]"
          >
            <Plus size={17} /> Find channels
          </Link>
        }
      />

      {subscribed.length > 0 ? (
        <>
          <div className="no-scrollbar -mx-1 mb-8 flex gap-3 overflow-x-auto px-1 pb-1">
            {CHANNELS.filter((channel) => channel.id !== 'you').map((channel) => {
              const isSubscribed = subscriptions.includes(channel.id)
              return (
                <div
                  key={channel.id}
                  className="flex w-[176px] shrink-0 flex-col items-center gap-2 rounded-2xl border border-line bg-white px-3 py-4 text-center"
                >
                  <Link to={`/channel/${channel.id}`}>
                    <img src={channel.avatar} alt="" className="h-14 w-14 rounded-full object-cover" />
                  </Link>
                  <Link to={`/channel/${channel.id}`} className="line-clamp-1 text-[13.5px] font-semibold hover:text-brand-700">
                    {channel.name}
                  </Link>
                  <p className="text-[11.5px] text-muted">{channel.subscribers} subscribers</p>
                  <button
                    type="button"
                    onClick={() => toggleSubscription(channel.id)}
                    className={[
                      'mt-1 flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition',
                      isSubscribed
                        ? 'bg-[#f2f2f4] text-ink hover:bg-[#e8e8ec]'
                        : 'bg-ink text-white hover:bg-black',
                    ].join(' ')}
                  >
                    {isSubscribed ? 'Subscribed' : <><UserPlus size={14} /> Subscribe</>}
                  </button>
                </div>
              )
            })}
          </div>

          {videos.length > 0 ? (
            <VideoGrid videos={videos} />
          ) : (
            <EmptyState
              icon={<ListVideo size={24} />}
              title="No new videos yet"
              description="You are subscribed, but these channels have not posted anything new. Check back soon."
            />
          )}
        </>
      ) : (
        <EmptyState
          icon={<ListVideo size={24} />}
          title="No subscriptions yet"
          description="Subscribe to channels and their newest videos will collect here."
          action={
            <Link
              to="/explore"
              className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13.5px] font-semibold text-white"
            >
              <Plus size={17} /> Explore channels
            </Link>
          }
        />
      )}
    </>
  )
}
