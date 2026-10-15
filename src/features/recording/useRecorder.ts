/**
 * Avatar recording.
 *
 * Captures the WebGL canvas straight out of the page with `captureStream()`, so what
 * is recorded is exactly what is on screen — including the live camera-driven
 * animation. Microphone audio is opt-in and off by default, because asking for the
 * microphone unprompted is a good way to get a permission denial that poisons the
 * camera prompt later.
 *
 * Format handling is browser-driven rather than assumed:
 *  - Prefer MP4/H.264 where the platform supports it (iOS Safari), because that is
 *    what WhatsApp and the native share sheet handle without re-encoding.
 *  - Fall back to VP9/VP8 WebM on Android and desktop.
 *  - Report the chosen format so the UI can label the download honestly.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { devWarn, haptic } from '../../lib/util'

export interface RecordingResult {
  url: string
  blob: Blob
  mimeType: string
  extension: string
}

export interface RecorderOptions {
  /** The canvas to capture. Null until the renderer has created it. */
  canvas: HTMLCanvasElement | null
  /** Include microphone audio. */
  audio: boolean
  /** Bits per second. Scaled by resolution so Lite mode produces smaller files. */
  videoBitsPerSecond?: number
  maxDurationMs?: number
}

/** Candidate mime types, most preferred first. */
const CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const

export function pickMimeType(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const candidate of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return {
        mimeType: candidate,
        // MP4 is the thing every messaging app in Nigeria will accept without a
        // re-encode; WebM needs a conversion step the user should not have to do.
        extension: candidate.startsWith('video/mp4') ? 'mp4' : 'webm',
      }
    }
  }
  return null
}


export interface RecorderApi {
  supported: boolean
  format: { mimeType: string; extension: string } | null
  isRecording: boolean
  /** True between stop() and the recorder emitting its final chunk. */
  finalising: boolean
  durationMs: number
  result: RecordingResult | null
  start: () => Promise<void>
  stop: () => void
  clear: () => void
  error: string | null
}

const MAX_MS = 90_000

export function useRecorder(options: RecorderOptions): RecorderApi {
  const { canvas, audio, videoBitsPerSecond, maxDurationMs = MAX_MS } = options

  const [isRecording, setIsRecording] = useState(false)
  const [finalising, setFinalising] = useState(false)
  const [durationMs, setDurationMs] = useState(0)
  const [result, setResult] = useState<RecordingResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef(0)
  const tickRef = useRef<number | null>(null)
  // A plain state value rather than a ref: the mime type is a one-off capability probe,
  // it never changes for the life of the page, and a ref would mean reading it during
  // render to decide whether to show the record button at all.
  const [format] = useState(pickMimeType)

  const supported =
    format !== null && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype

  const cleanupStreams = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioStreamRef.current = null
  }, [])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state !== 'inactive') {
      setFinalising(true)
      recorder.stop()
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)

    if (!canvas) {
      setError('The renderer is not ready yet. Try again in a moment.')
      return
    }
    if (!supported || !format) {
      setError('Recording is not supported in this browser.')
      return
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') return

    try {
      // 30 fps is plenty for a talking head and keeps the file small.
      //
      // Straight off the renderer's own canvas. That works with
      // `preserveDrawingBuffer: false` because captureStream() is served by the
      // compositor as frames are presented — it never reads the drawing buffer back.
      // The watermark, when enabled, is drawn *inside* the scene instead, so this stays
      // a single uncontested capture with no per-frame copy.
      const canvasStream = canvas.captureStream(30)
      streamRef.current = canvasStream

      const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()]

      if (audio) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          })
          audioStreamRef.current = mic
          tracks.push(...mic.getAudioTracks())
        } catch (err) {
          // Not fatal: record silently rather than refusing to record at all.
          devWarn('microphone unavailable, recording without audio', err)
          setError('Recording without sound: the microphone was not available.')
        }
      }

      const combined = new MediaStream(tracks)
      const size = canvas.width * canvas.height
      const bitrate = videoBitsPerSecond ?? (size > 2_000_000 ? 6_000_000 : size > 1_000_000 ? 3_500_000 : 2_000_000)

      const recorder = new MediaRecorder(combined, {
        mimeType: format.mimeType,
        videoBitsPerSecond: bitrate,
        audioBitsPerSecond: audio ? 96_000 : undefined,
      })

      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = (event) => {
        devWarn('MediaRecorder error', event)
        setError('Recording stopped unexpectedly.')
        cleanupStreams()
        setIsRecording(false)
      }
      recorder.onstop = () => {
        cleanupStreams()
        setIsRecording(false)
        setFinalising(false)
        // MediaRecorder flushes its last chunk asynchronously, so the blob is only
        // complete here rather than in stop().
        if (chunksRef.current.length > 0 && format) {
          setResult((previous) => {
            // Release the previous object URL; holding several multi-megabyte blobs
            // alive is a real memory problem on a low-RAM phone.
            if (previous) URL.revokeObjectURL(previous.url)
            return buildRecordingResult(chunksRef.current, format)
          })
        }
        chunksRef.current = []
      }

      recorderRef.current = recorder
      // A 1 s timeslice means we have data even if the tab is killed mid-recording.
      recorder.start(1000)
      startedAtRef.current = performance.now()
      setDurationMs(0)
      setIsRecording(true)
      haptic([10, 40, 10])

      tickRef.current = window.setInterval(() => {
        const elapsed = performance.now() - startedAtRef.current
        setDurationMs(elapsed)
        if (elapsed >= maxDurationMs) stop()
      }, 200)
    } catch (err) {
      devWarn('could not start recording', err)
      setError('Could not start recording on this device.')
      cleanupStreams()
      setIsRecording(false)
    }
  }, [audio, canvas, cleanupStreams, format, maxDurationMs, stop, supported, videoBitsPerSecond])

  const clear = useCallback(() => {
    setDurationMs(0)
    setError(null)
    setResult((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return null
    })
  }, [])

  useEffect(() => () => cleanupStreams(), [cleanupStreams])

  return {
    supported,
    format,
    isRecording,
    finalising,
    durationMs,
    result,
    start,
    stop,
    clear,
    error,
  }
}

/** Turn the collected chunks into a playable file. */
export function buildRecordingResult(chunks: Blob[], format: { mimeType: string; extension: string }): RecordingResult {
  const blob = new Blob(chunks, { type: format.mimeType })
  return {
    url: URL.createObjectURL(blob),
    blob,
    mimeType: format.mimeType,
    extension: format.extension,
  }
}

/**
 * Share via the Web Share API when available (Android Chrome, iOS Safari), and fall
 * back to a download otherwise.
 */
export async function shareRecording(result: RecordingResult, title = 'My Faceverify avatar'): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const fileName = `${title.replace(/[^\w-]+/g, '-').toLowerCase()}.${result.extension}`
  const file = new File([result.blob], fileName, { type: result.mimeType })

  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>
  }

  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title })
      return 'shared'
    } catch (err) {
      // AbortError means the user dismissed the sheet, which is not a failure.
      if ((err as DOMException)?.name === 'AbortError') return 'cancelled'
      devWarn('share failed, falling back to download', err)
    }
  }

  downloadRecording(result, fileName)
  return 'downloaded'
}

export function downloadRecording(result: RecordingResult, fileName?: string): void {
  const name = fileName ?? `faceverify-avatar.${result.extension}`
  const link = document.createElement('a')
  link.href = result.url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
}
