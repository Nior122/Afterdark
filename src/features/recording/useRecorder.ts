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
  /** Optional watermark drawn into the recording. */
  watermark?: boolean
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

/**
 * Build the surface the recorder captures, with the watermark baked in.
 *
 * Sized to the WebGL drawing buffer (not the CSS size), so the blit is 1:1 and no
 * scaling artefacts appear. The mark is a wordmark plus a soft plate, drawn at a size
 * derived from the frame height so it looks the same at 480p and 1080p.
 */
function createWatermarkedSurface(source: HTMLCanvasElement): { canvas: HTMLCanvasElement; stop: () => void } {
  const out = document.createElement('canvas')
  out.width = source.width || 720
  out.height = source.height || 1280
  const ctx = out.getContext('2d', { alpha: false })

  let raf = 0
  let running = true

  const draw = () => {
    if (!running) return
    if (ctx) {
      // The source may have been resized by a quality change mid-recording.
      if (out.width !== source.width || out.height !== source.height) {
        out.width = source.width || out.width
        out.height = source.height || out.height
      }
      ctx.drawImage(source, 0, 0, out.width, out.height)
      drawWatermark(ctx, out.width, out.height)
    }
    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)

  return {
    canvas: out,
    stop: () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
    },
  }
}

function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const scale = Math.max(0.6, Math.min(1.6, height / 1280))
  const fontSize = Math.round(22 * scale)
  const pad = Math.round(14 * scale)
  const margin = Math.round(22 * scale)

  ctx.save()
  ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  ctx.textBaseline = 'middle'
  const label = watermarkLabel()
  const textWidth = ctx.measureText(label).width
  const plateHeight = fontSize + pad
  const x = width - margin - textWidth - pad
  const y = height - margin - plateHeight

  // A translucent plate keeps the mark legible over both dark hair and a bright shirt.
  ctx.fillStyle = 'rgba(2, 6, 23, 0.42)'
  roundRect(ctx, x, y, textWidth + pad * 2, plateHeight, plateHeight / 2)
  ctx.fill()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fillText(label, x + pad, y + plateHeight / 2 + 1)
  ctx.restore()
}

/** The wordmark, in one place so it can be swapped for a brand or a user handle. */
function watermarkLabel(): string {
  return 'Faceverify'
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
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
  const { canvas, audio, watermark = true, videoBitsPerSecond, maxDurationMs = MAX_MS } = options

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
  /** Present only while a watermarked recording is running. */
  const compositorRef = useRef<{ canvas: HTMLCanvasElement; stop: () => void } | null>(null)

  const supported =
    format !== null && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype

  const cleanupStreams = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
    compositorRef.current?.stop()
    compositorRef.current = null
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
      // With the watermark on, the captured canvas is a compositing surface: the WebGL
      // canvas is blitted into it and the mark is drawn on top. That is the only way to
      // bake a watermark into a single video track — MediaRecorder ignores a second
      // video track — and it costs one 2D blit per frame, only while recording.
      const source = watermark
        ? createWatermarkedSurface(canvas)
        : { canvas, stop: () => {} }
      compositorRef.current = source
      const canvasStream = source.canvas.captureStream(30)
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
  }, [audio, canvas, cleanupStreams, format, maxDurationMs, stop, supported, videoBitsPerSecond, watermark])

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
