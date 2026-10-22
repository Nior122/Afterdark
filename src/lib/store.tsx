import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { SEED_VIDEOS, type Video } from '../data/seed'
import { fetchTelegramFeed } from './telegramFeed'

/**
 * Read-only catalogue.
 *
 * There is no add/edit UI anymore (the site has no navigation and no index
 * page): videos live in `src/data/videos.json` and, optionally, in the
 * Telegram bot feed. The only leftover browser data is the `userVideos` array
 * written by the previous version of the site — it is still read, so links to
 * those videos keep working and no visitor data is thrown away. Nothing is
 * written to storage any more.
 */

const LEGACY_STORAGE_KEY = 'gridwatch.store.v1'

interface LegacyState {
  userVideos?: Video[]
}

function loadLegacyVideos(): Video[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as LegacyState
    if (!Array.isArray(parsed.userVideos)) return []
    return parsed.userVideos.filter(
      (video) => video && typeof video.id === 'string' && typeof video.title === 'string',
    )
  } catch {
    return []
  }
}

interface StoreValue {
  /** Seed catalogue + legacy browser videos + Telegram feed, de-duplicated. */
  videos: Video[]
  /** False until the optional feed request has settled. */
  ready: boolean
  getVideo: (id: string) => Video | undefined
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [remoteVideos, setRemoteVideos] = useState<Video[]>([])
  const [ready, setReady] = useState(false)
  const legacyVideos = useMemo(loadLegacyVideos, [])

  useEffect(() => {
    let cancelled = false
    void fetchTelegramFeed().then((videos) => {
      if (cancelled) return
      setRemoteVideos(videos)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const videos = useMemo(() => {
    const seen = new Set<string>()
    const merged: Video[] = []
    for (const video of [...SEED_VIDEOS, ...remoteVideos, ...legacyVideos]) {
      if (seen.has(video.id)) continue
      seen.add(video.id)
      merged.push(video)
    }
    return merged
  }, [remoteVideos, legacyVideos])

  const getVideo = useCallback((id: string) => videos.find((video) => video.id === id), [videos])

  const value = useMemo<StoreValue>(() => ({ videos, ready, getVideo }), [videos, ready, getVideo])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
