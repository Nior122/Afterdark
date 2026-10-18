import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  RECOMMENDED_ADS,
  SEED_VIDEOS,
  TRENDING_ADS,
  type Ad,
  type Video,
} from '../data/seed'
import { guessThumbnail, resolveSource } from './video'

export interface NewVideoInput {
  title: string
  videoUrl: string
  channelId: string
  category: string
  duration?: string
  thumbnail?: string
}

export interface HistoryEntry {
  id: string
  at: number
}

interface PersistedState {
  userVideos: Video[]
  watchLater: string[]
  liked: string[]
  history: HistoryEntry[]
  subscriptions: string[]
}

interface StoreValue extends PersistedState {
  ads: Ad[]
  allVideos: Video[]
  addVideo: (input: NewVideoInput) => Video
  removeVideo: (id: string) => void
  updateVideo: (id: string, patch: Partial<Video>) => void
  toggleWatchLater: (id: string) => void
  toggleLike: (id: string) => void
  recordHistory: (id: string) => void
  clearHistory: () => void
  toggleSubscription: (channelId: string) => void
  isSubscribed: (channelId: string) => boolean
  getVideo: (id: string) => Video | Ad | undefined
}

const STORAGE_KEY = 'gridwatch.store.v1'

const DEFAULT_STATE: PersistedState = {
  userVideos: [],
  watchLater: SEED_VIDEOS.map((v) => v.id),
  liked: ['v-concert', 'v-lofi', 'v-match'],
  history: [
    { id: 'v-nebula', at: Date.now() - 1000 * 60 * 60 * 5 },
    { id: 'v-game-meta', at: Date.now() - 1000 * 60 * 60 * 26 },
    { id: 'v-city-doc', at: Date.now() - 1000 * 60 * 60 * 72 },
  ],
  subscriptions: ['techbit', 'cinemasphere', 'gameplay', 'newsnow'],
}

function loadState(): PersistedState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      userVideos: Array.isArray(parsed.userVideos) ? parsed.userVideos : [],
      watchLater: Array.isArray(parsed.watchLater) ? parsed.watchLater : DEFAULT_STATE.watchLater,
      liked: Array.isArray(parsed.liked) ? parsed.liked : DEFAULT_STATE.liked,
      history: Array.isArray(parsed.history) ? parsed.history : DEFAULT_STATE.history,
      subscriptions: Array.isArray(parsed.subscriptions)
        ? parsed.subscriptions
        : DEFAULT_STATE.subscriptions,
    }
  } catch {
    return DEFAULT_STATE
  }
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadState)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage may be unavailable — the app still works in memory */
    }
  }, [state])

  const ads = useMemo(() => [...RECOMMENDED_ADS, ...TRENDING_ADS], [])
  const allVideos = useMemo(() => [...state.userVideos, ...SEED_VIDEOS], [state.userVideos])

  const addVideo = useCallback((input: NewVideoInput) => {
    const source = resolveSource(input.videoUrl)
    const video: Video = {
      id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      title: input.title.trim() || 'Untitled video',
      videoUrl: input.videoUrl.trim(),
      thumbnail:
        input.thumbnail?.trim() ||
        source.poster ||
        guessThumbnail(input.videoUrl) ||
        '/thumbnails/city.jpg',
      duration: input.duration?.trim() || '—',
      views: '0 views',
      publishedAt: 'Just now',
      channelId: input.channelId,
      category: input.category,
    }
    setState((prev) => ({ ...prev, userVideos: [video, ...prev.userVideos] }))
    return video
  }, [])

  const removeVideo = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      userVideos: prev.userVideos.filter((v) => v.id !== id),
      watchLater: prev.watchLater.filter((v) => v !== id),
      liked: prev.liked.filter((v) => v !== id),
      history: prev.history.filter((h) => h.id !== id),
    }))
  }, [])

  const updateVideo = useCallback((id: string, patch: Partial<Video>) => {
    setState((prev) => ({
      ...prev,
      userVideos: prev.userVideos.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }))
  }, [])

  const toggleWatchLater = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      watchLater: prev.watchLater.includes(id)
        ? prev.watchLater.filter((v) => v !== id)
        : [id, ...prev.watchLater],
    }))
  }, [])

  const toggleLike = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      liked: prev.liked.includes(id)
        ? prev.liked.filter((v) => v !== id)
        : [id, ...prev.liked],
    }))
  }, [])

  const recordHistory = useCallback((id: string) => {
    setState((prev) => {
      const next = prev.history.filter((h) => h.id !== id)
      return { ...prev, history: [{ id, at: Date.now() }, ...next].slice(0, 60) }
    })
  }, [])

  const clearHistory = useCallback(() => {
    setState((prev) => ({ ...prev, history: [] }))
  }, [])

  const toggleSubscription = useCallback((channelId: string) => {
    setState((prev) => ({
      ...prev,
      subscriptions: prev.subscriptions.includes(channelId)
        ? prev.subscriptions.filter((c) => c !== channelId)
        : [...prev.subscriptions, channelId],
    }))
  }, [])

  const isSubscribed = useCallback(
    (channelId: string) => state.subscriptions.includes(channelId),
    [state.subscriptions],
  )

  const getVideo = useCallback(
    (id: string) => allVideos.find((v) => v.id === id) ?? ads.find((a) => a.id === id),
    [allVideos, ads],
  )

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      ads,
      allVideos,
      addVideo,
      removeVideo,
      updateVideo,
      toggleWatchLater,
      toggleLike,
      recordHistory,
      clearHistory,
      toggleSubscription,
      isSubscribed,
      getVideo,
    }),
    [
      state,
      ads,
      allVideos,
      addVideo,
      removeVideo,
      updateVideo,
      toggleWatchLater,
      toggleLike,
      recordHistory,
      clearHistory,
      toggleSubscription,
      isSubscribed,
      getVideo,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
