import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import AdSlot, { GlobalAdScript } from '../components/AdSlot'
import EmbedPlayer from '../components/EmbedPlayer'
import TelegramPlayer from '../components/TelegramPlayer'
import TelegramCta from '../components/TelegramCta'
import { applyVideoMeta } from '../lib/meta'
import { absoluteUrl } from '../lib/site'
import { useStore } from '../lib/store'
import { reportVideoView } from '../lib/views'
import { resolveSource } from '../lib/video'
import NotFoundPage from './NotFoundPage'

/**
 * A video on its own URL (`/v/<id>/`).
 *
 * Deliberately contains only the player, the title and an optional short
 * description: no header, no menu, no breadcrumb, no related/up-next rail and
 * no autoplay of another video. This page looks the same in both site modes —
 * it is the unit that search engines index and that people share.
 */
export default function DirectVideoPage() {
  const { id = '' } = useParams()
  const { getVideo, ready } = useStore()
  const video = getVideo(id)

  useEffect(() => {
    if (video) applyVideoMeta(video)
  }, [video])

  // The view counter the dashboard reads. Bot-feed videos are recorded in the
  // Worker (deduped per browser session there); without a Worker, or for
  // build-time catalogue ids, reportVideoView no-ops or the Worker 404s the
  // unknown id — fire-and-forget either way.
  const videoId = video?.id
  useEffect(() => {
    if (videoId) reportVideoView(videoId)
  }, [videoId])

  if (!video) {
    // The optional bot feed arrives asynchronously; stay neutral rather than
    // flashing "not found" for a video that is still on its way.
    if (!ready) return <main className="min-h-[70vh]" aria-busy="true" />
    return <NotFoundPage />
  }

  const source = resolveSource(video.videoUrl)
  const poster = absoluteUrl(video.thumbnail)
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
            duration={video.duration}
            protectedEmbed={Boolean(video.protectedEmbed)}
            isPortrait={video.isPortrait}
          />
        )}

        {isTelegram && (
          <TelegramPlayer
            key={video.id}
            src={source.src}
            title={video.title}
            poster={poster}
            duration={video.duration}
            isPortrait={video.isPortrait}
          />
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

      {/* Owner CTA — under the video, before the description (components/TelegramCta.tsx). */}
      <TelegramCta className="mt-4" />

      {video.description?.trim() && (
        <p className="mt-3 max-w-[70ch] whitespace-pre-line text-[13px] leading-[1.7] text-muted sm:text-[13.5px]">
          {video.description.trim()}
        </p>
      )}

      {(source.kind === 'page' || source.kind === 'none') && video.id.startsWith('u-') && (
        <p className="mt-3 max-w-[70ch] text-[12.5px] leading-relaxed text-faint">
          This link is saved in this browser only and points at a page, not a playable file. Import
          it through the bot or the dashboard’s Scrape panel and the real video file is extracted,
          so it plays in-page for every visitor.
        </p>
      )}

      <AdSlot slot="video" className="mt-6" />
      <GlobalAdScript />
    </main>
  )
}
