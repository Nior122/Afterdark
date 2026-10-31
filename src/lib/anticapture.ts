import { useEffect, useState } from 'react'

/**
 * Best-effort capture deterrence for the players.
 *
 * On the open web a visible frame is always a capturable one — only DRM
 * (impossible on these self-hosted and embedded players) truly prevents it.
 * What this does is close every easy path:
 *
 *   • a solid shield covers the player while the window is unfocused or the
 *     tab is hidden — app-switcher previews and casual grabs see black;
 *   • `videoGuardProps` kills Chrome's native download button in the control
 *     bar, the right-click “Save video as”, drag-to-desktop and PiP;
 *   • the [data-capture-guard] print rule (index.css) stops print-to-PDF.
 *
 * Playback keeps running behind the shield — the display, not the video, is
 * protected. Pages mark their player container `data-capture-guard`.
 */
export function useCaptureShield(): boolean {
  const [shielded, setShielded] = useState(
    () => typeof document !== 'undefined' && (document.hidden || !document.hasFocus()),
  )
  useEffect(() => {
    const hide = () => setShielded(true)
    const reveal = () => {
      if (!document.hidden && document.hasFocus()) setShielded(false)
    }
    const onVisibility = () => (document.hidden ? hide() : reveal())
    window.addEventListener('blur', hide)
    window.addEventListener('focus', reveal)
    document.addEventListener('visibilitychange', onVisibility)
    // A tab opened in the background starts shielded until it is really seen.
    reveal()
    return () => {
      window.removeEventListener('blur', hide)
      window.removeEventListener('focus', reveal)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  return shielded
}

/** Props for a raw <video> element: no native download, no PiP, no save-menu, no drag. */
export const videoGuardProps = {
  controlsList: 'nodownload noplaybackrate',
  disablePictureInPicture: true,
  draggable: false,
  onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
}
