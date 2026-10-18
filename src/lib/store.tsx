import { asset } from '../lib/asset'
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
  ALL_CHANNELS,
  CATEGORIES,
  RECOMMENDED_ADS,
  SEED_VIDEOS,
  TRENDING_ADS,
  type Ad,
  type Video,
} from '../data/seed'
import { fetchTelegramFeed } from './telegramFeed'
import { guessThumbnail, resolveSource } from './video'

export interface NewVideoInput {
  title: string
  videoUrl: string
  channelId: string
  category: string
  duration?: string
  thumbnail?: string
  description?: string
  tags?: string[]
  protectedEmbed?: boolean
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
  liked: [],
  history: [],
  subscriptions: ['pov-central'],
}

function loadState(): PersistedState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    // Normalise videos saved before the adult rebrand: any category outside
    // the current adult taxonomy is moved to POV so an obsolete label cannot
    // resurface from localStorage.
    const adultCategories = new Set<string>(CATEGORIES.filter((category) => category !== 'All'))
    const userVideos = (Array.isArray(parsed.userVideos) ? parsed.userVideos : []).map((video) => ({
      ...video,
      category: adultCategories.has(video.category) ? video.category : 'POV',
    }))
    // Drop saved/liked/history references to videos that no longer exist
    // (e.g. catalogue entries removed from seed.ts), so returning browsers
    // do not keep ghost counts or broken collections.
    const validVideoIds = new Set(
      [...SEED_VIDEOS, ...RECOMMENDED_ADS, ...TRENDING_ADS, ...userVideos].map((v) => v.id),
    )
    const isKnownId = (id: string) => validVideoIds.has(id) || id.startsWith('tg-')
    const validChannelIds = new Set(ALL_CHANNELS.map((channel) => channel.id))
    const savedSubscriptions = Array.isArray(parsed.subscriptions)
      ? parsed.subscriptions.filter((id) => validChannelIds.has(id))
      : undefined
    return {
      userVideos,
      watchLater: Array.isArray(parsed.watchLater)
        ? parsed.watchLater.filter((id) => isKnownId(id))
        : DEFAULT_STATE.watchLater,
      liked: Array.isArray(parsed.liked)
        ? parsed.liked.filter((id) => isKnownId(id))
        : DEFAULT_STATE.liked,
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((entry) => entry && isKnownId(entry.id))
        : DEFAULT_STATE.history,
      subscriptions:
        savedSubscriptions && savedSubscriptions.length > 0
          ? savedSubscriptions
          : Array.isArray(parsed.subscriptions) && parsed.subscriptions.length === 0
            ? []
            : DEFAULT_STATE.subscriptions,
    }
  } catch {
    return DEFAULT_STATE
  }
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadState)
  const [remoteVideos, setRemoteVideos] = useState<Video[]>([])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage may be unavailable — the app still works in memory */
    }
  }, [state])

  useEffect(() => {
    let cancelled = false
    void fetchTelegramFeed().then((videos) => {
      if (!cancelled) setRemoteVideos(videos)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const ads = useMemo(() => [...RECOMMENDED_ADS, ...TRENDING_ADS], [])
  const allVideos = useMemo(() => {
    const seen = new Set<string>()
    const merged: Video[] = []
    for (const video of [...state.userVideos, ...remoteVideos, ...SEED_VIDEOS]) {
      if (seen.has(video.id)) continue
      seen.add(video.id)
      merged.push(video)
    }
    return merged
  }, [state.userVideos, remoteVideos])

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
        asset("/thumbnails/placeholder.svg"),
      duration: input.duration?.trim() || '—',
      views: '0 views',
      publishedAt: 'Just now',
      channelId: input.channelId,
      category: input.category,
      description: input.description?.trim() || undefined,
      tags: input.tags?.map((tag) => tag.trim()).filter(Boolean),
      // Generic and Telegram embeds are click-shielded by default so their
      // internal title/logo links cannot take viewers off AfterDark.
      protectedEmbed:
        input.protectedEmbed ?? (source.kind === 'embed' || source.kind === 'telegram'),
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
