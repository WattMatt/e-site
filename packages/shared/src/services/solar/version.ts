/**
 * Engine version (spec §1.3): semver, bumped on ANY formula change. Every stored run records it.
 * `engine-golden.test.ts` pins exact outputs of a fixed case to this version: when a formula
 * changes those numbers move, and the test tells you to bump this constant with the new values.
 */
export const ENGINE_VERSION = '0.1.0'
