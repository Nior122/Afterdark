/**
 * Recording pipeline tests.
 *
 * What this can and cannot cover is worth being precise about. There is no browser in this
 * environment, so an actual recording cannot be produced — no `MediaRecorder`, no canvas,
 * no codec. What *can* be tested is the part that decides what to record: the format
 * negotiation, which is the piece most likely to be silently wrong, because a wrong answer
 * here does not throw — it produces a file that WhatsApp or the iOS share sheet refuses.
 *
 * The stub below reproduces the two real-world capability sets: iOS Safari (MP4/H.264 only)
 * and Chrome on Android (WebM/VP9, with MP4 appearing on newer builds).
 *
 * Run: node --test scripts/*.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { register } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
register(pathToFileURL(resolve(root, 'scripts/ts-loader.mjs')).href)

const { pickMimeType, extensionFor } = await import(
  pathToFileURL(resolve(root, 'src/features/recording/useRecorder.ts')).href
)

/** Install a fake MediaRecorder whose isTypeSupported answers from `supported`. */
function withSupport(supported) {
  if (supported === null) {
    Reflect.deleteProperty(globalThis, 'MediaRecorder')
    return
  }
  globalThis.MediaRecorder = {
    isTypeSupported: (mime) => supported.includes(mime),
  }
}

test('no MediaRecorder at all yields null, so the UI can disable Record', () => {
  withSupport(null)
  assert.equal(pickMimeType(), null)
})

test('iOS Safari: MP4 only', () => {
  withSupport(['video/mp4'])
  assert.deepEqual(pickMimeType(), { mimeType: 'video/mp4', extension: 'mp4' })
})

test('older Android: VP8 WebM only', () => {
  withSupport(['video/webm;codecs=vp8,opus', 'video/webm'])
  assert.deepEqual(pickMimeType(), { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' })
})

test('MP4 wins when the platform supports both, because it shares without re-encoding', () => {
  withSupport(['video/webm;codecs=vp9,opus', 'video/mp4;codecs=avc1.42E01E'])
  assert.equal(pickMimeType()?.extension, 'mp4')
})

test('an audio-capable codec string is preferred over the bare container', () => {
  withSupport(['video/webm', 'video/webm;codecs=vp9,opus'])
  assert.equal(pickMimeType()?.mimeType, 'video/webm;codecs=vp9,opus')
})

test('nothing supported yields null rather than an optimistic guess', () => {
  withSupport([])
  assert.equal(pickMimeType(), null)
})

test('extensionFor maps the container, and falls back to webm when it does not know', () => {
  assert.equal(extensionFor('video/mp4;codecs=avc1.42E01E,mp4a.40.2'), 'mp4')
  assert.equal(extensionFor('video/webm;codecs=vp9'), 'webm')
  assert.equal(extensionFor('video/quicktime'), 'webm')
})

process.on('exit', () => withSupport(null))
