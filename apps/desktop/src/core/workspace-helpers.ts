/**
 * @feature WS-01 Workspace service: create, set up, archive, unarchive, delete
 * @feature WS-02 Create from a branch, PR or issue
 * Owns: the new-chat fallbacks, the setup and backlog messages, the rules for a safe ref name, the
 * remote name and the linked folders, and the branch prefix rule. The workspace service and the
 * screens share them.
 * Behaviour: services-map.md 3.1 (remotes, DATA-09), 5A.1.2 (branch prefix), ui-map.md 3.9 (create
 * form), 3.7 (setup tab).
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type { RepoConfig } from "./model.ts";

/** A new chat's model when the setting is empty: the agent's own default. */
export const NEW_CHAT_MODEL_FALLBACK = "default";

/**
 * A new chat's effort when the setting is empty ("Model default"). A chat config needs a level, so
 * it opens at "high" until the protocol can say "the model's own default".
 */
export const NEW_CHAT_EFFORT_FALLBACK = "high";

/** The words for a setup script that failed (inventory:toast main row 463). */
export const SETUP_FAILED_MESSAGE = "Setup script failed. Check the setup tab for logs.";

/** Shown when a saved setup transcript cannot be read (ui-map.md 3.7). */
export const SETUP_LOG_MISSING_MESSAGE = "No logs were recorded, or they have expired.";

/** Shown when a backlog workspace is started but its repository is gone (ui-map 3.9). */
export const NO_READY_REPOSITORY_MESSAGE = "No ready repository. Pick one to start this workspace.";

/** The branch prefix Conductor's Git setting chooses (ui-map 6): GitHub login, custom text, or none. */
export function branchPrefixFor(type: string, custom: string, githubLogin: string | null): string {
	if (type === "none") return "";
	if (type === "custom") return custom;
	if (type === "github_username") {
		return githubLogin === null || githubLogin === "" ? "" : `${githubLogin}/`;
	}
	return "";
}

/**
 * True when git accepts `name` as a branch name (or a remote name) and no git or gh command can
 * read it as an option. A name that starts with `-` is refused for that reason.
 */
export function isSafeRefName(name: string): boolean {
	if (name === "" || name === "@" || name.startsWith("-") || name.startsWith("/")) return false;
	if (name.endsWith("/") || name.endsWith(".") || name.includes("..") || name.includes("//")) {
		return false;
	}
	if (name.includes("@{")) return false;
	for (const char of name) {
		const code = char.charCodeAt(0);
		if (code <= 0x20 || code === 0x7f || "~^:?*[\\".includes(char)) return false;
	}
	return !name.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"));
}

/** The message for a branch, prefix or remote name that git would refuse. */
export const invalidRefNameError = (name: string): AppError =>
	appError(
		"workspace_branch_invalid",
		`"${name}" can't be used as a Git branch or remote name. Check the branch prefix in settings.`,
	);

/** The remote a repository uses when its config names none (ui-map 6 Git, services-map 3.1). */
export const DEFAULT_REMOTE_NAME = "origin";

/**
 * The remote name the repository config picks, or `DEFAULT_REMOTE_NAME` when it names none. One
 * rule for creation and for every git and pull request caller (DATA-09). A configured name git
 * could read as an option is an error, never passed to a command.
 */
export function remoteNameFromConfig(config: RepoConfig): Result<string> {
	const name = config.remoteName?.trim() ?? "";
	if (name === "") return ok(DEFAULT_REMOTE_NAME);
	return isSafeRefName(name) ? ok(name) : err(invalidRefNameError(name));
}

/**
 * The folders a workspace may link, as one clean list: empty entries and duplicates are dropped,
 * and a path that is not absolute is refused because the agents and the sidecar need absolute
 * paths. A trailing slash is removed, except on the root folder.
 */
export function normaliseLinkedPaths(paths: readonly string[]): Result<string[]> {
	const cleaned: string[] = [];
	const seen = new Set<string>();
	for (const raw of paths) {
		const trimmed = raw.trim();
		if (trimmed === "") continue;
		if (!trimmed.startsWith("/")) {
			return err(
				appError(
					"linked_path_invalid",
					`"${trimmed}" is not an absolute folder path, so it can't be linked.`,
				),
			);
		}
		const normalised = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
		if (seen.has(normalised)) continue;
		seen.add(normalised);
		cleaned.push(normalised);
	}
	return ok(cleaned);
}
