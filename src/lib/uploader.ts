import {
  ALL_CHANNEL_MAP,
  ALL_CHANNELS,
  type Channel,
  type Video,
} from '../data/seed'
import { avatarFor, hashString } from './avatars'

/** The fields attribution needs; a store video always has them. */
export type Listing = Pick<Video, 'id' | 'channelId' | 'category'> & Partial<Pick<Video, 'avatar'>>

/**
 * The channel — that is, the uploader — behind a listing.
 *
 * An explicitly attributed video keeps whatever it was given. Everything else
 * (visitor uploads and Telegram imports both store `channelId: ''`) is placed
 * on one of the channels in the live roster, chosen by hashing the video id
 * over the whole pool. That makes the pairing stable across reloads and equal
 * on every device without persisting anything, and spreads uploads evenly
 * across every channel instead of concentrating them on the two that match a
 * single category.
 */
export function channelForVideo(video: Listing): Channel {
  const explicit = video.channelId ? ALL_CHANNEL_MAP[video.channelId] : undefined
  if (explicit) return explicit
  return ALL_CHANNELS[hashString(video.id || 'afterdark') % ALL_CHANNELS.length]!
}

/**
 * The face shown beside a listing: an explicit override wins, then the
 * channel's own avatar so every upload from a channel looks the same, and
 * only then the pool hash for the rare video with no resolvable channel.
 */
export function faceForVideo(video: Listing): string {
  if (video.avatar) return video.avatar
  return channelForVideo(video).avatar || avatarFor(video.id)
}

/**
 * Everything a channel has published. Computed by resolving each listing's
 * attribution, so it covers seeded videos, visitor uploads and Telegram
 * imports alike, and stays in sync with what the cards claim.
 */
export function videosForChannel<T extends Listing>(videos: readonly T[], channel: { id: string }): T[] {
  return videos.filter((video) => channelForVideo(video).id === channel.id)
}
