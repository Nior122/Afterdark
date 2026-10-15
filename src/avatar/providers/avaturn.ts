/**
 * Option A: Avaturn.
 *
 * ## What the research found (checked against Avaturn's own docs and pricing, 2026)
 *
 * Avaturn's selfie-to-avatar generation is genuinely good, and it is the only
 * off-the-shelf option that returns a rigged GLB with ARKit blendshapes. But the
 * commercial shape of the product does not fit this brief:
 *
 * - **Free tier = the iframe widget only.** Their docs say integration via the
 *   widget is free with "no limits on the number of avatars created or number of
 *   exports". The *programmatic* API and the JavaScript SDK — the parts you would use
 *   to drive generation from your own UI and get bytes back into your own scene —
 *   require a paid plan: "Avaturn API is only available in a paid package and is not
 *   available on free plan."
 * - **PRO is $800/month** for up to 1,000 avatars, then $0.15 per extra avatar.
 *   (Some third-party listings quote 6,000; Avaturn's own pricing page says 1,000.)
 *   There is no mid-tier between free and $800.
 * - **The free path uploads the selfie to Avaturn's servers** and opens their UI in
 *   an iframe. That is a real privacy disclosure, not a technicality, and it
 *   contradicts the brief's on-device requirement — so it must be shown to the user
 *   *before* the iframe opens.
 * - Because the widget hands the GLB to the parent page via `postMessage`, we can
 *   load the result with our own loader and still get the full ARKit rig and our own
 *   rendering. So the integration is real, not a stub.
 *
 * ## How this provider behaves
 *
 * Configured by `VITE_AVATURN_SUBDOMAIN`. If it is unset the provider reports itself
 * unavailable and the UI simply does not offer it — no broken button, and no surprise
 * $800 bill. When it *is* set, we embed the iframe, listen for the avatar URL, and
 * fetch the GLB. Avaturn's own terms and privacy policy apply to that path, which is
 * why the UI shows an explicit disclosure first.
 */
import { AppError, devLog } from '../../lib/util'
import type { AvatarProvider, AvatarAsset, ProviderAvailability } from '../types'

/**
 * The subdomain created at developer.avaturn.me, e.g. "demo" for demo.avaturn.dev.
 * Left empty by default so the paid dependency is opt-in, never accidental.
 */
export const AVATURN_SUBDOMAIN: string =
  (import.meta.env.VITE_AVATURN_SUBDOMAIN as string | undefined)?.trim() ?? ''

export const AVATURN_DISCLOSURE =
  'Avaturn processes your photo on their servers to build the head. ' +
  'Your photo leaves this device for that step. ' +
  'On Avaturn’s free plan this uses their hosted widget, which shows their own interface.'

/** Message shapes Avaturn's widget posts to the parent window. */
type AvaturnMessage = {
  eventName?: string
  type?: string
  data?: { url?: string; avatarUrl?: string; glbUrl?: string }
  url?: string
}

/**
 * Open Avaturn's hosted creator in an iframe overlay and wait for the avatar URL.
 *
 * Returns the GLB URL. The caller decides what to do with it (we fetch the bytes so
 * the avatar can be stored locally and reloaded offline).
 */
export function openAvaturnWidget(): Promise<string> {
  if (!AVATURN_SUBDOMAIN) {
    return Promise.reject(
      new AppError(
        'avaturn-not-configured',
        'Avaturn is not configured for this deployment.',
        'Set VITE_AVATURN_SUBDOMAIN at build time, or use the on-device provider.',
      ),
    )
  }

  return new Promise<string>((resolve, reject) => {
    const iframeOrigin = `https://${AVATURN_SUBDOMAIN}.avaturn.dev`
    const iframe = document.createElement('iframe')
    iframe.src = iframeOrigin
    iframe.title = 'Avaturn avatar creator'
    // allow-same-origin is deliberately omitted: Avaturn's widget only needs to run
    // its own script and post to the parent, and granting same-origin would let the
    // embed read our storage.
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals')
    Object.assign(iframe.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      border: '0',
      zIndex: '70',
      background: '#0b0d12',
    } satisfies Partial<CSSStyleDeclaration>)

    const close = () => {
      window.removeEventListener('message', onMessage)
      iframe.remove()
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== iframeOrigin) return
      const payload = event.data as AvaturnMessage | string | undefined
      devLog('avaturn message', payload)

      let url: string | undefined
      if (typeof payload === 'string') {
        url = payload.startsWith('http') ? payload : undefined
      } else if (payload) {
        url = payload.data?.url ?? payload.data?.avatarUrl ?? payload.data?.glbUrl ?? payload.url
      }

      const name = typeof payload === 'object' && payload ? (payload.eventName ?? payload.type ?? '') : ''
      if (name === 'avatar.exported' && url) {
        close()
        resolve(url)
      } else if (name === 'avatar.exported' || (name === 'close' && !url)) {
        // User dismissed without exporting.
        close()
        reject(new AppError('avaturn-cancelled', 'Avatar creation was cancelled.'))
      }
    }

    window.addEventListener('message', onMessage)
    document.body.appendChild(iframe)

    // The widget has no reliable "cancelled" event across versions, so also let the
    // user back out with the browser's own back gesture/Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      window.removeEventListener('keydown', onKey)
      close()
      reject(new AppError('avaturn-cancelled', 'Avatar creation was cancelled.'))
    }
    window.addEventListener('keydown', onKey, { once: true })
  })
}

export function createAvaturnProvider(): AvatarProvider {
  return {
    id: 'avaturn',
    label: 'Avaturn (hosted)',
    summary: 'Higher-detail generated head from Avaturn’s servers. Your photo is uploaded.',
    privacy: 'uploads-photo',
    cost: 'free-tier',
    disclosure: AVATURN_DISCLOSURE,

    availability: async (): Promise<ProviderAvailability> => {
      if (!AVATURN_SUBDOMAIN) {
        return {
          ready: false,
          reason:
            'Not configured for this deployment. Avaturn’s programmatic API needs their $800/month plan; only the free hosted widget can be embedded.',
          recoverable: false,
        }
      }
      if (!navigator.onLine) {
        return { ready: false, reason: 'Avaturn needs a network connection.', recoverable: true }
      }
      return { ready: true }
    },

    async generate({ onProgress, signal }): Promise<AvatarAsset> {
      onProgress?.({ stage: 'downloading', progress: 0.1, message: 'Opening Avaturn…' })

      const url = await openAvaturnWidget()
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

      onProgress?.({ stage: 'downloading', progress: 0.6, message: 'Downloading your avatar…' })

      const res = await fetch(url, { signal, mode: 'cors' })
      if (!res.ok) {
        throw new AppError('avaturn-download-failed', `Could not download the avatar (HTTP ${res.status}).`)
      }
      const glb = await res.arrayBuffer()

      onProgress?.({ stage: 'done', progress: 1, message: 'Avatar ready' })

      return {
        source: 'avaturn',
        glb,
        metadata: {
          provider: 'Avaturn (hosted widget, free tier)',
          generatedAt: new Date().toISOString(),
          bytes: glb.byteLength,
          notes: [
            'generated by Avaturn’s servers; the selfie was uploaded to Avaturn',
            'ARKit blendshapes expected; the loader auto-detects the morph target mapping',
          ],
        },
      }
    },
  }
}
