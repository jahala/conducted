/**
 * @feature WS-10 Delete a workspace
 * Owns: `trashIfPresent`, the one helper that moves an app data file to the Trash and treats a
 * file that is already gone as nothing to do. Workspace removal, chat removal and the
 * data-lifetime job all call it.
 * Behaviour: services-map.md 3.10 (deleting a workspace removes its app data files) and 2.7 (data
 * lifetime). Files go to the Trash, never deleted outright (engineering.md, "Deleting user files").
 * Must handle: a missing file returns `ok(false)` and calls no trash; a trash failure is returned
 * as the error, never hidden.
 * Test first: a missing path returns ok(false) and leaves the Trash untouched.
 */
import { ok, type Result } from "@conducted/shared";
import type { FileSystem } from "../platform/platform.ts";

/**
 * Moves `path` to the Trash when it exists. The value says whether anything was trashed, so a
 * caller that counts removed files can count it.
 */
export async function trashIfPresent(
	fs: Pick<FileSystem, "exists" | "trash">,
	path: string,
): Promise<Result<boolean>> {
	if (!(await fs.exists(path))) return ok(false);
	const removed = await fs.trash(path);
	return removed.ok ? ok(true) : removed;
}
