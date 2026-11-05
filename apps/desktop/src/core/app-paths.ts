/**
 * @feature DATA-02 Where the app keeps its own files
 * Owns: the folder layout under the app data folder, as pure functions of `Platform.fs.paths`, so
 * every service and the data-lifetime job agree on where drafts, attachments and logs live.
 * Behaviour: services-map.md 5A.6.2 (draft staging folder, sweep of old drafts), 5A.1.2 (setup log).
 * Must handle: ids and names that contain path separators (callers pass ids, never user text).
 * Our design choice: drafts are JSON files, one per chat, because migration 0001 has no drafts
 * table. A new table would need a new migration; files need none.
 * Test first: draftFile joins appData, "drafts" and "<sessionId>.json" with single slashes.
 */
import type { FileSystem } from "../platform/platform.ts";

export type AppPaths = FileSystem["paths"];

const join = (...parts: string[]): string =>
	parts
		.map((part, index) => (index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, "")))
		.join("/");

/** Folder with one `<sessionId>.json` per chat that has an unsent draft. */
export const draftsDir = (paths: AppPaths): string => join(paths.appData, "drafts");

export const draftFile = (paths: AppPaths, sessionId: string): string =>
	join(draftsDir(paths), `${sessionId}.json`);

/** Staging folder for attachments that are not yet part of a sent message. */
export const draftAttachmentsDir = (paths: AppPaths, sessionId: string): string =>
	join(paths.appData, "draft-attachments", sessionId);

/** Where the setup script's output is written for one workspace. */
export const setupLogFile = (paths: AppPaths, workspaceId: string): string =>
	join(paths.appData, "setup-logs", `${workspaceId}.log`);

/** Folder with the helper scripts shipped inside the app (checkpointer.sh and friends). */
export const binDir = (paths: AppPaths): string => join(paths.resources, "bin");

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

/** Folder with the zsh files that make a terminal report its running program (RUN-09). */
export const zshIntegrationDir = (paths: AppPaths): string =>
	join(paths.appData, "terminal-shell-integration", "zsh");

/** The last changed-file list of one workspace, so a restart can paint at once (DATA-07). */
export const changesCacheFile = (paths: AppPaths, workspaceId: string): string =>
	join(paths.appData, "git-cache", "changes", `${workspaceId}.json`);

/** The last pull request information of one workspace (DATA-07). */
export const prInfoCacheFile = (paths: AppPaths, workspaceId: string): string =>
	join(paths.appData, "git-cache", "pr-info", `${workspaceId}.json`);
