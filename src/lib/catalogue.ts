import type { Video } from '../data/seed'

/** Publication time, including older browser-only uploads whose id encoded it. */
export function videoAddedAt(video: Video): number | null {
  if (video.addedAt) {
    const timestamp = Date.parse(video.addedAt)
    if (Number.isFinite(timestamp)) return timestamp
  }
  const legacyId = /^u-([a-z0-9]+)-[a-z0-9]+$/i.exec(video.id)
  if (legacyId) {
    const timestamp = Number.parseInt(legacyId[1], 36)
    if (Number.isSafeInteger(timestamp) && timestamp > 0) return timestamp
  }
  return null
}

/** Newest first; entries without a usable date stay in their original order last. */
export function sortByNewest(videos: Video[]): Video[] {
  return videos
    .map((video, index) => ({ video, index, timestamp: videoAddedAt(video) }))
    .sort((a, b) => {
      if (a.timestamp === null && b.timestamp === null) return a.index - b.index
      if (a.timestamp === null) return 1
      if (b.timestamp === null) return -1
      return b.timestamp - a.timestamp || a.index - b.index
    })
    .map(({ video }) => video)
}
