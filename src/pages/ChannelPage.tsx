import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BadgeCheck, Bell, Plus, Video } from 'lucide-react'
import VideoGrid from '../components/VideoGrid'
import VideoRow from '../components/VideoRow'
import EmptyState from '../components/EmptyState'
import NotFoundPage from './NotFoundPage'
import { ALL_CHANNEL_MAP } from '../data/seed'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

const BANNERS: Record<string, string> = {
  techbit: 'from-violet-600 via-purple-600 to-indigo-700',
  cinemasphere: 'from-slate-800 via-slate-700 to-zinc-900',
  gameplay: 'from-fuchsia-600 via-purple-700 to-violet-900',
  newsnow: 'from-sky-700 via-slate-800 to-slate-900',
  sportscentral: 'from-emerald-600 via-teal-700 to-slate-900',
  cinemax: 'from-zinc-900 via-neutral-800 to-stone-900',
  chillwave: 'from-indigo-900 via-slate-900 to-black',
  you: 'from-brand-500 via-purple-600 to-indigo-800',
}

const TABS = ['Home', 'Videos', 'About'] as const
type Tab = (typeof TABS)[number]

export default function ChannelPage({ onCreate }: { onCreate: () => void }) {
  const { channelId = '' } = useParams()
  const { allVideos, userVideos, subscriptions, toggleSubscription } = useStore()
  const [tab, setTab] = useState<Tab>('Home')

  const channel = ALL_CHANNEL_MAP[channelId]
  usePageTitle(channel?.name ?? 'Channel')

  if (!channel) return <NotFoundPage />

  const videos = channelId === 'you' ? userVideos : allVideos.filter((video) => video.channelId === channelId)
  const isSubscribed = subscriptions.includes(channel.id)
  const isOwn = channel.id === 'you'
  const banner = BANNERS[channel.id] ?? 'from-brand-500 to-brand-700'
  const handle = `@${channel.name.toLowerCase().replace(/\s+/g, '')}`

  return (
    <div className="pb-4">
      <div className={`relative mt-4 h-28 overflow-hidden rounded-2xl bg-gradient-to-r sm:h-40 ${banner}`}>
        <div className="absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/10" />
        <div className="absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-white/10" />
        <div className="absolute right-1/4 top-6 h-24 w-24 rotate-12 rounded-2xl border border-white/20" />
      </div>

      <div className="-mt-9 flex flex-col gap-4 px-2 sm:-mt-12 sm:flex-row sm:items-end sm:px-6">
        <img
          src={channel.avatar}
          alt={channel.name}
          className="h-24 w-24 shrink-0 rounded-full border-4 border-white object-cover shadow-md sm:h-32 sm:w-32"
        />
        <div className="min-w-0 flex-1 pb-1">
          <h1 className="flex items-center gap-2 text-[26px] font-extrabold leading-tight tracking-[-0.03em]">
            <span className="truncate">{channel.name}</span>
            {channel.verified && <BadgeCheck size={22} className="shrink-0 text-[#8a8a92]" />}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {handle} · {channel.subscribers} subscribers · {videos.length} {videos.length === 1 ? 'video' : 'videos'}
          </p>
          <p className="mt-1 line-clamp-1 max-w-xl text-[13px] text-muted">
            {isOwn
              ? 'Your personal GridWatch channel. Add videos by pasting a link — nothing is uploaded or stored.'
              : `Welcome to ${channel.name}. New videos every week — subscribe so you never miss one.`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 pb-1">
          {isOwn ? (
            <button
              type="button"
              onClick={onCreate}
              className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13.5px] font-semibold text-white"
            >
              <Plus size={17} /> Add video
            </button>
          ) : (
            <button
              type="button"
              onClick={() => toggleSubscription(channel.id)}
              className={[
                'flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-semibold transition',
                isSubscribed ? 'bg-[#f2f2f4] text-ink hover:bg-[#e8e8ec]' : 'bg-ink text-white hover:bg-black',
              ].join(' ')}
            >
              {isSubscribed ? <><Bell size={16} /> Subscribed</> : 'Subscribe'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 flex gap-1 border-b border-line px-2 sm:px-6">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={[
              'relative px-3 pb-3 pt-1 text-[14px] font-semibold transition',
              tab === item ? 'text-ink' : 'text-muted hover:text-ink',
            ].join(' ')}
          >
            {item}
            {tab === item && <span className="absolute inset-x-2 bottom-0 h-[2.5px] rounded-full bg-ink" />}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'About' ? (
          <div className="max-w-3xl">
            <h2 className="text-[18px] font-bold">About {channel.name}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              {isOwn
                ? 'This channel stores only the links you add — video files stay on the platform you pasted them from. Everything is saved locally in your browser while GridWatch is running without a database.'
                : `${channel.name} brings you ${videos.length > 0 ? 'carefully produced videos' : 'new videos'} across ${[...new Set(videos.map((video) => video.category))].join(', ') || 'a range of topics'}. Subscribe for new uploads, and check the community tab for updates.`}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Subscribers', value: channel.subscribers || '—' },
                { label: 'Videos', value: String(videos.length) },
                { label: 'Joined', value: 'Mar 2021' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-line bg-[#fafafb] px-4 py-3">
                  <p className="text-[17px] font-bold">{stat.value}</p>
                  <p className="text-[12px] text-muted">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        ) : videos.length === 0 ? (
          <EmptyState
            icon={<Video size={24} />}
            title="No videos yet"
            description={
              isOwn
                ? 'Add your first video by pasting a link. It will appear on your channel instantly.'
                : 'This channel has not published any videos yet.'
            }
            action={
              isOwn ? (
                <button
                  type="button"
                  onClick={onCreate}
                  className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13.5px] font-semibold text-white"
                >
                  <Plus size={17} /> Add a video
                </button>
              ) : undefined
            }
          />
        ) : tab === 'Home' ? (
          <div className="flex flex-col gap-8">
            <VideoRow video={videos[0]} description={`Latest from ${channel.name} — ${videos[0].views} · ${videos[0].publishedAt}`} />
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[18px] font-bold">Uploads</h2>
                <Link to={`/channel/${channel.id}`} onClick={() => setTab('Videos')} className="text-[13px] font-semibold text-brand-600 hover:underline">
                  View all
                </Link>
              </div>
              <VideoGrid videos={videos.slice(0, 4)} />
            </div>
          </div>
        ) : (
          <VideoGrid videos={videos} />
        )}
      </div>
    </div>
  )
}
