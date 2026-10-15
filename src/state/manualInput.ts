/**
 * Manual control input.
 *
 * A deliberately non-reactive singleton. The joystick, the lip slider and the gaze pad
 * all write here on every pointer move; the render loop reads it on every frame. Both
 * of those happen at up to 60 Hz, so routing them through React state would mean a
 * reconciliation per frame for numbers that only ever feed a 3D transform.
 *
 * Each control's *visual* state (the thumb position) is also mutated directly on the
 * DOM by its component, so the panels never re-render while being dragged. React state
 * is only used to reflect the values when a gesture ends or a toggle changes.
 */

export interface ManualInput {
  /** Head yaw and pitch from the joystick, -1..1. */
  headX: number
  headY: number
  /** Gaze pad, -1..1. */
  gazeX: number
  gazeY: number
  /** Set while the blink button is held. */
  blink: number
  /** Lip controls. `smile` and `frown` are mutually exclusive halves of the smile axis. */
  mouthOpen: number
  smile: number
  frown: number
  pucker: number
  /** Independent eye control when Split is on. */
  splitEyes: boolean
  gazeXLeft: number
  gazeYLeft: number
  gazeXRight: number
  gazeYRight: number
}

export const manualInput: ManualInput = {
  headX: 0,
  headY: 0,
  gazeX: 0,
  gazeY: 0,
  blink: 0,
  mouthOpen: 0,
  smile: 0,
  frown: 0,
  pucker: 0,
  splitEyes: false,
  gazeXLeft: 0,
  gazeYLeft: 0,
  gazeXRight: 0,
  gazeYRight: 0,
}

/** Maximum head rotation the joystick can command, in degrees. */
export const JOYSTICK_YAW_LIMIT = 42
export const JOYSTICK_PITCH_LIMIT = 26

export const DEG = Math.PI / 180

/** Reset everything, e.g. when leaving manual mode. */
export function resetManualInput(keepSplit = true): void {
  manualInput.headX = 0
  manualInput.headY = 0
  manualInput.gazeX = 0
  manualInput.gazeY = 0
  manualInput.blink = 0
  manualInput.mouthOpen = 0
  manualInput.smile = 0
  manualInput.frown = 0
  manualInput.pucker = 0
  manualInput.gazeXLeft = 0
  manualInput.gazeYLeft = 0
  manualInput.gazeXRight = 0
  manualInput.gazeYRight = 0
  if (!keepSplit) manualInput.splitEyes = false
}

/**
 * Compose the manual input into the 52-channel expression array.
 *
 * The mapping from three intuitive controls (how open, how much smile, how much
 * pucker) onto eight ARKit mouth channels is the interesting part: a single slider has
 * to drive a believable combination, and doing it here keeps the panels dumb.
 */
export function applyManualExpression(expression: Float32Array, channel: (name: string) => number): void {
  const { mouthOpen, smile, frown, pucker } = manualInput

  expression.fill(0)

  // --- jaw / mouth opening ------------------------------------------------
  // Opening the jaw also separates the lips, which in ARKit terms is jawOpen plus
  // lifting the upper lip and dropping the lower one. Without those the mouth looks
  // painted shut even with the jaw down.
  expression[channel('jawOpen')] = mouthOpen * 0.82
  expression[channel('mouthLowerDownLeft')] = mouthOpen * 0.22
  expression[channel('mouthLowerDownRight')] = mouthOpen * 0.22
  expression[channel('mouthUpperUpLeft')] = mouthOpen * 0.1
  expression[channel('mouthUpperUpRight')] = mouthOpen * 0.1
  // Slight forward jaw travel, which is what actually happens when a mouth opens wide.
  expression[channel('jawForward')] = mouthOpen * 0.08

  // --- smile --------------------------------------------------------------
  // A real smile is not just mouthSmile: the corners rise and pull back, the cheeks
  // lift, and the lower eyelids tighten (the "Duchenne" cue). Including the cheek and
  // squint channels is what separates a smile from a smirk.
  const s = smile
  expression[channel('mouthSmileLeft')] = s * 0.78
  expression[channel('mouthSmileRight')] = s * 0.78
  expression[channel('mouthDimpleLeft')] = s * 0.3
  expression[channel('mouthDimpleRight')] = s * 0.3
  expression[channel('cheekSquintLeft')] = s * 0.34
  expression[channel('cheekSquintRight')] = s * 0.34
  expression[channel('eyeSquintLeft')] = s * 0.2
  expression[channel('eyeSquintRight')] = s * 0.2

  // --- frown --------------------------------------------------------------
  // The other half of the smile axis. ARKit separates the two directions, so pulling the
  // control left of centre crosses over from a smile to a frown rather than clamping at
  // neutral. `browInnerUp` is what makes a frown read as sadness instead of a smirk.
  const f = frown
  expression[channel('mouthFrownLeft')] = f * 0.55
  expression[channel('mouthFrownRight')] = f * 0.55
  expression[channel('browInnerUp')] = f * 0.3
  // `max`, not assignment: pucker also presses the lips, and taking the stronger of the
  // two avoids one control silently cancelling the other.
  expression[channel('mouthPressLeft')] = Math.max(expression[channel('mouthPressLeft')], f * 0.2)
  expression[channel('mouthPressRight')] = Math.max(expression[channel('mouthPressRight')], f * 0.2)

  // --- pucker -------------------------------------------------------------
  // Pucker is mouthPucker plus a funnel shape and a little jaw closure; a pure
  // mouthPucker on its own reads as a grimace.
  const p = pucker
  expression[channel('mouthPucker')] = p * 0.62
  expression[channel('mouthFunnel')] = p * 0.44
  expression[channel('mouthClose')] = p * 0.3
  expression[channel('mouthPressLeft')] = p * 0.18
  expression[channel('mouthPressRight')] = p * 0.18
  // Pucker and jawOpen fight each other; closing the jaw in proportion is what makes
  // a "kiss" face read correctly when the open slider is also up.
  expression[channel('jawOpen')] = Math.max(0, expression[channel('jawOpen')] - p * 0.34)

  // --- eye look -----------------------------------------------------------
  const { gazeX, gazeY, splitEyes, gazeXLeft, gazeYLeft, gazeXRight, gazeYRight } = manualInput
  const toInOut = (x: number, isLeft: boolean) => {
    // Convert "toward the subject's right" (+x) into MediaPipe's per-eye channel pairs.
    // Looking to the subject's right is In for the left eye, Out for the right.
    const towardRight = Math.max(0, x)
    const towardLeft = Math.max(0, -x)
    return isLeft
      ? { in: towardRight, out: towardLeft }
      : { in: towardLeft, out: towardRight }
  }
  const upDown = (y: number) => ({ up: Math.max(0, y), down: Math.max(0, -y) })

  const writeEye = (x: number, y: number, left: boolean) => {
    const suffix = left ? 'Left' : 'Right'
    const io = toInOut(x, left)
    const ud = upDown(y)
    expression[channel(`eyeLookIn${suffix}`)] = io.in * 0.85
    expression[channel(`eyeLookOut${suffix}`)] = io.out * 0.85
    expression[channel(`eyeLookUp${suffix}`)] = ud.up * 0.75
    expression[channel(`eyeLookDown${suffix}`)] = ud.down * 0.75
  }

  if (splitEyes) {
    writeEye(gazeXLeft, gazeYLeft, true)
    writeEye(gazeXRight, gazeYRight, false)
  } else {
    writeEye(gazeX, gazeY, true)
    writeEye(gazeX, gazeY, false)
  }

  // --- blink --------------------------------------------------------------
  // Blink and wide are opposites; adding a touch of eyeWide during the open phase of
  // a manual blink makes the eye look alert rather than just open.
  const blink = manualInput.blink
  expression[channel('eyeBlinkLeft')] = blink
  expression[channel('eyeBlinkRight')] = blink
  if (blink < 0.15) {
    expression[channel('eyeWideLeft')] = (1 - blink / 0.15) * 0.06
    expression[channel('eyeWideRight')] = (1 - blink / 0.15) * 0.06
  }

  // Gentle brow engagement on a smile: real smiles lift the outer brow slightly.
  expression[channel('browOuterUpLeft')] = s * 0.12
  expression[channel('browOuterUpRight')] = s * 0.12
}
