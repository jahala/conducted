/**
 * @feature GIT-06 Pull the target branch
 * @feature CHAT-25 Show a workspace-relative file
 * Owns: the messages the Git panel shows after a pull or a failed continue note, the rule that
 * turns a path from a screen into a workspace-relative one, and the rule that strips refs and a
 * remote name from a branch. These are the pure parts of the git service.
 * Behaviour: services-map.md 3.6.4 (pull), ui-map.md 3.8 (Git panel).
 */
import { appError, err, ok, type Result } from "@conducted/shared";

/** Shown when a pull finds nothing to bring in. */
export const PULL_UP_TO_DATE_MESSAGE = "Pulled latest changes. You're up to date!";
/** Shown after a pull brings in new commits (services-map 3.6.4 step 4). */
export const PULLED_LATEST_MESSAGE = "Pulled latest changes.";

/** Shown when the "Branch continued" note or its chat message cannot be attached. */
export const CONTINUE_NOTE_FAILED_MESSAGE = "Failed to attach continue context";

/**
 * A path a screen sends, checked to stay inside the workspace folder. Absolute paths, `..`
 * segments and NUL bytes are refused, so `${cwd}/${path}` cannot reach another folder.
 */
export function workspaceRelativePath(path: string): Result<string> {
	const outside = (): Result<string> =>
		err(appError("path_outside_workspace", `"${path}" is not inside the workspace folder.`));
	if (path === "" || path.startsWith("/") || path.includes("\u0000")) return outside();
	if (path.split("/").some((part) => part === "..")) return outside();
	return ok(path);
}

/**
 * A branch name that can be fetched and used as a pull request base: refs and a leading remote
 * name are removed. The target as the user entered it is what the workspace stores.
 */
export function branchNameWithoutRemote(branch: string, remote: string): string {
	const heads = /^refs\/heads\/(.+)$/.exec(branch);
	if (heads?.[1] !== undefined) return heads[1];
	const remotes = /^refs\/remotes\/[^/]+\/(.+)$/.exec(branch);
	if (remotes?.[1] !== undefined) return remotes[1];
	if (remote.length > 0 && branch.startsWith(`${remote}/`)) return branch.slice(remote.length + 1);
	return branch;
}
