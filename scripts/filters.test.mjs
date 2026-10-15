/**
 * Unit tests for the One Euro filter and the quaternion smoother.
 *
 * These run under plain `node --test` with no bundler, which is only possible
 * because oneEuroFilter.ts imports nothing. The TS is loaded via a tiny
 * type-stripping loader below (Node 22 can run TS directly with --experimental-strip-types).
 *
 * Run: node --test scripts/*.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { register } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Node 22.18+ strips types natively; older 22.x needs the flag. Fail loudly if not.
register(pathToFileURL(resolve(root, 'scripts/ts-loader.mjs')).href)
const { OneEuroFilter, OneEuroBank, QuaternionSmoother, POSE_FILTER, BLENDSHAPE_FILTER } = await import(
  pathToFileURL(resolve(root, 'src/tracking/oneEuroFilter.ts')).href
)

const DEG = Math.PI / 180

test('first sample passes straight through', () => {
  const f = new OneEuroFilter()
  assert.equal(f.filter(5, 0), 5)
  assert.equal(f.filter(5, 0.016), 5)
})

test('reduces jitter on a still signal by a large factor', () => {
  const filter = new OneEuroFilter({ minCutoff: 1, beta: 0.02 })
  // 2 seconds of a constant signal with +/-0.05 rad of sensor noise.
  let rawSum = 0
  let outSum = 0
  let prevOut = null
  const n = 120
  for (let i = 0; i < n; i++) {
    const t = i / 60
    const noise = Math.sin(i * 2.7) * 0.05
    const out = filter.filter(noise, t)
    if (prevOut !== null && i > 10) {
      rawSum += Math.abs(noise - Math.sin((i - 1) * 2.7) * 0.05)
      outSum += Math.abs(out - prevOut)
    }
    prevOut = out
  }
  assert.ok(outSum < rawSum * 0.35, `jitter not reduced enough: out=${outSum.toFixed(4)} raw=${rawSum.toFixed(4)}`)
})

test('tracks a realistic fast turn within the latency budget', () => {
  // A 0.6 rad (34 deg) turn completed over 200 ms, the fastest believable head
  // motion for a selfie. Total tracking error must stay under the perceptual
  // threshold, and the filter must never overshoot (a low-pass never should).
  const filter = new OneEuroFilter()
  const dt = 1 / 60
  let errSum = 0
  let n = 0
  let prev = -Infinity
  let maxOvershoot = 0
  for (let i = 0; i < 60; i++) {
    const t = i * dt
    const truth = 0.6 / (1 + Math.exp(-(t - 0.2) * 40))
    const out = filter.filter(truth, t)
    assert.ok(out >= prev - 1e-9, 'filter output must be monotonic for a monotonic input')
    prev = out
    if (t > 0.1 && t < 0.42) {
      errSum += Math.abs(out - truth)
      n++
    }
    maxOvershoot = Math.max(maxOvershoot, out - 0.6)
  }
  const meanErr = errSum / n
  assert.ok(meanErr < 0.06, `mean tracking error too high: ${(meanErr * 1000).toFixed(1)} mrad`)
  assert.ok(maxOvershoot < 0.01, `overshot the target by ${maxOvershoot.toFixed(4)} rad`)
})

test('a step settles inside 250 ms (bounded worst case)', () => {
  const filter = new OneEuroFilter()
  const dt = 1 / 60
  for (let i = 0; i < 60; i++) filter.filter(0, i * dt)
  let out = 0
  let frames = 0
  for (let i = 60; i < 90; i++) {
    out = filter.filter(0.5, i * dt)
    frames++
    if (out > 0.5 * 0.9) break
  }
  assert.ok(frames * dt < 0.25, `took ${(frames * dt * 1000).toFixed(0)} ms to reach 90% of a step`)
})

test('tuned presets stay inside the published performance envelope', () => {
  // Guards against someone "improving" the constants and silently regressing feel.
  assert.deepEqual(POSE_FILTER, { minCutoff: 1.5, beta: 2.5, dCutoff: 3.0 })
  assert.deepEqual(BLENDSHAPE_FILTER, { minCutoff: 1.2, beta: 3.0, dCutoff: 3.0 })
})

test('adaptive cutoff: faster motion is filtered less', () => {
  const slow = new OneEuroFilter({ minCutoff: 1, beta: 0.5 })
  const fast = new OneEuroFilter({ minCutoff: 1, beta: 0.5 })
  const dt = 1 / 60
  for (let i = 0; i < 30; i++) {
    slow.filter(Math.sin(i * 0.05) * 0.02, i * dt) // near-still
    fast.filter(Math.sin(i * 0.9) * 0.4 + i * 0.01, i * dt) // moving fast
  }
  // The fast filter's residual error on a step should be smaller than the slow one's.
  const a = Math.abs(slow.filter(1, 30 * dt) - 1)
  const b = Math.abs(fast.filter(1, 30 * dt) - 1)
  assert.ok(b <= a, `expected fast-motion lag (${b.toFixed(4)}) <= slow-motion lag (${a.toFixed(4)})`)
})

test('survives duplicate, out-of-order and non-finite timestamps', () => {
  const f = new OneEuroFilter()
  f.filter(0, 1)
  assert.ok(Number.isFinite(f.filter(1, 1))) // same timestamp
  assert.ok(Number.isFinite(f.filter(2, 0.5))) // going backwards
  assert.ok(Number.isFinite(f.filter(NaN, 0.6))) // NaN sample returns last good value
  const out = f.filter(3, 5) // huge dt gap
  assert.ok(Number.isFinite(out) && out > 0 && out <= 3)
})

test('OneEuroBank filters many channels against one timebase', () => {
  const bank = new OneEuroBank(3, { minCutoff: 1, beta: 0.02 })
  const input = new Float32Array([0.5, -0.25, 0])
  const out = new Float32Array(3)
  bank.filterInto(input, out, 0)
  assert.deepEqual([...out], [0.5, -0.25, 0])
  for (let i = 1; i < 30; i++) bank.filterInto(input, out, i / 60)
  assert.ok(Math.abs(out[0] - 0.5) < 1e-3, 'constant channel should converge to the input')
})

test('QuaternionSmoother returns unit quaternions and rejects the long way round', () => {
  const s = new QuaternionSmoother({ minCutoff: 4, beta: 0.2 })
  const dt = 1 / 60
  // Rotate about Y from 0 to 60 degrees.
  let q = { x: 0, y: 0, z: 0, w: 1 }
  for (let i = 0; i < 90; i++) {
    const a = (i / 89) * 60 * DEG
    q = { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }
    const out = s.filterQuaternion(q, i * dt)
    const norm = Math.hypot(out.x, out.y, out.z, out.w)
    assert.ok(Math.abs(norm - 1) < 1e-6, `not unit length: ${norm}`)
    // y must stay positive — a sign flip here would mean the head snapped around.
    assert.ok(out.y >= -1e-6, `unexpected sign flip, y=${out.y}`)
  }
  // And it should have largely caught up to the true 60 degrees.
  const finalAngle = 2 * Math.atan2(Math.abs(q.y), q.w)
  const outAngle = 2 * Math.atan2(Math.abs(s.filterQuaternion(q, 90 * dt).y), s.filterQuaternion(q, 90 * dt).w)
  assert.ok(Math.abs(outAngle - finalAngle) < 6 * DEG, `lag too large: ${((finalAngle - outAngle) / DEG).toFixed(1)}°`)
})

test('QuaternionSmoother handles the identity / zero-rotation case', () => {
  const s = new QuaternionSmoother()
  const out = s.filterQuaternion({ x: 0, y: 0, z: 0, w: 1 }, 0)
  assert.deepEqual([out.x, out.y, out.z, out.w], [0, 0, 0, 1])
})

test('QuaternionSmoother handles a large yaw (past 90 degrees) without warping', () => {
  const s = new QuaternionSmoother({ minCutoff: 6, beta: 0.3 })
  const dt = 1 / 60
  let last = null
  for (let i = 0; i < 120; i++) {
    const a = (i / 119) * 130 * DEG // beyond the 90-degree acceptance criterion
    const q = { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }
    last = s.filterQuaternion(q, i * dt)
  }
  const outAngle = 2 * Math.atan2(Math.abs(last.y), Math.abs(last.w))
  assert.ok(outAngle > 115 * DEG, `should follow a 130° turn closely, got ${(outAngle / DEG).toFixed(1)}°`)
})
