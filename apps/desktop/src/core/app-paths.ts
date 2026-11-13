/**
 * @feature DATA-02 Where the app keeps its own files
 * @feature NAV-16 Draft markers on the Create row and on workspaces
 * Owns: the folder layout under the app data folder, as pure functions of `Platform.fs.paths`, so
 * every service and the data-lifetime job agree on where drafts, attachments and logs live, and the
 * reserved composer key of the Create page's draft.
 * A folder that only one feature uses may be named in that feature's file, joined with
 * `appDataPath`: the git caches (services/git-cache.ts) and the zsh shim
 * (services/shell-integration.ts).
 * Behaviour: services-map.md 5A.6.2 (draft staging folder, sweep of old drafts), 5A.1.2 (setup log)
 * and 5A.4.7 (saved terminal scrollback files).
 * Callers pass ids from the id source, never user text, so no name here holds a path separator.
 * The builders do not check that; a caller that passed user text would escape the folder. A path
 * read back from storage is checked with `isInsideFolder` before anything deletes it.
 * Our design choice: drafts are JSON files, one per chat, because migration 0001 has no drafts
 * table. A new table would need a new migration; files need none.
 * Test first: draftFile joins appData, "drafts" and "<sessionId>.json" with single slashes.
 */
import { trimLeadingSlashes, trimTrailingSlashes } from "@conducted/shared";
import type { FileSystem } from "../platform/platform.ts";

export type AppPaths = FileSystem["paths"];

const join = (...parts: string[]): string =>
	parts
		.map((part, index) =>
			index === 0 ? trimTrailingSlashes(part) : trimLeadingSlashes(trimTrailingSlashes(part)),
		)
		.join("/");

/**
 * True when `path` names something inside `folder`, never the folder itself. Both are absolute,
 * with `/` separators. An empty, `.` or `..` segment or a NUL byte makes the answer false, so a
 * path cannot climb out of the folder by how it is spelled.
 */
export const isInsideFolder = (folder: string, path: string): boolean => {
	const base = trimTrailingSlashes(folder);
	if (base.length === 0 || path.includes("\u0000") || !path.startsWith(`${base}/`)) return false;
	return path
		.slice(base.length + 1)
		.split("/")
		.every((part) => part !== "" && part !== "." && part !== "..");
};

/** Folder with one `<sessionId>.json` per chat that has an unsent draft. */
export const draftsDir = (paths: AppPaths): string => join(paths.appData, "drafts");

/**
 * The composer key of the Create page's draft (NAV-16). It is stored in the drafts folder like a chat
 * draft, but no chat has this id, so the data-lifetime job keeps it until it expires.
 */
export const NEW_WORKSPACE_DRAFT_ID = "new-workspace";

export const draftFile = (paths: AppPaths, sessionId: string): string =>
	join(draftsDir(paths), `${sessionId}.json`);

/** Staging folder for attachments that are not yet part of a sent message. */
export const draftAttachmentsDir = (paths: AppPaths, sessionId: string): string =>
	join(paths.appData, "draft-attachments", sessionId);

/** Folder holding one staging folder per chat with draft attachments. */
export const draftAttachmentsRoot = (paths: AppPaths): string =>
	join(paths.appData, "draft-attachments");

/** Folder where the Rust shell writes the saved scrollback of ended terminals (PLAT-08). */
export const terminalHistoryDir = (paths: AppPaths): string =>
	join(paths.appData, "terminal-history");

/** The saved scrollback file of one terminal. */
export const terminalHistoryFile = (paths: AppPaths, terminalId: string): string =>
	join(terminalHistoryDir(paths), `${terminalId}.bin`);

/** Where the setup script's output is written for one workspace. */
export const setupLogFile = (paths: AppPaths, workspaceId: string): string =>
	join(paths.appData, "setup-logs", `${workspaceId}.log`);

/** Folder with the helper scripts shipped inside the app (checkpointer.sh and friends). */
export const binDir = (paths: AppPaths): string => join(paths.resources, "bin");

/**
 * The app's bin folder in the data folder: a copy of the bundled scripts (PLAT-34) and the links
 * the program manager points at the managed claude, codex, gh and watchexec (PLAT-28, PLAT-35). It
 * comes first on PATH for terminals, scripts and git commands. Rust's `ProgramDirs::bin` names the
 * same folder.
 */
export const programsBinDir = (paths: AppPaths): string => join(paths.appData, "bin");

export const checkpointerScript = (paths: AppPaths): string =>
	join(binDir(paths), "checkpointer.sh");
export const spotlighterScript = (paths: AppPaths): string => join(binDir(paths), "spotlighter.sh");
export const gitBusyCheckScript = (paths: AppPaths): string =>
	join(binDir(paths), "git-busy-check.sh");

/** The `.conducted` folder inside a repository or workspace folder. */
export const conductedDir = (folder: string): string => join(folder, ".conducted");
export const sharedSettingsFile = (folder: string): string =>
	join(conductedDir(folder), "settings.toml");
export const localSettingsFile = (folder: string): string =>
	join(conductedDir(folder), "settings.local.toml");

/** The user-level settings file, `~/.conducted/settings.toml`. */
export const userSettingsFile = (paths: AppPaths): string =>
	join(paths.home, ".conducted", "settings.toml");

/** Folder inside a workspace where files shared with the agent live (git-excluded). */
export const contextDir = (workspacePath: string): string => join(workspacePath, ".context");

/** Which files of a workspace's diff the user ticked as "Viewed" (one JSON file per workspace). */
export const viewedFilesFile = (paths: AppPaths, workspaceId: string): string =>
	join(paths.appData, "viewed-files", `${workspaceId}.json`);

/** A path under the app data folder, for a feature that names its own folders in its own file. */
export const appDataPath = (paths: AppPaths, ...parts: string[]): string =>
	join(paths.appData, ...parts);

/** The root of Cursor's SDK run stores. The Rust launcher creates it (sidecar.rs CURSOR_STORE_FOLDER). */
export const CURSOR_STORE_FOLDER = "cursor-sdk-store";

/**
 * The folder of one workspace's Cursor run store: the first 16 hex digits of the SHA-256 of the
 * workspace path, under CURSOR_STORE_FOLDER. The sidecar names the folder by the same rule
 * (cursor-runner.ts `cursorStoreFolder`); both tests check the same path, so a change to one fails.
 */
export async function cursorStoreFolder(paths: AppPaths, workspacePath: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(workspacePath));
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
	return join(paths.appData, CURSOR_STORE_FOLDER, hex.slice(0, 16));
}
