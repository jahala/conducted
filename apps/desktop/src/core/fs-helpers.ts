/**
 * @feature WS-10 Delete a workspace
 * @feature REV-10 Artifacts uploads
 * Owns: `trashIfPresent`, the one helper that moves an app data file to the Trash and treats a
 * file that is already gone as nothing to do. Workspace removal, chat removal and the
 * data-lifetime job all call it. Also `copyFileKeepingMode`, the one helper that copies a file
 * with `cp -p`; the included-files copy of a new workspace and the Artifacts upload call it.
 * Behaviour: services-map.md 3.10 (deleting a workspace removes its app data files) and 2.7 (data
 * lifetime). Files go to the Trash, never deleted outright (engineering.md, "Deleting user files").
 * Must handle: a missing file returns `ok(false)` and calls no trash; a trash failure is returned
 * as the error, never hidden. A `cp` that runs and fails is Err `file_copy_failed` with cp's
 * message, so a caller can tell it from a shell that could not start `cp` at all.
 * Test first: a missing path returns ok(false) and leaves the Trash untouched.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { FileSystem, Shell } from "../platform/platform.ts";

/** The error code of a `cp` that ran and failed. */
export const FILE_COPY_FAILED = "file_copy_failed";

/**
 * Copies `source` to `target` with `cp -p`, keeping the file's mode and times. It overwrites a
 * file at `target`, so a caller that must not replace one checks first.
 */
export async function copyFileKeepingMode(
	shell: Pick<Shell, "run">,
	source: string,
	target: string,
): Promise<Result<void>> {
	const parent = target.slice(0, target.lastIndexOf("/")) || "/";
	const copied = await shell.run({ program: "cp", args: ["-p", source, target], cwd: parent });
	if (!copied.ok) return copied;
	if (copied.value.exitCode !== 0) {
		return err(appError(FILE_COPY_FAILED, copied.value.stderr.trim() || "cp failed"));
	}
	return ok(undefined);
}

/**
 * Moves `path` to the Trash when it exists. The value says whether anything was trashed, so a
 * caller that counts removed files can count it.
 */
export async function trashIfPresent(
	fs: Pick<FileSystem, "exists" | "trash">,
	path: string,
): Promise<Result<boolean>> {
	const found = await fs.exists(path);
	if (!found.ok) return found;
	if (!found.value) return ok(false);
	const removed = await fs.trash(path);
	return removed.ok ? ok(true) : removed;
}
