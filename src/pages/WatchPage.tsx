import { asset } from '../lib/asset'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Bell,
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  Link2,
  MessageCircle,
  Play,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import VideoRow from '../components/VideoRow'
import KebabMenu from '../components/KebabMenu'
import NotFoundPage from './NotFoundPage'
import { ALL_CHANNEL_MAP, AVATARS, type Ad } from '../data/seed'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'
import { formatCount, resolveSource } from '../lib/video'

interface Comment {
  id: string
  name: string
  avatar: string
  time: string
  text: string
  likes: number
}

const SEED_COMMENTS: Comment[] = [
  {
    id: 'c1',
    name: 'Jordan Lee',
    avatar: AVATARS.cinemasphere,
    time: '2 days ago',
    text: 'The pacing on this one is perfect. Watched it twice and caught new details the second time around.',
    likes: 128,
  },
  {
    id: 'c2',
    name: 'Maya Okafor',
    avatar: asset("/avatars/chillwave.svg"),
    time: '5 days ago',
    text: 'This deserves way more views. The production quality is unreal — instantly subscribed.',
    likes: 84,
  },
  {
    id: 'c3',
    name: 'Daniel Cruz',
    avatar: AVATARS.user,
    time: '1 week ago',
    text: 'Came for the thumbnail, stayed for the editing. More like this please 🙌',
    likes: 32,
  },
]

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function ActionPill({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition',
        active ? 'bg-brand-100 text-brand-700' : 'bg-[#f2f2f4] text-ink hover:bg-[#e8e8ec]',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}

export default function WatchPage({ onCreate }: { onCreate: () => void }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const {
    getVideo,
    removeVideo,
    recordHistory,
    ads,
    allVideos,
    watchLater,
    liked,
    toggleWatchLater,
    toggleLike,
    subscriptions,
    toggleSubscription,
  } = useStore()

  const video = getVideo(id)
  const channel = video ? ALL_CHANNEL_MAP[video.channelId] : undefined
  const ad = video && 'isAd' in video && video.isAd ? (video as Ad) : null

  usePageTitle(video?.title ?? 'Video')
  useEffect(() => {
    if (id) recordHistory(id)
  }, [id, recordHistory])

  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [autoplay, setAutoplay] = useState(true)
  const [comments, setComments] = useState<Comment[]>(SEED_COMMENTS)
  const [commentText, setCommentText] = useState('')
  const [commentFocused, setCommentFocused] = useState(false)

  const related = useMemo(() => {
    if (!video) return []
    const rest = [...allVideos, ...ads].filter((item) => item.id !== video.id)
    const sameCategory = rest.filter((item) => item.category === video.category)
    const other = rest.filter((item) => item.category !== video.category)
    return [...sameCategory, ...other].slice(0, 10)
  }, [allVideos, ads, video])

  if (!video || !channel) return <NotFoundPage />

  const source = resolveSource(video.videoUrl)
  const saved = watchLater.includes(video.id)
  const isLiked = liked.includes(video.id)
  const isSubscribed = subscriptions.includes(channel.id)
  const likeCount = 120 + (hashString(video.id) % 18000)

  const description = [
    `${video.title} — full episode in ${video.category}.`,
    '',
    'In this video we break down the story behind the scenes, the tools and the people involved, and what comes next. Chapters below.',
    '',
    '00:00 Intro',
    '01:24 The setup',
    '04:10 What actually happened',
    `0${Math.min(9, 4 + (hashString(video.id) % 5))}:00 Wrap-up and next steps`,
    '',
    `#${video.category.toLowerCase().replace(/[^a-z0-9]/g, '')} #gridwatch #${channel.name.toLowerCase()}`,
  ].join('\n')

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/watch/${video!.id}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this link', `${window.location.origin}/watch/${video!.id}`)
    }
  }

  function submitComment(event: FormEvent) {
    event.preventDefault()
    const text = commentText.trim()
    if (!text) return
    setComments((current) => [
      { id: `c-${Date.now()}`, name: 'Alex Rivera', avatar: AVATARS.user, time: 'Just now', text, likes: 0 },
      ...current,
    ])
    setCommentText('')
    setCommentFocused(false)
  }

  return (
    <div className="flex flex-col gap-8 pt-4 rail:flex-row rail:gap-6">
      <div className="min-w-0 flex-1">
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-[0_18px_50px_-25px_rgba(0,0,0,0.5)]">
          {(source.kind === 'youtube' || source.kind === 'vimeo') && (
            <iframe
              src={source.src}
              title={video.title}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          )}

          {source.kind === 'embed' && (
            <iframe
              src={source.src}
              title={video.title}
              className="absolute inset-0 h-full w-full"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              allowFullScreen
            />
          )}

          {source.kind === 'file' && (
            <video
              src={source.src}
              poster={video.thumbnail}
              controls
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full bg-black"
            />
          )}

          {(source.kind === 'none' || source.kind === 'page') && (
            <div className="absolute inset-0">
              <img src={video.thumbnail} alt="" className="h-full w-full object-cover opacity-40" />
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-t from-black/85 via-black/50 to-black/30 px-6 text-center">
                <span className="mb-4 grid h-14 w-14 place-items-center rounded-full bg-white/15 text-white backdrop-blur">
                  <Play size={24} className="translate-x-[1px] fill-white" />
                </span>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/60">
                  {source.kind === 'page' ? 'External video' : 'Demo video'}
                </p>
                <h2 className="mt-1.5 line-clamp-2 max-w-xl text-[18px] font-bold text-white sm:text-[22px]">
                  {video.title}
                </h2>
                <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-white/65">
                  {source.kind === 'page'
                    ? 'This link cannot be embedded here. Open it on the original site to watch.'
                    : 'This demo video has no source attached yet. Add a video with your own link to play it here.'}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  {source.kind === 'page' && video.videoUrl && (
                    <a
                      href={video.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[12.5px] font-semibold text-ink"
                    >
                      <ExternalLink size={15} /> Open original
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={onCreate}
                    className="flex h-9 items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[12.5px] font-semibold text-white"
                  >
                    <Link2 size={15} /> Add a video link
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <h1 className="mt-4 line-clamp-2 text-[20px] font-bold leading-[1.3] tracking-[-0.02em] text-ink sm:text-[22px]">
          {video.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link to={`/channel/${channel.id}`} className="shrink-0">
              <img src={channel.avatar} alt={channel.name} className="h-10 w-10 rounded-full object-cover" />
            </Link>
            <div className="min-w-0">
              <Link to={`/channel/${channel.id}`} className="block truncate text-[15px] font-semibold text-ink hover:text-brand-700">
                {channel.name}
              </Link>
              <p className="text-[12px] text-muted">
                {channel.id === 'you' ? 'Your channel' : `${channel.subscribers} subscribers`}
              </p>
            </div>

            {channel.id === 'you' ? (
              <button
                type="button"
                onClick={onCreate}
                className="ml-1 flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-500 to-brand-700 px-4 text-[13px] font-semibold text-white transition hover:brightness-105"
              >
                Add video
              </button>
            ) : (
              <button
                type="button"
                onClick={() => toggleSubscription(channel.id)}
                className={[
                  'ml-1 flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition',
                  isSubscribed ? 'bg-[#f2f2f4] text-ink hover:bg-[#e8e8ec]' : 'bg-ink text-white hover:bg-black',
                ].join(' ')}
              >
                {isSubscribed ? <><Bell size={15} /> Subscribed</> : 'Subscribe'}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 items-center overflow-hidden rounded-full bg-[#f2f2f4]">
              <button
                type="button"
                onClick={() => toggleLike(video.id)}
                className={[
                  'flex h-9 items-center gap-2 px-3.5 text-[13px] font-semibold transition hover:bg-[#e8e8ec]',
                  isLiked ? 'text-brand-700' : 'text-ink',
                ].join(' ')}
                aria-pressed={isLiked}
              >
                <ThumbsUp size={17} fill={isLiked ? 'currentColor' : 'none'} />
                {formatCount(likeCount + (isLiked ? 1 : 0))}
              </button>
              <span className="h-5 w-px bg-[#dcdce1]" />
              <button
                type="button"
                className="flex h-9 items-center px-3.5 text-ink transition hover:bg-[#e8e8ec]"
                aria-label="Dislike"
              >
                <ThumbsDown size={17} />
              </button>
            </div>

            <ActionPill
              icon={copied ? <Check size={16} className="text-emerald-600" /> : <Share2 size={16} />}
              label={copied ? 'Copied' : 'Share'}
              onClick={() => void copyLink()}
            />
            <ActionPill
              icon={<Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />}
              label={saved ? 'Saved' : 'Save'}
              active={saved}
              onClick={() => toggleWatchLater(video.id)}
            />
            <KebabMenu
              videoId={video.id}
              advertiser={ad?.advertiser}
              onDelete={
                video.id.startsWith('u-')
                  ? () => {
                      removeVideo(video.id)
                      navigate('/')
                    }
                  : undefined
              }
            />
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-[#f2f2f4] px-3.5 py-3">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
            <span>{video.views}</span>
            <span className="text-[#8a8a92]">·</span>
            <span>{video.publishedAt}</span>
            {ad && (
              <span className="ml-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white">
                Ad · {ad.advertiser}
              </span>
            )}
          </div>

          {ad && (
            <p className="mt-1.5 text-[12.5px] font-medium text-brand-700">
              Includes paid promotion. {ad.adHeadline}
            </p>
          )}

          <p
            className={`mt-2 whitespace-pre-line text-[13px] leading-[1.65] text-[#3f3f46] ${descriptionOpen ? '' : 'line-clamp-3'}`}
          >
            {description}
          </p>

          {video.videoUrl && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <Link2 size={14} className="text-brand-600" />
              <span className="max-w-full truncate">{video.videoUrl}</span>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"
              >
                <Copy size={13} /> Copy page link
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setDescriptionOpen((open) => !open)}
            className="mt-2 text-[12.5px] font-semibold text-ink hover:text-brand-700"
          >
            {descriptionOpen ? 'Show less' : '...more'}
          </button>
        </div>

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[17px] font-bold">
              <MessageCircle size={18} className="text-brand-600" />
              {comments.length + 21} Comments
            </h2>
            <button type="button" className="text-[12.5px] font-semibold text-muted hover:text-ink">
              Sort by newest
            </button>
          </div>

          <form onSubmit={submitComment} className="mt-4 flex items-start gap-3">
            <img src={AVATARS.user} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <input
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                onFocus={() => setCommentFocused(true)}
                placeholder="Add a comment..."
                className="w-full border-b border-[#dcdce1] bg-transparent pb-2 text-[13.5px] text-ink placeholder:text-[#8f8f97] focus:border-ink"
              />
              {commentFocused && (
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCommentText('')
                      setCommentFocused(false)
                    }}
                    className="h-8 rounded-full px-3 text-[12.5px] font-semibold text-ink hover:bg-[#f2f2f4]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!commentText.trim()}
                    className="h-8 rounded-full bg-brand-600 px-3.5 text-[12.5px] font-semibold text-white transition enabled:hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-[#e3e3e8] disabled:text-[#9b9ba3]"
                  >
                    Comment
                  </button>
                </div>
              )}
            </div>
          </form>

          <ul className="mt-6 flex flex-col gap-5">
            {comments.map((comment) => (
              <li key={comment.id} className="flex items-start gap-3">
                <img src={comment.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                <div className="min-w-0">
                  <p className="text-[12.5px] text-ink">
                    <span className="font-semibold">@{comment.name.toLowerCase().replace(/\s+/g, '')}</span>{' '}
                    <span className="text-muted">{comment.time}</span>
                  </p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-[#3f3f46]">{comment.text}</p>
                  <div className="mt-2 flex items-center gap-4 text-[12px] text-muted">
                    <button type="button" className="flex items-center gap-1.5 font-medium hover:text-ink">
                      <ThumbsUp size={15} /> {comment.likes > 0 ? formatCount(comment.likes) : ''}
                    </button>
                    <button type="button" className="hover:text-ink">
                      <ThumbsDown size={15} />
                    </button>
                    <button type="button" className="font-semibold hover:text-ink">
                      Reply
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="w-full shrink-0 rail:w-[352px]">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-bold">Up next</h2>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-muted">
            Autoplay
            <button
              type="button"
              role="switch"
              aria-checked={autoplay}
              onClick={() => setAutoplay((value) => !value)}
              className={`relative h-5 w-9 rounded-full transition ${autoplay ? 'bg-brand-600' : 'bg-[#d4d4d8]'}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${autoplay ? 'left-[18px]' : 'left-0.5'}`}
              />
            </button>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {related.map((item) => (
            <VideoRow key={item.id} video={item} compact />
          ))}
        </div>
      </aside>
    </div>
  )
}
