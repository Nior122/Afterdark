/**
 * Per-frame JavaScript cost probe.
 *
 * WHY THIS EXISTS
 *
 * The acceptance criterion is "tracking holds 24+ FPS on a mid-range Android, and the app
 * survives a 6x CPU throttle". Frames per second cannot be measured in this environment:
 * there is no browser, no GPU and no CPU-throttling control here, and reporting an FPS
 * number invented from a synthetic benchmark would be a lie dressed up as evidence.
 *
 * What *can* be measured honestly is the part of a frame the app itself is responsible
 * for in JavaScript — the idle animator, the live-path filtering, and the blendshape
 * composition — using the app's real modules, not a re-implementation. That gives a floor:
 *
 *     "our own animation and filtering code costs X ms per frame on this machine"
 *
 * and the 6x column is that number scaled linearly. The rest of the budget (rasterisation,
 * GPU upload, MediaPipe's WASM inference, the compositor) is NOT measured here and is where
 * the actual risk lives. Read the output as a lower bound, not as a frame rate.
 *
 * Usage: node tools/perf-probe.mjs
 */
import { register } from 'node:module'
import { performance } from 'node:perf_hooks'

register(new URL('../scripts/ts-loader.mjs', import.meta.url).href)

const { IdleAnimator } = await import('../src/avatar/idle.ts')
const { ARKIT_BLENDSHAPES } = await import('../src/avatar/arkit.ts')
const { OneEuroFilter, POSE_FILTER, BLENDSHAPE_FILTER, GAZE_FILTER, QuaternionSmoother } = await import(
  '../src/tracking/oneEuroFilter.ts'
)
const { applyManualExpression, manualInput } = await import('../src/state/manualInput.ts')
const { CHANNEL } = await import('../src/avatar/rig.ts')

const CHANNELS = ARKIT_BLENDSHAPES.length
const channelIndex = new Map(ARKIT_BLENDSHAPES.map((name, i) => [name, i]))
const channel = (name) => {
  const i = channelIndex.get(name)
  return i === undefined ? 0 : i
}

/** Median of `runs` batches of `perBatch` iterations, to shrug off JIT warm-up and GC. */
function measure(perBatch, runs, fn) {
  const samples = []
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now()
    for (let i = 0; i < perBatch; i++) fn(i)
    samples.push((performance.now() - t0) / perBatch)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]
}

const IDLE_FRAMES = 20000
const results = []

// --- 1. idle animation ------------------------------------------------------
{
  const animator = new IdleAnimator()
  const ms = measure(IDLE_FRAMES, 7, () => animator.update(1 / 30))
  results.push(['IdleAnimator.update()', ms, 'runs every frame in every mode'])
}

// --- 2. manual mode composition --------------------------------------------
{
  const expression = new Float32Array(CHANNELS)
  manualInput.mouthOpen = 0.4
  manualInput.smile = 0.3
  const ms = measure(IDLE_FRAMES, 7, () => applyManualExpression(expression, channel))
  results.push(['applyManualExpression()', ms, 'clears + writes the 52-channel expression'])
}

// --- 3. live mode filtering -------------------------------------------------
{
  // The live path filters every blendshape the tracker reports, plus the head quaternion
  // and the gaze vector — the same shape as the real per-frame work in useLiveTracking.
  const blendshapes = ARKIT_BLENDSHAPES.map(() => new OneEuroFilter(BLENDSHAPE_FILTER))
  const smoother = new QuaternionSmoother(POSE_FILTER)
  const gx = new OneEuroFilter(GAZE_FILTER)
  const gy = new OneEuroFilter(GAZE_FILTER)
  const quat = { x: 0, y: 0, z: 0, w: 1 }
  const ms = measure(IDLE_FRAMES, 7, (i) => {
    const t = i / 30
    const v = 0.5 + 0.5 * Math.sin(t)
    for (let s = 0; s < blendshapes.length; s++) blendshapes[s].filter(v, t)
    quat.x = 0.02 * Math.sin(t)
    quat.y = 0.03 * Math.cos(t)
    quat.z = 0.01 * Math.sin(t * 0.7)
    quat.w = Math.sqrt(Math.max(0, 1 - quat.x * quat.x - quat.y * quat.y - quat.z * quat.z))
    smoother.filterQuaternion(quat, t)
    gx.filter(0.1 * Math.sin(t), t)
    gy.filter(0.1 * Math.cos(t), t)
  })
  results.push([`live filters (${blendshapes.length} channels + quat + gaze)`, ms, 'every tracking frame in Live'])
}

// --- 4. the whole JavaScript slice of a live frame --------------------------
{
  const expression = new Float32Array(CHANNELS)
  const animator = new IdleAnimator()
  const filters = ARKIT_BLENDSHAPES.map(() => new OneEuroFilter(BLENDSHAPE_FILTER))
  const smoother = new QuaternionSmoother(POSE_FILTER)
  const quat = { x: 0, y: 0, z: 0, w: 1 }
  const ms = measure(IDLE_FRAMES, 7, (i) => {
    const t = i / 30
    const v = 0.5 + 0.5 * Math.sin(t)
    const idle = animator.update(1 / 30)
    for (let s = 0; s < filters.length; s++) expression[s] = filters[s].filter(v, t)
    expression[CHANNEL.eyeBlinkLeft] = Math.max(expression[CHANNEL.eyeBlinkLeft], idle.blinkLeft)
    expression[CHANNEL.browInnerUp] = Math.max(expression[CHANNEL.browInnerUp], idle.brow)
    quat.x = 0.02 * Math.sin(t)
    quat.y = 0.03 * Math.cos(t)
    quat.z = 0.01 * Math.sin(t * 0.7)
    quat.w = Math.sqrt(Math.max(0, 1 - quat.x * quat.x - quat.y * quat.y - quat.z * quat.z))
    smoother.filterQuaternion(quat, t)
  })
  results.push(['full JS slice of a live frame', ms, 'idle + filters + rig write, no rendering'])
}

// --- report -----------------------------------------------------------------
const BUDGET_24 = 1000 / 24
const BUDGET_60 = 1000 / 60

console.log(`\nPer-frame JavaScript cost — median of ${IDLE_FRAMES} iterations x 7 batches`)
console.log(`node ${process.version}, ${ARKIT_BLENDSHAPES.length}-channel expression\n`)
console.log('  work                                          native    6x CPU   share of 24 FPS frame')
console.log('  ' + '-'.repeat(86))
let total = 0
for (const [name, ms, note] of results) {
  const throttled = ms * 6
  const native = ms < 0.01 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(3)} ms`
  const share = ((throttled / BUDGET_24) * 100).toFixed(2)
  console.log(`  ${name.padEnd(44)} ${native.padStart(8)}  ${throttled.toFixed(3)} ms ${share.padStart(8)}%`)
  console.log(`      ${note}`)
  if (name.startsWith('full JS')) total = throttled
}
console.log('  ' + '-'.repeat(86))
console.log(`  frame budgets: ${BUDGET_24.toFixed(1)} ms at 24 FPS · ${BUDGET_60.toFixed(1)} ms at 60 FPS`)

console.log(`
Reading:
  * "6x CPU" is the native figure multiplied by six, standing in for DevTools' 6x
    throttling. Real throttling is not perfectly linear, so treat it as an estimate.
  * These numbers come from a desktop CPU. A mid-range Android runs single-threaded
    JavaScript roughly 3-5x slower than this machine, so the 6x column deliberately
    over-states the device by a small margin rather than under-stating it.
  * The app's own JavaScript occupies ${total.toFixed(2)} ms of a ${BUDGET_24.toFixed(1)} ms frame at 6x.
    That is the part that is measured. The rest of the frame — WebGL rasterisation,
    texture upload, MediaPipe's WASM inference and the compositor — is not measured
    here and cannot be measured without a browser. It is also the larger part.
  * Conclusion that the numbers do support: the animation/filtering layer is not the
    bottleneck, and halving the rig update rate in Lite (see AvatarInstance) costs
    nothing that matters.
  * Conclusion they do NOT support: any statement about actual FPS on a phone.

Per-frame numbers verified on this machine only. Re-run with: node tools/perf-probe.mjs
`)
