import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import EmbedPlayer from '../components/EmbedPlayer'
import TelegramPlayer from '../components/TelegramPlayer'
import { PLACEHOLDER_THUMBNAIL } from '../data/seed'
import { applyVideoMeta } from '../lib/meta'
import { absoluteUrl } from '../lib/site'
import { useStore } from '../lib/store'
import { resolveSource } from '../lib/video'
import NotFoundPage from './NotFoundPage'

/**
 * A video, on its own.
 *
 * The page contains the player, the title and an optional short description —
 * and nothing that links anywhere else on the site. There is no header, no
 * menu, no breadcrumb, no related/up-next rail and no autoplay of another
 * video. Discovery is the sitemap's job, not this page's.
 */
export default function VideoPage() {
  const { id = '' } = useParams()
  const { getVideo, ready } = useStore()
  const video = getVideo(id)

  useEffect(() => {
    if (video) applyVideoMeta(video)
  }, [video])

  if (!video) {
    // The optional bot feed arrives asynchronously: stay neutral instead of
    // flashing "not found" for a video that is still on its way.
    if (!ready) return <main className="min-h-[70vh]" aria-busy="true" />
    return <NotFoundPage />
  }

  const source = resolveSource(video.videoUrl)
  const poster = absoluteUrl(video.thumbnail || PLACEHOLDER_THUMBNAIL)
  const isTelegram = source.kind === 'telegram'

  return (
    <main className="mx-auto w-full max-w-[1100px] px-3 py-5 sm:px-6 sm:py-10">
      <div
        className={[
          'relative w-full overflow-hidden rounded-2xl bg-black shadow-[0_18px_50px_-25px_rgba(0,0,0,0.55)]',
          isTelegram ? '' : 'aspect-video',
        ].join(' ')}
      >
        {source.kind === 'youtube' && (
          <iframe
            src={source.src}
            title={video.title}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        )}

        {source.kind === 'vimeo' && (
          <iframe
            src={source.src}
            title={video.title}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        )}

        {source.kind === 'embed' && (
          <EmbedPlayer
            key={video.id}
            src={source.src}
            title={video.title}
            poster={poster}
            protectedEmbed={Boolean(video.protectedEmbed)}
          />
        )}

        {isTelegram && (
          <TelegramPlayer key={video.id} src={source.src} title={video.title} poster={poster} />
        )}

        {source.kind === 'file' && (
          <video
            key={video.id}
            src={source.src}
            poster={poster}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        )}

        {(source.kind === 'none' || source.kind === 'page') && (
          <div className="absolute inset-0">
            <img src={poster} alt="" className="h-full w-full object-cover opacity-70" />
          </div>
        )}
      </div>

      <h1 className="mt-5 text-pretty text-[19px] font-bold leading-[1.35] tracking-[-0.015em] text-ink sm:text-[24px]">
        {video.title}
      </h1>

      {video.description?.trim() && (
        <p className="mt-3 max-w-[70ch] whitespace-pre-line text-[13px] leading-[1.7] text-muted sm:text-[13.5px]">
          {video.description.trim()}
        </p>
      )}
    </main>
  )
}
