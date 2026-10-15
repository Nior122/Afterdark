/**
 * Service worker and install plumbing.
 *
 * Three small pieces of PWA housekeeping that would otherwise be invisible:
 *   - an update banner, because `registerType: 'prompt'` means the user decides when to
 *     reload. A silent auto-update mid-recording would be worse than a small banner.
 *   - an offline-ready toast, shown once, so the app works offline *and* the user knows.
 *   - an install button, deferred and shown only when the browser offers the prompt.
 *
 * The service worker itself never touches the camera, the photo, or IndexedDB. It caches
 * the shell and the model files, and nothing else.
 */
import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { showToast } from './Toast'
import { haptic } from '../lib/util'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaStatus() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new build every hour while the app is open. Long-lived sessions on
      // a phone are the norm, and a stale shell is how bug reports get invented.
      if (!registration) return
      window.setInterval(() => void registration.update(), 60 * 60 * 1000)
    },
    onRegisterError(error) {
      // Never fatal: without a service worker the app still runs, just without offline.
      console.warn('[faceverify] service worker registration failed', error)
    },
  })

  useEffect(() => {
    if (offlineReady) {
      showToast('Ready to work offline', { tone: 'success', hint: 'The app shell and models are cached on this device.' })
      setOfflineReady(false)
    }
  }, [offlineReady, setOfflineReady])

  if (!needRefresh) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[130] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
      <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-studio-900/95 px-3.5 py-3 shadow-[0_10px_30px_rgba(2,6,23,0.45)] ring-1 ring-white/10 backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white">A new version is ready</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-slate-400">
            Reloading takes a second. Your avatar is kept.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            haptic(6)
            void updateServiceWorker(true)
          }}
          className="h-9 flex-none rounded-xl bg-white px-3 text-[12.5px] font-semibold text-slate-900 active:scale-95"
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="h-9 flex-none rounded-xl px-2 text-[12.5px] font-medium text-slate-400"
        >
          Later
        </button>
      </div>
    </div>
  )
}

/**
 * Install button, rendered where the settings sheet can reach it. Returns null on iOS
 * Safari, which has no install prompt (the user adds to the home screen from Share) and
 * on any browser that has not fired the event.
 */
export function useInstallPrompt(): { canInstall: boolean; install: () => void } {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Chromium shows its own mini-infobar unless this is called.
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDeferred(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  return {
    canInstall: deferred !== null,
    install: () => {
      const event = deferred
      if (!event) return
      void event.prompt().then(() => event.userChoice).then(() => setDeferred(null))
    },
  }
}
