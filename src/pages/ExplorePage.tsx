import { Link } from 'react-router-dom'
import {
  BadgeCheck,
  Camera,
  Compass,
  Crown,
  Eye,
  Flame,
  Globe,
  Heart,
  House,
  MonitorPlay,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react'
import PageHeading from '../components/PageHeading'
import Section from '../components/Section'
import VideoGrid from '../components/VideoGrid'
import { browsePath, videoMatchesCategory } from '../data/seed'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

const TILES = [
  { category: 'POV', icon: Eye, className: 'from-rose-600 to-red-800' },
  { category: 'Amateur', icon: Camera, className: 'from-pink-500 to-rose-700' },
  { category: 'MILF', icon: Crown, className: 'from-fuchsia-600 to-purple-800' },
  { category: 'Blowjob', icon: Heart, className: 'from-red-500 to-rose-700' },
  { category: 'Big Tits', icon: Sparkles, className: 'from-orange-500 to-rose-600' },
  { category: 'Big Ass', icon: Flame, className: 'from-amber-500 to-red-700' },
  { category: 'Latina', icon: Globe, className: 'from-emerald-600 to-teal-800' },
  { category: 'Brunette', icon: Star, className: 'from-zinc-700 to-zinc-950' },
  { category: 'Pornstar', icon: BadgeCheck, className: 'from-violet-600 to-indigo-800' },
  { category: 'Hardcore', icon: Zap, className: 'from-slate-800 to-black' },
  { category: 'Homemade', icon: House, className: 'from-cyan-600 to-blue-800' },
  { category: '4K Ultra HD', icon: MonitorPlay, className: 'from-neutral-800 to-stone-950' },
]

function viewCount(views: string): number {
  const value = parseFloat(views.replace(/[^\d.]/g, '')) || 0
  if (/M/.test(views)) return value * 1_000_000
  if (/K/.test(views)) return value * 1_000
  return value
}

export default function ExplorePage() {
  const { allVideos } = useStore()
  usePageTitle('Explore')

  const mostViewed = [...allVideos]
    .sort((a, b) => viewCount(b.views) - viewCount(a.views))
    .slice(0, 8)

  return (
    <>
      <PageHeading
        title="Explore"
        subtitle="Browse AfterDark by adult category — 18+ only."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {TILES.map(({ category, icon: Icon, className }) => {
          const count = allVideos.filter((video) => videoMatchesCategory(video, category)).length
          return (
            <Link
              key={category}
              to={browsePath(category)}
              className={`group relative flex h-[104px] items-end overflow-hidden rounded-xl bg-gradient-to-br ${className} p-3.5 text-white shadow-sm transition hover:shadow-md`}
            >
              <Icon size={56} strokeWidth={1.2} className="absolute -right-2 -top-2 text-white/20 transition group-hover:scale-110" />
              <span className="relative">
                <span className="block text-[15px] font-bold tracking-[-0.01em]">{category}</span>
                <span className="block text-[11.5px] font-medium text-white/75">
                  {count} {count === 1 ? 'video' : 'videos'}
                </span>
              </span>
            </Link>
          )
        })}
        <Link
          to="/trending"
          className="group relative flex h-[104px] items-end overflow-hidden rounded-xl bg-gradient-to-br from-zinc-800 to-black p-3.5 text-white shadow-sm transition hover:shadow-md"
        >
          <Compass size={56} strokeWidth={1.2} className="absolute -right-2 -top-2 text-white/20 transition group-hover:scale-110" />
          <span className="relative text-[15px] font-bold tracking-[-0.01em]">Trending</span>
        </Link>
      </div>

      <Section title="Most viewed" viewAllTo="/trending">
        <VideoGrid videos={mostViewed} />
      </Section>

      <Section title="Fresh uploads" viewAllTo="/trending">
        <VideoGrid videos={allVideos.slice(0, 4)} />
      </Section>
    </>
  )
}
