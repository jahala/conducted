/**
 * @feature APP-18 Chat history from Conductor: how disk space reads (D132)
 * Owns: `formatSpace`, a disk's space as the user reads it, and `noSpaceMessage`, the refusal when
 * the import from Conductor needs more free space than the disk has. The import's service refuses
 * with it and the import's dialog shows it, so the two say the same words.
 * Behaviour: docs/plans/migrate-from-conductor.md ("Chat history", disk space).
 * Our design choice: decimal GB with one decimal, as Finder shows a disk, whole MB below 1 GB,
 * and at least 1 MB for any space at all, so a small import never reads as "0 MB".
 * Test first: conductor-import.container.test.ts, "an import with too little free space refuses
 * before writing anything".
 */

/** Bytes as macOS shows a disk's space. */
export function formatSpace(bytes: number): string {
	if (bytes <= 0) return "0 MB";
	if (bytes < 1e9) return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
	return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** The refusal when the disk does not have the space the import needs, with both numbers. */
export const noSpaceMessage = (space: { neededBytes: number; freeBytes: number }): string =>
	`There is not enough free disk space. The import needs ${formatSpace(space.neededBytes)} free, and ${formatSpace(space.freeBytes)} is free. Free up space, then try again.`;
