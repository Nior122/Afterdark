/**
 * Recording preview, download and share.
 *
 * The recording never leaves the device unless the user taps Share, at which point the
 * Web Share API hands the file to whatever app they pick. On platforms without file
 * sharing (most desktops, older Android) it falls back to a download with the format's
 * real extension, because a WebM named `.mp4` is the kind of detail that turns a share
 * into a support message.
 */
import { useState } from 'react'
import { Sheet } from './Sheet'
import { IconCheck, IconDownload, IconShare } from './icons'
import { downloadRecording, shareRecording, type RecordingResult } from '../features/recording/useRecorder'
import { formatBytes } from '../lib/util'
import { showToast } from './Toast'

/** Local-time file stamp, `20261015-1432`, so downloads sort chronologically. */
function formatStamp(now: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

export interface RecordingSheetProps {
  result: RecordingResult | null
  onClose: () => void
  onRecordAgain: () => void
}

export function RecordingSheet({ result, onClose, onRecordAgain }: RecordingSheetProps) {
  const [sharing, setSharing] = useState(false)
  const [saved, setSaved] = useState(false)

  // The caller keys this component by the clip's URL, so a new clip remounts it and
  // `saved`/`sharing` reset themselves — no effect, and no chance of the "Saved" state
  // sticking to a different recording.
  const stamp = formatStamp(new Date())

  if (!result) return null

  const fileName = `faceverify-${stamp}.${result.extension}`

  return (
    <Sheet
      open
      onClose={onClose}
      title="Your clip is ready"
      subtitle={`${result.extension.toUpperCase()} · ${formatBytes(result.blob.size)} · recorded on this device`}
      flush
    >
      <div className="px-4">
        <video
          src={result.url}
          controls
          playsInline
          // `muted` avoids the autoplay refusal on iOS; the user can unmute in the
          // native controls if they recorded audio.
          muted
          className="w-full rounded-2xl bg-black shadow-[0_6px_24px_rgba(2,6,23,0.25)]"
        />

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              downloadRecording(result, fileName)
              setSaved(true)
              showToast('Saved to your downloads', { tone: 'success' })
            }}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-900 text-[14.5px] font-semibold text-white active:scale-[0.98]"
          >
            {saved ? <IconCheck className="h-5 w-5" /> : <IconDownload className="h-5 w-5" />}
            {saved ? 'Saved' : 'Download'}
          </button>
          <button
            type="button"
            disabled={sharing}
            onClick={async () => {
              setSharing(true)
              try {
                const outcome = await shareRecording(result)
                if (outcome === 'downloaded') showToast('Sharing is not available here, so we saved the file instead')
                if (outcome === 'cancelled') showToast('Share cancelled')
              } finally {
                setSharing(false)
              }
            }}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-100 text-[14.5px] font-semibold text-slate-900 ring-1 ring-slate-900/8 active:scale-[0.98] disabled:opacity-50"
          >
            <IconShare className="h-5 w-5" />
            {sharing ? 'Opening…' : 'Share'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            onClose()
            onRecordAgain()
          }}
          className="mt-2.5 h-12 w-full rounded-2xl text-[14.5px] font-semibold text-slate-500 active:scale-[0.98]"
        >
          Record another
        </button>

        <p className="mt-2 text-center text-[11.5px] leading-relaxed text-slate-400">
          The clip lives in this tab only. Closing it, or deleting your avatar, removes it.
        </p>
      </div>
    </Sheet>
  )
}
