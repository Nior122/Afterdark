/**
 * Manual-mode mapping tests.
 *
 * Manual mode is the one path with no hardware in it: three controls compose into 52
 * channel values, and if a channel index is wrong or a value escapes 0..1 the avatar
 * contorts in a way no type-checker will ever notice. So the composition is asserted
 * here, under plain `node --test`, with no browser and no GPU.
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

const { ARKIT_BLENDSHAPES } = await import(pathToFileURL(resolve(root, 'src/avatar/arkit.ts')).href)
const { applyManualExpression, manualInput, resetManualInput, JOYSTICK_YAW_LIMIT } = await import(
  pathToFileURL(resolve(root, 'src/state/manualInput.ts')).href
)

/** Channel lookup, built the same way the app builds it (name -> index in the 52 set). */
const CHANNEL = Object.fromEntries(ARKIT_BLENDSHAPES.map((name, index) => [name, index]))
const channel = (name) => {
  const index = CHANNEL[name]
  assert.notEqual(index, undefined, `channel ${name} is not in the ARKit set`)
  return index
}

const expression = new Float32Array(ARKIT_BLENDSHAPES.length)
const evaluate = () => {
  applyManualExpression(expression, channel)
  return expression
}
const at = (name) => evaluate()[channel(name)]

test('every channel is filled and stays in range for every control', () => {
  const corners = [
    { mouthOpen: 0, smile: 0, frown: 0, pucker: 0 },
    { mouthOpen: 1, smile: 1, frown: 0, pucker: 1 },
    { mouthOpen: 1, smile: 0, frown: 1, pucker: 0 },
    { mouthOpen: 0.5, smile: 0.5, frown: 0.5, pucker: 0.5 },
  ]
  for (const corner of corners) {
    Object.assign(manualInput, corner)
    const out = evaluate()
    assert.equal(out.length, 52)
    for (let i = 0; i < out.length; i++) {
      assert.ok(Number.isFinite(out[i]), `channel ${ARKIT_BLENDSHAPES[i]} is not finite`)
      // ARKit blendshape weights are 0..1. A negative or >1 value is a bug in the
      // mapping, not a stylistic choice: the rig clamps, and the user sees a jump.
      assert.ok(
        out[i] >= 0 && out[i] <= 1,
        `channel ${ARKIT_BLENDSHAPES[i]} = ${out[i]} is outside 0..1`,
      )
    }
  }
})

test('an open mouth also separates the lips and travels the jaw forward', () => {
  resetManualInput()
  manualInput.mouthOpen = 1
  assert.ok(Math.abs(at('jawOpen') - 0.82) < 1e-6)
  assert.ok(Math.abs(at('mouthLowerDownLeft') - 0.22) < 1e-6)
  assert.ok(Math.abs(at('jawForward') - 0.08) < 1e-6)
  // The rest of the face must not move with it.
  assert.equal(at('mouthSmileLeft'), 0)
  assert.equal(at('browInnerUp'), 0)
})

test('smile lifts the cheeks and squints the eyes; frown does the opposite', () => {
  resetManualInput()
  manualInput.smile = 1
  assert.ok(Math.abs(at('mouthSmileLeft') - 0.78) < 1e-6)
  assert.ok(at('cheekSquintLeft') > 0.3)
  assert.ok(at('eyeSquintLeft') > 0.15)
  assert.equal(at('mouthFrownLeft'), 0)

  resetManualInput()
  manualInput.frown = 1
  assert.ok(Math.abs(at('mouthFrownLeft') - 0.55) < 1e-6)
  assert.ok(at('browInnerUp') > 0.25)
  assert.equal(at('mouthSmileLeft'), 0)
})

test('pucker closes the jaw rather than fighting it', () => {
  resetManualInput()
  manualInput.mouthOpen = 1
  manualInput.pucker = 1
  // 0.82 from the open slider minus 0.34 from the pucker, and never below zero.
  assert.ok(Math.abs(at('jawOpen') - 0.48) < 1e-6)
  assert.ok(at('mouthPucker') > 0.5)
  assert.ok(at('mouthFunnel') > 0.4)
})

test('gaze converts to the correct per-eye channel pairs', () => {
  resetManualInput()
  manualInput.splitEyes = false
  manualInput.gazeX = 1
  manualInput.gazeY = 1
  // Looking to the subject's right: In for the left eye, Out for the right.
  assert.ok(at('eyeLookInLeft') > 0.8)
  assert.equal(at('eyeLookOutLeft'), 0)
  assert.ok(at('eyeLookOutRight') > 0.8)
  assert.equal(at('eyeLookInRight'), 0)
  // Up for both.
  assert.ok(at('eyeLookUpLeft') > 0.7)
  assert.ok(at('eyeLookUpRight') > 0.7)
  assert.equal(at('eyeLookDownLeft'), 0)
})

test('split eyes drives each eye independently', () => {
  resetManualInput()
  manualInput.splitEyes = true
  manualInput.gazeXLeft = 1
  manualInput.gazeXRight = -1
  assert.ok(at('eyeLookInLeft') > 0.8)
  assert.ok(at('eyeLookOutLeft') === 0)
  // The right eye looks the other way.
  assert.ok(at('eyeLookInRight') > 0.8)
  assert.ok(at('eyeLookOutRight') === 0)
})

test('joystick limits stay inside a believable neck rotation', () => {
  // Sanity check on the shared constants: beyond ~45° of yaw an avatar driven by a
  // joystick starts to shear at the neck seam.
  assert.ok(JOYSTICK_YAW_LIMIT > 30 && JOYSTICK_YAW_LIMIT <= 45)
})

test('reset clears every control', () => {
  manualInput.headX = 0.7
  manualInput.headY = -0.4
  manualInput.mouthOpen = 1
  manualInput.smile = 1
  manualInput.frown = 1
  manualInput.pucker = 1
  manualInput.blink = 1
  manualInput.gazeX = 1
  manualInput.gazeY = -1
  manualInput.splitEyes = true
  manualInput.gazeXLeft = 1
  manualInput.gazeYRight = 1

  resetManualInput(false)

  for (const key of [
    'headX',
    'headY',
    'mouthOpen',
    'smile',
    'frown',
    'pucker',
    'blink',
    'gazeX',
    'gazeY',
    'gazeXLeft',
    'gazeYLeft',
    'gazeXRight',
    'gazeYRight',
  ]) {
    assert.equal(manualInput[key], 0, `${key} was not reset`)
  }
  assert.equal(manualInput.splitEyes, false)
})
