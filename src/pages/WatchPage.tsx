import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Bell,
  Bookmark,
  Check,
  ExternalLink,
  Play,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import VideoRow from '../components/VideoRow'
import KebabMenu from '../components/KebabMenu'
import EmbedPlayer from '../components/EmbedPlayer'
import TelegramPlayer from '../components/TelegramPlayer'
import TelegramCta from '../components/TelegramCta'
import NotFoundPage from './NotFoundPage'
import { channelPath, type Ad } from '../data/seed'
import { useCaptureShield, videoGuardProps } from '../lib/anticapture'
import { avatarFallbackFor } from '../lib/avatars'
import { channelForVideo, faceForVideo } from '../lib/uploader'
import { usePageTitle } from '../lib/hooks'
import { useStore } from '../lib/store'
import { reportVideoView } from '../lib/views'
import { formatCount, resolveSource } from '../lib/video'

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
        active ? 'bg-brand-100 text-brand-700' : 'bg-raise text-ink hover:bg-sunken',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}

export default function WatchPage() {
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
  const channel = video ? channelForVideo(video) : undefined
  const ad = video && 'isAd' in video && video.isAd ? (video as Ad) : null

  usePageTitle(video?.title ?? 'Video')
  useEffect(() => {
    if (id) recordHistory(id)
  }, [id, recordHistory])
  // Same counter as the standalone /v/<id>/ page, so a view counts once per
  // browser session whichever mode the site is in.
  const watchedId = video?.id
  useEffect(() => {
    if (watchedId) reportVideoView(watchedId)
  }, [watchedId])

  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [autoplay, setAutoplay] = useState(true)
  // Player stays covered while the window is unfocused or the tab is hidden
  // (see lib/anticapture) — screenshots and app-switcher previews see black.
  const shielded = useCaptureShield()

  const related = useMemo(() => {
    if (!video) return []
    const rest = [...allVideos, ...ads].filter((item) => item.id !== video.id)
    const sameCategory = rest.filter((item) => item.category === video.category)
    const other = rest.filter((item) => item.category !== video.category)
    return [...sameCategory, ...other].slice(0, 10)
  }, [allVideos, ads, video])

  // Every listing resolves to a channel now, including visitor links, because an
  // unattributed video is placed on a channel by category (see lib/uploader).
  if (!video) return <NotFoundPage />

  const source = resolveSource(video.videoUrl)
  const saved = watchLater.includes(video.id)
  const isLiked = liked.includes(video.id)
  const isSubscribed = channel ? subscriptions.includes(channel.id) : false
  const likeCount = 120 + (hashString(video.id) % 18000)

  const description =
    video.description?.trim() ||
    [
      `${video.title} — watch the full video in ${video.category}.`,
      '',
      `Category: ${video.category}`,
      video.tags?.length
        ? `Tags: ${video.tags.join(', ')}`
        : channel
          ? `More from ${channel.name} in this category.`
          : `More like this in ${video.category}.`,
      '',
      `#${video.category.toLowerCase().replace(/[^a-z0-9]/g, '')} #afterdark${
        channel ? ` #${channel.name.toLowerCase().replace(/[^a-z0-9]/g, '')}` : ''
      }`,
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

  return (
    <div className="flex flex-col gap-8 pt-4 rail:flex-row rail:gap-6">
      <div className="min-w-0 flex-1">
        <div
          data-capture-guard=""
          className={[
            'relative w-full select-none overflow-hidden rounded-2xl bg-black shadow-[0_18px_50px_-25px_rgba(0,0,0,0.5)]',
            source.kind === 'telegram' ? '' : 'aspect-video',
          ].join(' ')}
        >
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
            <EmbedPlayer
              key={video.id}
              src={source.src}
              title={video.title}
              poster={video.thumbnail}
              duration={video.duration}
              protectedEmbed={Boolean(video.protectedEmbed)}
              isPortrait={video.isPortrait}
            />
          )}

          {source.kind === 'telegram' && (
            <TelegramPlayer
              key={video.id}
              src={source.src}
              title={video.title}
              poster={video.thumbnail}
              duration={video.duration}
              isPortrait={video.isPortrait}
            />
          )}

          {source.kind === 'file' && (
            <video
              src={source.src}
              poster={video.thumbnail}
              controls
              autoPlay
              playsInline
              {...videoGuardProps}
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
                {source.kind === 'page' && video.id.startsWith('u-') && (
                  <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-white/45">
                    Links added from the Create dialog are saved in this browser only. To publish a
                    playable copy for everyone, send the page link to your Telegram bot (or the
                    dashboard’s Scrape panel) — the import pulls the actual video file off the page
                    so it plays right here.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  {source.kind === 'page' && video.videoUrl && (
                    <a
                      href={video.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[12.5px] font-semibold text-[#0f0f0f]"
                    >
                      <ExternalLink size={15} /> Open original
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {shielded && (
            <div
              aria-hidden="true"
              data-testid="capture-shield"
              className="absolute inset-0 z-30 bg-black"
            />
          )}
        </div>

        <h1 className="mt-4 line-clamp-2 text-[20px] font-bold leading-[1.3] tracking-[-0.02em] text-ink sm:text-[22px]">
          {video.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to={channel ? channelPath(channel.id) : '#'}
              className="shrink-0"
              aria-label={channel ? `More from ${channel.name}` : undefined}
            >
              <img
                src={faceForVideo(video)}
                alt=""
                className="block h-10 w-10 rounded-full"
                onError={(event) => {
                  event.currentTarget.src = avatarFallbackFor(video)
                }}
              />
            </Link>
            {channel ? (
              <>
                <div className="min-w-0">
                  <Link
                    to={channelPath(channel.id)}
                    className="block truncate text-[15px] font-semibold text-ink hover:text-brand-700 hover:underline"
                  >
                    {channel.name}
                  </Link>
                  <p className="text-[12px] text-muted">{channel.subscribers} subscribers</p>
                </div>

                <button
                  type="button"
                  onClick={() => toggleSubscription(channel.id)}
                  className={[
                    'ml-1 flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition',
                    isSubscribed ? 'bg-raise text-ink hover:bg-sunken' : 'bg-action text-on-action hover:opacity-90',
                  ].join(' ')}
                >
                  {isSubscribed ? <><Bell size={15} /> Subscribed</> : 'Subscribe'}
                </button>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">Added by link · no uploader</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 items-center overflow-hidden rounded-full bg-raise">
              <button
                type="button"
                onClick={() => toggleLike(video.id)}
                className={[
                  'flex h-9 items-center gap-2 px-3.5 text-[13px] font-semibold transition hover:bg-sunken',
                  isLiked ? 'text-brand-700' : 'text-ink',
                ].join(' ')}
                aria-pressed={isLiked}
              >
                <ThumbsUp size={17} fill={isLiked ? 'currentColor' : 'none'} />
                {formatCount(likeCount + (isLiked ? 1 : 0))}
              </button>
              <span className="h-5 w-px bg-sunken" />
              <button
                type="button"
                className="flex h-9 items-center px-3.5 text-ink transition hover:bg-sunken"
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

        {/* Owner CTA — between the action row and the description box, outside
            it (see components/TelegramCta.tsx). Only ever on opened videos. */}
        <TelegramCta className="mt-3" />

        <div className="mt-4 rounded-xl bg-raise px-3.5 py-3">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
            <span>{video.views}</span>
            <span className="text-faint">·</span>
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
            className={`mt-2 whitespace-pre-line text-[13px] leading-[1.65] text-body ${descriptionOpen ? '' : 'line-clamp-3'}`}
          >
            {description}
          </p>

          {video.tags && video.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
              {video.tags.map((tag) => (
                <Link
                  key={tag}
                  to={`/results?q=${encodeURIComponent(tag)}`}
                  className="rounded-full bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-body ring-1 ring-line transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200"
                >
                  {tag}
                </Link>
              ))}
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
              className={`relative h-5 w-9 rounded-full transition ${autoplay ? 'bg-brand-600' : 'bg-faint'}`}
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
