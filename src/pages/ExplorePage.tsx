import { Link } from 'react-router-dom'
import {
  Clapperboard,
  Compass,
  Gamepad2,
  Lightbulb,
  Music,
  Newspaper,
  Trophy,
  Tv,
  Cpu,
} from 'lucide-react'
import PageHeading from '../components/PageHeading'
import Section from '../components/Section'
import VideoGrid from '../components/VideoGrid'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'

const TILES = [
  { category: 'Tech', icon: Cpu, className: 'from-violet-500 to-purple-700' },
  { category: 'Gaming', icon: Gamepad2, className: 'from-fuchsia-500 to-purple-700' },
  { category: 'Music', icon: Music, className: 'from-indigo-500 to-blue-700' },
  { category: 'Movies', icon: Clapperboard, className: 'from-slate-700 to-slate-900' },
  { category: 'News', icon: Newspaper, className: 'from-sky-500 to-cyan-700' },
  { category: 'Sports', icon: Trophy, className: 'from-emerald-500 to-teal-700' },
  { category: 'Entertainment', icon: Tv, className: 'from-orange-500 to-rose-600' },
  { category: 'How-To', icon: Lightbulb, className: 'from-amber-500 to-orange-600' },
]

export default function ExplorePage() {
  const { allVideos } = useStore()
  usePageTitle('Explore')

  return (
    <>
      <PageHeading
        title="Explore"
        subtitle="Find your next watch across every corner of GridWatch."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {TILES.map(({ category, icon: Icon, className }) => (
          <Link
            key={category}
            to={`/browse/${category}`}
            className={`group relative flex h-[104px] items-end overflow-hidden rounded-xl bg-gradient-to-br ${className} p-3.5 text-white shadow-sm transition hover:shadow-md`}
          >
            <Icon size={56} strokeWidth={1.2} className="absolute -right-2 -top-2 text-white/20 transition group-hover:scale-110" />
            <span className="relative text-[15px] font-bold tracking-[-0.01em]">{category}</span>
          </Link>
        ))}
        <Link
          to="/trending"
          className="group relative flex h-[104px] items-end overflow-hidden rounded-xl bg-gradient-to-br from-zinc-800 to-black p-3.5 text-white shadow-sm transition hover:shadow-md"
        >
          <Compass size={56} strokeWidth={1.2} className="absolute -right-2 -top-2 text-white/20 transition group-hover:scale-110" />
          <span className="relative text-[15px] font-bold tracking-[-0.01em]">Trending</span>
        </Link>
      </div>

      <Section title="Popular this week" viewAllTo="/trending">
        <VideoGrid videos={allVideos.slice().sort((a, b) => a.title.localeCompare(b.title)).slice(0, 8)} />
      </Section>

      <Section title="Fresh uploads" viewAllTo="/trending">
        <VideoGrid videos={allVideos.slice(0, 4)} />
      </Section>
    </>
  )
}
