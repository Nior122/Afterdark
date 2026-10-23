import { useState } from 'react'
import { Lock, LockOpen, Play } from 'lucide-react'

interface EmbedPlayerProps {
  src: string
  title: string
  poster: string
  duration?: string
  protectedEmbed?: boolean
  /** Vertical media: letterbox the poster instead of cropping the scene away. */
  isPortrait?: boolean
}

/**
 * Clean, click-shielded player for third-party embeds (e.g. `…/embed/<id>/`).
 *
 * No instructional text is rendered over the video. The protection stays,
 * invisibly:
 *
 * 1. Poster facade — the iframe is not loaded at all until the viewer
 *    presses our own play button, so the first click can never leave the site.
 * 2. Hardened sandbox — `allow-top-navigation*` and `allow-popups*` are
 *    deliberately omitted, so links/popunders inside the player cannot
 *    redirect this page or open the original site in a new tab.
 * 3. Cropped credit strip — the iframe is shifted up (and made taller by the
 *    same amount) so the source player's title/"hosted by" strip sits above
 *    the visible frame, while its bottom playback controls stay aligned.
 *    An invisible shield also covers that title area so it is not clickable.
 *    The hover lock control extends the shield to the whole player.
 */
export default function EmbedPlayer({ src, title, poster, duration, isPortrait }: EmbedPlayerProps) {
  const [activated, setActivated] = useState(false)
  const [clicksLocked, setClicksLocked] = useState(false)

  if (!activated) {
    return (
      <button
        type="button"
        onClick={() => setActivated(true)}
        aria-label={`Play ${title}`}
        className="group/embed absolute inset-0 block h-full w-full"
      >
        <img
          src={poster}
          alt=""
          referrerPolicy="no-referrer"
          className={`absolute inset-0 h-full w-full ${
            isPortrait ? 'object-contain' : 'object-cover'
          }`}
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition group-hover/embed:scale-105 group-hover/embed:bg-brand-600">
            <Play size={28} className="translate-x-[2px] fill-white" />
          </span>
        </span>

        {/* Timestamp on the facade, mirroring the card badge. */}
        {duration && duration !== '0:00' && (
          <span className="absolute bottom-2 right-2 rounded-[5px] bg-black/80 px-1.5 py-[3px] text-[11px] font-semibold leading-none text-white">
            {duration}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="group/embed absolute inset-0 overflow-hidden bg-black">
      <iframe
        src={src}
        title={title}
        // Shifted up by the height of the source player's title/credit strip
        // (and extended by the same amount) so that strip is cropped out of
        // the visible frame while the bottom controls remain aligned.
        className="absolute left-0 top-[-44px] h-[calc(100%+44px)] w-full sm:top-[-54px] sm:h-[calc(100%+54px)]"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        referrerPolicy="no-referrer"
        // Deliberately NO allow-top-navigation / allow-top-navigation-by-user-activation
        // and NO allow-popups / allow-popups-to-escape-sandbox: the embedded
        // player must not be able to redirect this page or open the source site.
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allowFullScreen
      />

      {/* Invisible shield over the (cropped) title/credit area. */}
      <div
        aria-hidden="true"
        data-testid="embed-title-shield"
        className="absolute inset-x-0 top-0 z-10 h-[44px] sm:h-[54px]"
        onClick={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
      />

      {/* Full shield: the whole video becomes non-clickable. */}
      {clicksLocked && (
        <div
          aria-hidden="true"
          data-testid="embed-full-shield"
          className="absolute inset-0 z-10"
          onClick={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
        />
      )}

      <button
        type="button"
        onClick={() => setClicksLocked((locked) => !locked)}
        aria-pressed={clicksLocked}
        aria-label={clicksLocked ? 'Unlock player clicks' : 'Lock player clicks'}
        title={clicksLocked ? 'Unlock player clicks' : 'Lock player clicks'}
        className={[
          'absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65 focus-visible:opacity-100',
          clicksLocked ? 'opacity-100' : 'opacity-0 group-hover/embed:opacity-100',
        ].join(' ')}
      >
        {clicksLocked ? <Lock size={14} /> : <LockOpen size={14} />}
      </button>
    </div>
  )
}
