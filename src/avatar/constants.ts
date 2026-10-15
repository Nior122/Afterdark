/**
 * Shared numeric constants for the avatar layer.
 *
 * These live in their own module on purpose. `loader.ts` pulls in three.js, GLTFLoader,
 * Draco, KTX2 and meshopt; anything that imported a constant from it ended up dragging
 * the entire loading stack into a bundle that never loads a model. The photo-texturing
 * module was importing exactly one number from there, which is how a 40-line
 * file-to-texture path acquired a 700 KB dependency.
 */

/** Real-world height of an adult head, chin to crown. Every rig is normalised to this. */
export const HEAD_HEIGHT_METRES = 0.235

