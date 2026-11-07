/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Owns: the largest file one cloud file read may carry, shared by the desktop's mirror and the
 * Worker that answers it.
 * Behaviour: D120 and docs/research/cloud-spike-2026-11-06.md. A `readBytes` answer is one base64
 * string inside one JSON value, and a Durable Object RPC value is limited to 32 MiB. On the live
 * Worker, 23 MiB succeeded and 24 MiB failed at that limit; 16 MiB is the dial we pick, with 7 MiB
 * of margin. Both sides ask this one question, so neither can drift.
 * Must handle: a file exactly at the limit passes; a larger one is refused before it is read.
 * Test first: a file at the limit is within it and one byte more is not.
 */

/** The largest file a mirror or a Worker read carries, in bytes. A dial: raise it with a new measurement. */
export const CLOUD_MIRROR_FILE_LIMIT_BYTES = 16 * 1024 * 1024;

/** True when a file of `size` bytes may be read through the mirror's byte route. */
export function withinCloudReadLimit(size: number): boolean {
	return Number.isFinite(size) && size >= 0 && size <= CLOUD_MIRROR_FILE_LIMIT_BYTES;
}

/** The one message a refused file carries, on both sides. */
export function cloudReadLimitMessage(size: number): string {
	return `The file is ${size} bytes, over the ${CLOUD_MIRROR_FILE_LIMIT_BYTES}-byte cloud read limit.`;
}
