/**
 * @feature WS-01 Workspace service: create, set up, archive, unarchive, delete; WS-10 Delete a
 * workspace
 * @feature WS-02 Create from a branch, PR or issue
 * @feature CHAT-21 Fork a chat to a new workspace
 * @feature WS-04 Rename the placeholder branch after the first message
 * @feature WS-07 Linked workspaces and extra folders
 * @feature WS-11 Backlog workspaces: save now, start later
 * @feature PR-10 Link a pull request by URL or number: storing the linked pull request on the
 * workspace.
 * Owns: the list of workspaces and their lifecycle as far as it is built: creating a worktree and
 * its first chat from the default branch, an existing local branch, a pull request or an issue,
 * creating one at a commit another feature resolved (CHAT-21), running the setup script,
 * archiving a workspace, unarchiving one, deleting one or all of a
 * repository's workspaces, storing the intended target branch (GIT-08), saving a renamed branch
 * (GIT-09), renaming the placeholder branch from a suggested name after the first message, saving
 * a workspace's linked folders (WS-07), and saving, starting and removing backlog workspaces
 * (WS-11), and storing a linked pull request (PR-10).
 * Behaviour: frontend.md 6 (creation, naming, setup, archive), services-map.md 2.3.1 (workspace
 * delete), 2.4.1 (state machine), 3.1 (create), 3.2 and 5A.1.2 (setup), 3.10 (archive, unarchive
 * and delete), 3.11 (branch rename, the first-message rename and the stored target branch),
 * 3.16 (archive refs), ui-map.md 3.9, 3.1 and 6 Git.
 * Must handle: state moves initializing -> ready (or failed), each guarded so a stale step cannot
 * move a workspace that already changed; the directory name is a unique place name for the repo
 * and the branch is prefix + name, suffixed -v1, -v2 when taken; a branch, prefix or remote name
 * that git could read as an option or refuses is rejected before any git call; creation fetches
 * the base, falls back to the cached remote ref offline and tells the user; copying the repo's
 * files (for example `.env`) is part of creation and never overwrites a file already in the
 * worktree; setup runs in a terminal with the workspace variables and its result decides ready or
 * failed (a failed setup keeps the workspace, with a retry; a second retry while one runs is
 * ignored); creations run one at a time; a repository config that cannot be read for the remote
 * name stops creation with its error, while a failed read of the file list or the default config
 * is shown as a warning; the file commands reach a folder outside `~/conducted` only once it is
 * registered (PLAT-02), so a start registers the workspaces folder and every saved workspace's
 * folder, and a create or unarchive registers the workspaces folder before it looks in it.
 * Built now (WS-04): the first-message rename runs only when `auto_rename_new_branches` is on and
 * the workspace still has its placeholder branch. It is skipped when a pull request is linked,
 * the branch has already changed (in the row or in git), the suggestion is empty or failed, or
 * no suggester is wired. The suggestion is combined with the branch prefix, a name clash takes
 * the next `-vN` suffix, and `auto_rename_workspace_on_branch_name_set` renames the workspace to
 * the new branch name unless the user set a name.
 * Built now (WS-10): delete a workspace by id and every workspace of a repository. It cancels the
 * workspace's chats, stops its processes, removes its worktree and archive ref, moves its setup log,
 * viewed-files file, Cursor run store and git cache files (DATA-07) to the Trash, deletes its chats with their
 * attachment files, then deletes the row and forgets it in the store. A repository removal stops
 * every workspace's processes first.
 * Built now (WS-05): archive. It refuses while a chat is running, stops a setup or run process
 * that is still running and clears the workspace's run state, cancels the remaining chats, saves
 * the archive snapshot, reads the branch git reports (a detached HEAD or a failed read stops the
 * archive), pins HEAD under the archive ref, runs the archive script, removes the worktree,
 * optionally deletes the branch (never the default branch; a failed delete is recorded as a
 * warning because the archive already finished), and records the archive commit and time.
 * Archive-on-merge is refused for a corrupted workspace and ignores a merged PR that is not the
 * workspace's own. The stack rule for archive-on-merge, the open-PR check, the write-access
 * refusal, the screen's discard confirmation and the screen that shows the branch-delete warning
 * are not built; the service refuses a busy checkout and accepts `discardGitOperationState` from
 * a caller that has already asked.
 * Built now (WS-06): unarchive. It classifies the branch as gone, taken, moved or fine, re-adds
 * the worktree (creating a missing branch from the archive commit), restores the archive
 * checkpoint, and sets the branch, folder, path and ready state while clearing the archive time
 * and moving the workspace's recent activity to the restore time (services-map.md 3.10).
 * A branch open in another worktree or moved since the archive returns `needsBranchName` and
 * changes nothing. A checkpoint restore that fails only sets `uncommittedChangesLost`. A worktree
 * that cannot be restored is rolled back: the re-added folder and a branch the call created are
 * removed and the state goes back to archived. A rollback step that fails is named in the
 * returned error, and a workspace that cannot go back to archived stays initializing in the store.
 * Built now (WS-07): linked paths. An absolute folder path is stored for each linked workspace or
 * extra folder, duplicates and empty entries are dropped, the loaded row keeps the new list, and
 * every existing chat stores the folders so its next message carries them.
 * Built now (WS-11): a backlog workspace keeps its repository, first message, attachments, chat
 * config and section without a worktree or branch. Starting one runs the normal creation flow and
 * removes the saved entry; removing one deletes only the entry. Removing its repository keeps the
 * entry with no repository, and starting it then returns the message the create flow shows until
 * the user picks another (`setBacklogRepo`).
 * Built now (NAV-06): the Kanban status. It stores the user-set status and keeps the loaded row in
 * step, returning `workspace_unknown` when the workspace is gone.
 * Our design choice: creation is split in two so the sidebar shows the workspace at once
 * (`initializing`) and the slow git work happens after the row exists. Place names come from our
 * own tiered source in this file (`createPlaceNames`, D002), drawn from the gazetteer the Passport
 * map reads (core/services/place-gazetteer.ts), and the composition root passes it. Creation copies the repository's included files, counts the
 * worktree files, then runs setup in a terminal. Warnings and the first message of a failed
 * creation live in the service's in-memory store: the contract's `Workspace` row has no field for
 * them, and the create page reads them back after the action returns. The composition root
 * supplies the repository config reader; the default-config reader remains optional until the
 * composition root passes it.
 * CLOUD-01: setup, the first-message branch rename, archive, unarchive, delete and Open in check
 * the workspace's host before they touch its folder (core/host.ts). Creating a workspace makes a
 * worktree on this Mac, so it stores the local host.
 * CLOUD-10: archive and delete stop the workspace's port forwards first, since its sandbox sleeps
 * (D110). Every path that archives or deletes one does this: the menu, archive-on-merge and a
 * repository removal.
 * Test first: classifyUnarchive returns "branchTaken" when the branch is checked out elsewhere;
 * WS-04 renames a placeholder branch to a suggestion that clashes, with the `-v2` suffix;
 * unarchive re-adds the worktree on the same branch, restores the archive checkpoint, and clears
 * the archive time; a branch checked out elsewhere asks for a new name.
 */
import { LOCAL_HOST, type SessionConfig } from "@conducted/protocol";
import {
	type AppError,
	appError,
	createKeyedQueue,
	err,
	ok,
	type RepoId,
	type Result,
	type SectionId,
	type SessionId,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import { globToRegExp } from "../../platform/glob.ts";
import type { Platform } from "../../platform/platform.ts";
import type { Draft, NewWorkspaceInput, UnarchiveOutcome } from "../api.ts";
import { cursorStoreFolder, setupLogFile, viewedFilesFile } from "../app-paths.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import type { ArchivingWorkspace } from "../db/repair.ts";
import type { Repositories } from "../db/repositories.ts";
import { copyFileKeepingMode, FILE_COPY_FAILED, trashIfPresent } from "../fs-helpers.ts";
import {
	branchDeleteForce,
	branchShowCurrent,
	diffQuietHead,
	diffToolKsdiff,
	fetch,
	lsFiles,
	lsFilesIgnoredNul,
	revParse,
	revParseVerify,
	updateRefDelete,
} from "../git/commands.ts";
import { apiUserLogin } from "../git/gh-commands.ts";
import { archiveRef } from "../git/refs.ts";
import { renameBranchInWorktree } from "../git/rename.ts";
import type { GitRunner } from "../git/runner.ts";
import {
	addWorktreeOnBranch,
	branchNameIsTaken,
	createWorktree,
	nextFreeName,
	pinArchiveHead,
	prepareWorktree,
	readBranchState,
	removeWorktree,
	resolveBaseCommit,
	restoreArchiveCheckpoint,
	saveArchiveSnapshot,
} from "../git/worktree.ts";
import { checkHost } from "../host.ts";
import type {
	BacklogWorkspace,
	KanbanStatus,
	PullRequestSummary,
	Repo,
	RepoConfig,
	Session,
	Workspace,
} from "../model.ts";
import { isArchivedWorkspace } from "../status/archived.ts";
import type { GitCache } from "./git-cache.ts";
import { PLACE_GAZETTEER, type PlaceTier, placeFolderName } from "./place-gazetteer.ts";
import type { SetupRunResult } from "./run-scripts.ts";

export interface PlaceNames {
	/** A place name that is not in `taken`. */
	pick(taken: ReadonlySet<string>): string;
}

/** The folder names a workspace can take, by tier: the shared gazetteer's places (NAV-13). */
const PLACE_NAME_TIERS: Readonly<Record<PlaceTier, readonly string[]>> = {
	common: placeFolderNames("common"),
	uncommon: placeFolderNames("uncommon"),
	rare: placeFolderNames("rare"),
	legendary: placeFolderNames("legendary"),
};

function placeFolderNames(tier: PlaceTier): string[] {
	return PLACE_GAZETTEER.filter((place) => place.tier === tier).map((place) =>
		placeFolderName(place.name),
	);
}

/** How often each tier is tried before the next one (frontend.md 6's rarity tiers). */
const TIER_WEIGHTS: Readonly<Record<PlaceTier, number>> = {
	common: 8,
	uncommon: 4,
	rare: 2,
	legendary: 1,
};

/**
 * The real place-name source (frontend.md 6). It picks a city from the shared gazetteer's rarity
 * tiers, so the Passport map can plot every workspace. When every city is taken it adds Conductor's
 * collision suffix ("-v2", "-v3"), which the map strips, until the name is free, so `pick` always
 * honours its promise that the result is not in `taken`.
 */
export function createPlaceNames(random: () => number = Math.random): PlaceNames {
	const tiers = (Object.entries(PLACE_NAME_TIERS) as [PlaceTier, readonly string[]][]).map(
		([tier, names]) => ({ weight: TIER_WEIGHTS[tier], names }),
	);
	const allNames = [...new Set(Object.values(PLACE_NAME_TIERS).flat())];
	return {
		pick(taken) {
			const available = tiers
				.map((tier) => ({
					weight: tier.weight,
					names: tier.names.filter((name) => !taken.has(name)),
				}))
				.filter((tier) => tier.names.length > 0);
			if (available.length > 0) {
				let roll = random() * available.reduce((sum, tier) => sum + tier.weight, 0);
				for (const [index, tier] of available.entries()) {
					roll -= tier.weight;
					if (roll < 0 || index === available.length - 1) {
						const pick =
							tier.names[Math.min(tier.names.length - 1, Math.floor(random() * tier.names.length))];
						if (pick !== undefined) return pick;
					}
				}
			}
			// Every name is taken: suffix the base until it is free, so `pick` keeps its promise.
			const base =
				allNames[Math.min(allNames.length - 1, Math.floor(random() * allNames.length))] ??
				"workspace";
			let candidate = base;
			for (let n = 2; taken.has(candidate); n++) candidate = `${base}-v${n}`;
			return candidate;
		},
	};
}

/** The Open in app that shows a workspace's changes as a diff instead of its folder. */
const KALEIDOSCOPE_APP = "Kaleidoscope";

/** The app tools a new chat exposes (ui-map 3.9). One home for the create form and the defaults. */
export const FIRST_CHAT_APP_TOOLS = {
	diffComments: true,
	progressUpdates: true,
	setTargetBranch: true,
} as const;

/** A new chat's model when the setting is empty: the agent's own default. */
export const NEW_CHAT_MODEL_FALLBACK = "default";

/**
 * A new chat's effort when the setting is empty ("Model default"). A chat config needs a level, so
 * it opens at "high" until the protocol can say "the model's own default".
 */
export const NEW_CHAT_EFFORT_FALLBACK = "high";

/** The settings a new workspace's first chat takes from the create form or a deep link. */
export interface NewWorkspaceSessionDefaults {
	model: string;
	effort: string;
	fastMode: boolean;
	planMode: boolean;
	requireToolApproval: boolean;
}

/** The first chat's config for a workspace that does not exist yet. */
export function newWorkspaceSessionConfig(defaults: NewWorkspaceSessionDefaults): SessionConfig {
	const model = defaults.model.trim();
	return {
		agent: "claude",
		model: model === "" ? NEW_CHAT_MODEL_FALLBACK : model,
		effort: (defaults.effort === ""
			? NEW_CHAT_EFFORT_FALLBACK
			: defaults.effort) as SessionConfig["effort"],
		fastMode: defaults.fastMode,
		planMode: defaults.planMode,
		requireToolApproval: defaults.requireToolApproval,
		additionalDirectories: [],
		appTools: FIRST_CHAT_APP_TOOLS,
	};
}

/** Shown when the workspace is made but cannot join the chosen section. */
export const SECTION_PLACEMENT_FAILED_MESSAGE =
	"The workspace was created, but it couldn't be added to the section. You can move it from the sidebar.";

/** Shown when the workspace is made but its first chat cannot be created or sent. */
export const CHAT_CREATION_FAILED_MESSAGE =
	"The workspace was created, but its first message could not be started. You can open it and send the message again.";

/** Shown when the default branch prefix needs a GitHub login that `gh` did not return. */
export const GITHUB_LOGIN_MISSING_MESSAGE =
	"No GitHub login was found, so the new branch has no username prefix.";

/** Shown when the branch a caller asked to restore is already open in another worktree. */
export const BRANCH_CHECKED_OUT_MESSAGE =
	"That branch is checked out elsewhere. Choose another branch name.";

/** Shown when an archived workspace has no commit to recreate its missing branch from. */
export const ARCHIVE_COMMIT_MISSING_MESSAGE =
	"This workspace has no saved commit, so its missing branch cannot be restored.";

export type UnarchiveCase = "happy" | "branchDeleted" | "branchTaken" | "branchDiverged";

/** Decides how to restore an archived workspace (services-map.md 3.10). First match wins. */
export function classifyUnarchive(facts: {
	branchExists: boolean;
	checkedOutElsewhere: boolean;
	branchTip: string | null;
	archiveCommit: string | null;
}): UnarchiveCase {
	if (!facts.branchExists) return "branchDeleted";
	if (facts.checkedOutElsewhere) return "branchTaken";
	if (facts.archiveCommit !== null && facts.branchTip !== facts.archiveCommit)
		return "branchDiverged";
	return "happy";
}

/** The branch prefix Conductor's Git setting chooses (ui-map 6): GitHub login, custom text, or none. */
export function branchPrefixFor(type: string, custom: string, githubLogin: string | null): string {
	if (type === "none") return "";
	if (type === "custom") return custom;
	if (type === "github_username") {
		return githubLogin === null || githubLogin === "" ? "" : `${githubLogin}/`;
	}
	return "";
}

/** Expands a leading `~` in the configured root folder, so no shell is needed to read it. */
export function expandHome(path: string, home: string): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return `${home}/${path.slice(2)}`;
	return path;
}

/** The folder a workspace's worktree gets: `<root>/workspaces/<repo>/<place>`. */
export function worktreeFolderFor(root: string, repoName: string, place: string): string {
	return `${root.replace(/\/+$/, "")}/workspaces/${repoName}/${place}`;
}

/** Files copied into a new worktree when the repository config names none (services-map 5A.5.5). */
export const DEFAULT_COPY_FILES: readonly string[] = [".env*"];

/** The largest file copied into a new worktree (256 KiB, services-map 5A.5.5). */
export const COPY_FILE_SIZE_LIMIT = 256 * 1024;

/** The patterns in a `.worktreeinclude` file, one per line, ignoring blank lines and comments. */
export function parseWorktreeInclude(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));
}

const hasGlob = (pattern: string): boolean => /[*?]/.test(pattern);

/** True when a worktree-relative path matches one copy pattern. */
export function matchesCopyPattern(path: string, pattern: string): boolean {
	const trimmed = pattern
		.trim()
		.replace(/^!+/, "")
		.replace(/^\.?\//, "");
	if (trimmed === "") return false;
	const normalized = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
	if (normalized === "") return false;
	if (hasGlob(normalized)) return globToRegExp(normalized).test(path);
	return path === normalized || path.startsWith(`${normalized}/`);
}

/** The ignored files a repository asks to copy, in pattern order, with `!` removing matches. */
export function selectIncludedPaths(
	paths: readonly string[],
	patterns: readonly string[],
): string[] {
	const selected = new Set<string>();
	for (const raw of patterns) {
		const pattern = raw.trim();
		if (pattern === "") continue;
		const negated = pattern.startsWith("!");
		for (const path of paths) {
			if (!matchesCopyPattern(path, pattern)) continue;
			if (negated) selected.delete(path);
			else selected.add(path);
		}
	}
	return [...selected];
}

export interface CopyIncludedFilesDeps {
	fs: Pick<Platform["fs"], "readText" | "exists" | "stat" | "mkdirp" | "readDir">;
	shell: Pick<Platform["shell"], "run">;
	git: GitRunner;
	repoConfig?: (repoId: RepoId) => Promise<Result<RepoConfig>>;
}

/**
 * Copies the files the repository asks for into a new worktree: the lines of `.worktreeinclude`
 * plus the repository's `file_include_globs` (default `.env*`), each file up to 256 KiB
 * (services-map.md 3.1, 5A.5.5). Every path it could not copy comes back as a warning, so the
 * create page can tell the user rather than dropping it silently.
 */
export async function copyIncludedFiles(
	deps: CopyIncludedFilesDeps,
	repo: Repo,
	workspace: Workspace,
): Promise<Result<string[]>> {
	const warnings: string[] = [];
	let fromSettings: readonly string[] = DEFAULT_COPY_FILES;
	if (deps.repoConfig !== undefined) {
		const configured = await deps.repoConfig(repo.id);
		if (!configured.ok) {
			warnings.push(`Couldn't read the repository's file list: ${configured.error.message}`);
		} else if (Array.isArray(configured.value.copyFiles)) {
			fromSettings = configured.value.copyFiles;
		}
	}

	const includePath = `${repo.rootPath}/.worktreeinclude`;
	let fromFile: string[] = [];
	if (await deps.fs.exists(includePath)) {
		const include = await deps.fs.readText(includePath);
		if (include.ok) fromFile = parseWorktreeInclude(include.value);
		else warnings.push(`Couldn't read .worktreeinclude: ${include.error.message}`);
	}

	const patterns = [...fromSettings, ...fromFile];
	if (patterns.length === 0) return ok(warnings);

	const listed = await deps.git.run(lsFilesIgnoredNul(), { cwd: repo.rootPath });
	if (!listed.ok) return listed;
	const candidates = listed.value.stdout.split("\0").filter((path) => path !== "");
	const selected = selectIncludedPaths(candidates, patterns);

	for (const path of selected) {
		const source = `${repo.rootPath}/${path}`;
		const target = `${workspace.path}/${path}`;
		const stat = await deps.fs.stat(source);
		if (!stat.ok) {
			warnings.push(`Couldn't copy ${path}: ${stat.error.message}`);
			continue;
		}
		const copied = stat.value.isDirectory
			? await copyDirectory(deps, source, target, path, warnings)
			: await copyFile(deps, source, target, path, stat.value.size, warnings);
		if (!copied.ok) return copied;
	}
	return ok(warnings);
}

/** Copies one included file with its mode, or records why it was skipped. */
async function copyFile(
	deps: CopyIncludedFilesDeps,
	source: string,
	target: string,
	displayPath: string,
	size: number,
	warnings: string[],
): Promise<Result<void>> {
	if (size > COPY_FILE_SIZE_LIMIT) {
		warnings.push(`Skipped ${displayPath}: larger than 256 KiB.`);
		return ok(undefined);
	}
	// A file already in the worktree may hold the user's edits (a retry runs this copy again).
	if (await deps.fs.exists(target)) return ok(undefined);
	const parent = target.slice(0, target.lastIndexOf("/"));
	const made = await deps.fs.mkdirp(parent);
	if (!made.ok) return made;
	const copied = await copyFileKeepingMode(deps.shell, source, target);
	if (!copied.ok) {
		if (copied.error.code !== FILE_COPY_FAILED) return copied;
		warnings.push(`Couldn't copy ${displayPath}: ${copied.error.message}`);
	}
	return ok(undefined);
}

/** Copies a whole included folder, keeping each file's mode and the 256 KiB cap. */
async function copyDirectory(
	deps: CopyIncludedFilesDeps,
	source: string,
	target: string,
	displayPath: string,
	warnings: string[],
): Promise<Result<void>> {
	const listed = await deps.fs.readDir(source);
	if (!listed.ok) {
		warnings.push(`Couldn't read ${displayPath}: ${listed.error.message}`);
		return ok(undefined);
	}
	const made = await deps.fs.mkdirp(target);
	if (!made.ok) return made;
	for (const entry of listed.value) {
		const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
		const childDisplay = `${displayPath.replace(/\/$/, "")}/${name}`;
		const childSource = `${source.replace(/\/$/, "")}/${name}`;
		const childTarget = `${target.replace(/\/$/, "")}/${name}`;
		const copied = entry.isDirectory
			? await copyDirectory(deps, childSource, childTarget, childDisplay, warnings)
			: await copyFile(deps, childSource, childTarget, childDisplay, entry.size, warnings);
		if (!copied.ok) return copied;
	}
	return ok(undefined);
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
		const path = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
		if (seen.has(path)) continue;
		seen.add(path);
		cleaned.push(path);
	}
	return ok(cleaned);
}

/** Resolves `NewWorkspaceInput.from` to the branch the worktree starts from. */
export function baseBranchFor(
	defaultBranch: string,
	from: NewWorkspaceInput["from"],
): Result<string> {
	if (from.kind === "default") return ok(defaultBranch);
	if (from.kind === "branch") {
		const name = from.name.trim();
		if (name === "")
			return err(appError("workspace_base_missing", "Choose the branch to start from."));
		return isSafeRefName(name) ? ok(name) : err(invalidRefNameError(name));
	}
	return err(
		appError(
			"workspace_base_unsupported",
			"A pull request or issue is resolved to a commit before the branch is named.",
		),
	);
}

export type SetupState =
	| "idle"
	| "detecting"
	| "running"
	| "stopping"
	| "completed"
	| "failed"
	| "cancelled";

/** Shown when the app was quit or crashed while setup was running (services-map.md 2.4.6). */
export const SETUP_INTERRUPTED_MESSAGE =
	"The app quit while setup was running. Run setup again to finish it.";

/** The words for a setup script that failed (inventory:toast main row 463). */
export const SETUP_FAILED_MESSAGE = "Setup script failed. Check the setup tab for logs.";

/** Shown when a saved setup transcript cannot be read (ui-map.md 3.7). */
export const SETUP_LOG_MISSING_MESSAGE = "No logs were recorded, or they have expired.";

/** Shown when archive is asked for while a chat is still running (inventory:toast). */
export const ARCHIVE_RUNNING_CHATS_MESSAGE =
	"Stop the running chats before archiving this workspace.";

/** Shown when a workspace that is still being created is asked to archive. */
export const ARCHIVE_NOT_READY_MESSAGE = "This workspace is still being created.";

/** Shown when the worktree is not on a branch, so archive cannot record which branch it keeps. */
export const ARCHIVE_DETACHED_HEAD_MESSAGE =
	"Git is not on a branch in this workspace. Check out its branch, then archive it again.";

/** Shown when archive-on-merge finds a ready workspace whose folder is gone (services-map 5B.1.9). */
export const WORKSPACE_CORRUPTED_MESSAGE =
	"This workspace's folder is missing, so it can't be archived. Check the folder or remove the workspace.";

/** One setup run, kept in memory for the Setup tab while the app is open. */
export interface SetupRun {
	state: SetupState;
	exitCode: number | null;
	terminalId: SetupRunResult["terminalId"];
	logPath: string | null;
	log: SetupRunResult["log"];
	interruptedReason: string | null;
}

export interface WorkspaceState {
	loaded: boolean;
	/** Workspaces saved to the backlog, not started yet (WS-11). */
	backlogLoaded: boolean;
	backlogById: Readonly<Record<string, BacklogWorkspace>>;
	workspacesById: Readonly<Record<string, Workspace>>;
	/** In memory only: the setup script's state per workspace. */
	setup: Readonly<Record<string, SetupState>>;
	/** In memory only: the last setup run of each workspace, for the Setup tab. */
	setupRuns?: Readonly<Record<string, SetupRun>>;
	/** Workspaces whose archive is running. */
	archiving: Readonly<Record<string, boolean>>;
	/** In memory only: a side step that failed after a workspace was archived, for its screen to show. */
	archiveWarnings?: Readonly<Record<string, string>>;
	/** In memory only: warnings from a workspace's creation, for the create page to toast. */
	warnings?: Readonly<Record<string, readonly string[]>>;
	/** In memory only: the first-message input of a creation that failed, for Recover and Retry. */
	failedFirstInputs?: Readonly<Record<string, NewWorkspaceInput>>;
	/** In memory only: the workspace row of the last creation that failed, for the create page. */
	lastFailedCreate?: Workspace | null;
}

/** What the workspace service needs from chats. The sessions service satisfies it. */
export interface WorkspaceSessionsPort {
	createFirstChat(workspaceId: WorkspaceId, input: NewWorkspaceInput): Promise<Result<Session>>;
	/** The first chat's draft, for "Recover prompt" after a failed creation. */
	firstDraftOf(workspaceId: WorkspaceId): Promise<Result<Draft>>;
	cancelAll(workspaceId: WorkspaceId): Promise<Result<void>>;
	hasWorkingChats(workspaceId: WorkspaceId): boolean;
	markAllRead(workspaceId: WorkspaceId): Promise<Result<void>>;
	deleteAll(workspaceId: WorkspaceId): Promise<Result<void>>;
}

/** The model call that proposes a branch name (SIDE-24). The container passes ChatTitleService. */
export interface BranchNameSuggester {
	suggestBranchName(input: {
		session: Session;
		workspace: Workspace;
		firstUserMessage: string;
		/** The repository's Rename branch prompt, added to the built-in text. */
		customPrompt: string | null;
	}): Promise<Result<string | null>>;
}

export interface WorkspaceServiceDeps {
	platform: Pick<Platform, "fs" | "opener" | "shell">;
	/**
	 * The restart cache of each workspace's changes and pull request info (DATA-07). Deleting a
	 * workspace removes its entries. The composition root supplies it.
	 */
	gitCache?: Pick<GitCache, "remove">;
	git: GitRunner;
	repos: Pick<Repositories, "repos" | "workspaces" | "sessions" | "sections" | "backlogWorkspaces">;
	placeNames: PlaceNames;
	sessions: WorkspaceSessionsPort;
	/**
	 * RUN-03's port service. Creation asks it for the workspace's block, so the stored ports and
	 * the ports already listening on this Mac are both respected.
	 */
	ports?: { allocateForNewWorkspace(): Promise<Result<number>> };
	/**
	 * CLOUD-10: stops a workspace's port forwards before it is archived or deleted. The
	 * composition root passes PortForwardsService.
	 */
	portForwards?: { pauseWorkspace(workspaceId: WorkspaceId): Promise<Result<void>> };
	/** The repository's effective config, for the remote name. Supplied by the composition root. */
	repoConfig: (repoId: RepoId) => Promise<Result<RepoConfig>>;
	/** Reads a pull request's head from GitHub, for a workspace created from a PR (WS-02). */
	github?: {
		pullRequestByNumber(remoteUrl: string, number: number): Promise<Result<PullRequestSummary>>;
	};
	/** WS-04's branch-name call. The composition root passes ChatTitleService. */
	branchNames?: BranchNameSuggester;
	/** The one default-config rule for a new chat. Supplied by the composition root. */
	defaultConfig?: (workspaceId: WorkspaceId) => Promise<Result<SessionConfig>>;
	scripts: {
		runSetup(
			workspaceId: WorkspaceId,
			onStarted?: (terminalId: TerminalId) => void,
		): Promise<Result<SetupRunResult>>;
		runArchive(workspaceId: WorkspaceId): Promise<Result<void>>;
		stopWorkspace(workspaceId: WorkspaceId): Promise<Result<void>>;
		/** Stops every workspace of a repository, used before the repository is removed. */
		stopAllForRepository(workspaceIds: readonly WorkspaceId[]): Promise<Result<void>>;
		/** Forgets a workspace's run state after its processes are stopped. */
		clearRuns(workspaceId: WorkspaceId): void;
	};
	/** Path to the shipped checkpointer script, used for the archive snapshot (WS-05). */
	checkpointerPath: string;
	setting: <T>(key: string) => T;
	now: () => number;
}

export class WorkspaceService {
	readonly store: StoreApi<WorkspaceState>;
	readonly #deps: WorkspaceServiceDeps;

	/** Creates pick a folder name, branch and port from one read, so they run one at a time. */
	readonly #createQueue = createKeyedQueue();
	/** A second archive of one workspace joins the first, so its steps never run twice at once. */
	readonly #archives = createSingleFlight<string>();
	/** A second delete of one workspace joins the first, so its files are not trashed twice. */
	readonly #removals = createSingleFlight<string>();
	/** Bumped by every start and cancel, so an older run cannot change the state after them. */
	readonly #setupNonces = new Map<WorkspaceId, number>();
	/** The nonce of a start that has not reached its first await yet, so a second one is ignored. */
	readonly #setupStarting = new Map<WorkspaceId, number>();
	/** A commit resolved for a workspace before its row existed, so Retry setup reuses it. */
	readonly #baseShas = new Map<WorkspaceId, string>();

	constructor(deps: WorkspaceServiceDeps) {
		this.#deps = deps;
		this.store = createStore<WorkspaceState>(() => ({
			loaded: false,
			backlogLoaded: false,
			backlogById: {},
			workspacesById: {},
			setup: {},
			setupRuns: {},
			archiving: {},
			archiveWarnings: {},
			warnings: {},
			failedFirstInputs: {},
			lastFailedCreate: null,
		}));
	}

	async start(): Promise<Result<void>> {
		const listed = await this.#deps.repos.workspaces.listAll();
		if (!listed.ok) {
			this.store.setState((state) => ({ ...state, loaded: true }));
			return listed;
		}
		// The file commands reach a workspace folder only once it is registered, on every start.
		// A workspace made before the workspaces folder setting changed lives under the old one.
		// A cloud workspace's folder is not on this Mac, so only local rows are registered; the
		// merged list still fills the store below (CLOUD-13).
		const local = listed.value.filter((workspace) => workspace.host.kind === "local");
		const reachable = await this.#registerFolders([
			this.#worktreesRoot(),
			...local.map((workspace) => workspace.path),
		]);
		if (!reachable.ok) {
			this.store.setState((state) => ({ ...state, loaded: true }));
			return reachable;
		}
		const workspacesById: Record<string, Workspace> = {};
		const setupRuns: Record<string, SetupRun> = {};
		let logError: AppError | null = null;
		for (const workspace of listed.value) {
			workspacesById[workspace.id] = workspace;
			if (workspace.host.kind !== "local") continue;
			if (workspace.state !== "failed" && workspace.state !== "ready") continue;
			const logPath = await this.#deps.repos.workspaces.getSetupLogPath(workspace.id);
			if (!logPath.ok) {
				// The workspace still loads; the caller hears that its setup log could not be found.
				logError ??= logPath.error;
				continue;
			}
			if (logPath.value === null) continue;
			const saved = await this.#deps.platform.fs.exists(logPath.value);
			// The exit code and the interrupted reason are not stored, so the load leaves both
			// null rather than inventing a value from the workspace state.
			setupRuns[workspace.id] = {
				state: workspace.state === "ready" ? "completed" : "failed",
				exitCode: null,
				terminalId: null,
				logPath: logPath.value,
				log: saved ? "saved" : "missing",
				interruptedReason: null,
			};
		}
		const backlog = await this.#deps.repos.backlogWorkspaces.list();
		if (!backlog.ok) {
			this.store.setState((state) => ({ ...state, loaded: true, backlogLoaded: true }));
			return backlog;
		}
		const backlogById: Record<string, BacklogWorkspace> = {};
		for (const entry of backlog.value) backlogById[entry.id] = entry;
		this.store.setState((state) => ({
			...state,
			loaded: true,
			backlogLoaded: true,
			backlogById,
			workspacesById,
			setupRuns,
		}));
		return logError === null ? ok(undefined) : err(logError);
	}

	/** The folder new worktrees go to: the `conducted_root_path` setting, with `~` expanded. */
	#worktreesRoot(): string {
		return expandHome(
			this.#deps.setting<string>("conducted_root_path"),
			this.#deps.platform.fs.paths.home,
		);
	}

	/** Lets the file commands reach each folder (PLAT-02). Stops at the first refusal. */
	async #registerFolders(folders: readonly string[]): Promise<Result<void>> {
		for (const folder of folders) {
			const registered = await this.#deps.platform.fs.registerRoot(folder);
			if (!registered.ok) return registered;
		}
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.create`: row first, then worktree, setup, and the first chat. */
	create(input: NewWorkspaceInput): Promise<Result<Workspace>> {
		// Running creates one at a time keeps two clicks from choosing the same values before
		// either row exists.
		return this.#createQueue.run("create", () => this.#createNow(input));
	}

	/**
	 * Backs CHAT-21: creates a workspace whose branch starts at an already resolved commit, such as
	 * a turn checkpoint's original HEAD. The rest of the create path is unchanged.
	 */
	createFromCommit(input: NewWorkspaceInput, baseSha: string): Promise<Result<Workspace>> {
		return this.#createQueue.run("create", () => this.#createNow(input, baseSha));
	}

	async #createNow(
		input: NewWorkspaceInput,
		presetBaseSha: string | null = null,
	): Promise<Result<Workspace>> {
		const found = await this.#deps.repos.repos.get(input.repoId);
		if (!found.ok) return found;
		const repo = found.value;
		if (repo === null) {
			return err(
				appError(
					"repo_unknown",
					input.from.kind === "pull_request" || input.from.kind === "issue"
						? "No repository selected"
						: "That project no longer exists.",
				),
			);
		}

		const remoteRead = await this.#remoteFor(repo);
		if (!remoteRead.ok) return remoteRead;
		const remote = remoteRead.value;

		let targetBranch: string;
		let baseSha: string | null = presetBaseSha;
		let baseWarning: string | null = null;
		// A preset commit (a fork's checkpoint head) is already known, so its branch is only named.
		// Resolving it would read or fetch the branch for nothing, and fail offline or when the
		// branch is gone.
		if (input.from.kind === "default" || presetBaseSha !== null) {
			const target = baseBranchFor(repo.defaultBranch, input.from);
			if (!target.ok) return target;
			targetBranch = target.value;
		} else {
			const resolved = await this.resolveBase(repo.id, input.from);
			if (!resolved.ok) return resolved;
			targetBranch = resolved.value.branchName;
			if (baseSha === null) baseSha = resolved.value.baseSha;
			baseWarning = resolved.value.warning;
		}

		const root = this.#worktreesRoot();
		const reachable = await this.#registerFolders([root]);
		if (!reachable.ok) return reachable;
		const names = await this.#deps.repos.workspaces.listDirectoryNames(repo.id);
		if (!names.ok) return names;
		const taken = new Set(names.value);
		const picked = this.#deps.placeNames.pick(taken);
		const folder = await nextFreeName(picked, async (candidate) => {
			if (taken.has(candidate)) return ok(true);
			return ok(await this.#deps.platform.fs.exists(worktreeFolderFor(root, repo.name, candidate)));
		});
		if (!folder.ok) return folder;

		const warnings: string[] = [];
		if (baseWarning !== null) warnings.push(baseWarning);
		const prefix = await this.#branchPrefix(repo);
		if (!prefix.ok) return prefix;
		if (prefix.value.warning !== null) warnings.push(prefix.value.warning);
		const branchBase = `${prefix.value.prefix}${folder.value}`;
		if (!isSafeRefName(branchBase)) return err(invalidRefNameError(branchBase));
		const branch = await nextFreeName(branchBase, (candidate) =>
			branchNameIsTaken(this.#deps.git, {
				repoRootPath: repo.rootPath,
				remote,
				name: candidate,
			}),
		);
		if (!branch.ok) return branch;

		const portService = this.#deps.ports;
		if (portService === undefined) {
			return err(
				appError(
					"ports_unavailable",
					"A workspace port cannot be chosen because the port service is not available.",
				),
			);
		}
		const port = await portService.allocateForNewWorkspace();
		if (!port.ok) return port;

		const worktreePath = worktreeFolderFor(root, repo.name, folder.value);
		const row = await this.#deps.repos.workspaces.create({
			repoId: repo.id,
			directoryName: folder.value,
			path: worktreePath,
			branch: branch.value,
			branchIsPlaceholder: true,
			targetBranch,
			port: port.value,
			linkedPaths: [],
			setupLogPath: null,
			// Creating a workspace makes a worktree on this Mac. A cloud workspace is made by its
			// Worker (CLOUD-03).
			host: LOCAL_HOST,
		});
		if (!row.ok) return row;
		this.#upsert(row.value);
		const wantsChat = input.prompt.trim() !== "" || input.attachmentPaths.length > 0;
		if (wantsChat) this.#rememberFirstInput(row.value.id, input);
		if (baseSha !== null) this.#baseShas.set(row.value.id, baseSha);

		const materialised = await this.#materialise(row.value, repo, remote);
		if (!materialised.ok) {
			this.#addWarnings(row.value.id, warnings);
			return materialised;
		}
		this.#addWarnings(row.value.id, [...warnings, ...materialised.value.warnings]);
		this.#baseShas.delete(materialised.value.workspace.id);

		await this.#placeInSection(materialised.value.workspace, input.sectionId);

		if (wantsChat) {
			await this.#startFirstChat(materialised.value.workspace.id, input);
		} else {
			this.#forgetFirstInput(materialised.value.workspace.id);
		}
		return ok(materialised.value.workspace);
	}

	/**
	 * The git work a created or retried workspace needs: the worktree when the folder is missing,
	 * then the worktree config, then the move to ready. Both `create` and `retrySetup` use it.
	 */
	async #materialise(
		workspace: Workspace,
		repo: Repo,
		remote: string,
	): Promise<Result<{ workspace: Workspace; warnings: string[] }>> {
		const warnings: string[] = [];
		const exists = await this.#deps.platform.fs.exists(workspace.path);
		if (!exists) {
			const baseSha = this.#baseShas.get(workspace.id);
			const created = await createWorktree(this.#deps.git, {
				repoRootPath: repo.rootPath,
				remote,
				baseBranch: workspace.targetBranch,
				newBranch: workspace.branch,
				worktreePath: workspace.path,
				allowLocalBase: repo.remoteUrl === null,
				...(baseSha === undefined ? {} : { baseSha }),
			});
			if (!created.ok) return this.#fail(workspace, created.error);
			if (created.value.warning !== null) warnings.push(created.value.warning);
		}

		const prepared = await prepareWorktree(this.#deps.git, {
			repoRootPath: repo.rootPath,
			worktreePath: workspace.path,
			autoSetupUpstream: this.#deps.setting<boolean>("worktree_push_auto_setup_remote"),
			fs: this.#deps.platform.fs,
		});
		if (!prepared.ok) return this.#fail(workspace, prepared.error);
		if (prepared.value.warning !== null) warnings.push(prepared.value.warning);

		const copied = await copyIncludedFiles(
			{
				fs: this.#deps.platform.fs,
				shell: this.#deps.platform.shell,
				git: this.#deps.git,
				repoConfig: this.#deps.repoConfig,
			},
			repo,
			workspace,
		);
		if (!copied.ok) return this.#fail(workspace, copied.error);
		warnings.push(...copied.value);

		const counted = await this.#countWorktreeFiles(workspace);
		if (!counted.ok) return this.#fail(workspace, counted.error);

		const setup = await this.runSetup(workspace.id);
		if (!setup.ok) return this.#fail(workspace, setup.error);

		const final = await this.#deps.repos.workspaces.get(workspace.id);
		if (!final.ok) return this.#fail(workspace, final.error);
		if (final.value === null) {
			return this.#fail(
				workspace,
				appError("workspace_unknown", "That workspace no longer exists."),
			);
		}
		return ok({ workspace: final.value, warnings });
	}

	/** Counts the files in the new worktree with `git ls-files`, for the Setup tab (3.1). */
	async #countWorktreeFiles(workspace: Workspace): Promise<Result<void>> {
		const listed = await this.#deps.git.run(lsFiles(), { cwd: workspace.path });
		if (!listed.ok) return listed;
		const count = listed.value.stdout.split("\n").filter((line) => line !== "").length;
		const written = await this.#deps.repos.workspaces.setFilesCopied(workspace.id, count);
		if (!written.ok) return written;
		this.#upsert({ ...workspace, filesCopied: count, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/**
	 * Resolves `NewWorkspaceInput.from` (default, branch, pull request, issue) to a base commit.
	 * An existing local branch is used as it is. A pull request is fetched from
	 * `refs/pull/<number>/head`. An issue starts from the repository's default branch.
	 */
	async resolveBase(
		repoId: RepoId,
		from: NewWorkspaceInput["from"],
	): Promise<Result<{ baseSha: string; branchName: string; warning: string | null }>> {
		const found = await this.#deps.repos.repos.get(repoId);
		if (!found.ok) return found;
		const repo = found.value;
		if (repo === null) {
			return err(
				appError(
					"repo_unknown",
					from.kind === "pull_request" || from.kind === "issue"
						? "No repository selected"
						: "That project no longer exists.",
				),
			);
		}
		const remoteRead = await this.#remoteFor(repo);
		if (!remoteRead.ok) return remoteRead;
		const remote = remoteRead.value;

		if (from.kind === "pull_request") {
			if (this.#deps.github === undefined || repo.remoteUrl === null) {
				return err(
					appError("pull_request_unavailable", "Could not load that pull request", undefined),
				);
			}
			if (!Number.isSafeInteger(from.number) || from.number <= 0) {
				return err(appError("pull_request_unavailable", "Could not load that pull request"));
			}
			const pullRequest = await this.#deps.github.pullRequestByNumber(repo.remoteUrl, from.number);
			if (!pullRequest.ok) {
				return err(
					appError(
						"pull_request_unavailable",
						"Could not load that pull request",
						pullRequest.error,
					),
				);
			}
			const ref = `refs/conducted/pull/${from.number}`;
			const fetched = await this.#deps.git.runChecked(
				fetch(remote, [`refs/pull/${from.number}/head:${ref}`]),
				{ cwd: repo.rootPath },
			);
			if (!fetched.ok) {
				return err(
					appError("pull_request_unavailable", "Could not load that pull request", fetched.error),
				);
			}
			const sha = await this.#deps.git.stdout(revParse(ref), { cwd: repo.rootPath });
			if (!sha.ok || sha.value === "") {
				return err(
					appError(
						"pull_request_unavailable",
						"Could not load that pull request",
						sha.ok ? undefined : sha.error,
					),
				);
			}
			return ok({ baseSha: sha.value, branchName: repo.defaultBranch, warning: null });
		}

		if (from.kind === "issue") {
			return this.#resolveRemoteBranch(repo, remote, repo.defaultBranch);
		}

		const target = baseBranchFor(repo.defaultBranch, from);
		if (!target.ok) return target;
		if (from.kind === "branch") {
			const local = await this.#deps.git.stdout(revParseVerify(`refs/heads/${target.value}`), {
				cwd: repo.rootPath,
			});
			if (local.ok && local.value !== "") {
				return ok({ baseSha: local.value, branchName: target.value, warning: null });
			}
		}
		return this.#resolveRemoteBranch(repo, remote, target.value);
	}

	/** Fetches a remote branch and returns its commit, with the offline fallback (services-map 3.1). */
	async #resolveRemoteBranch(
		repo: Repo,
		remote: string,
		branch: string,
	): Promise<Result<{ baseSha: string; branchName: string; warning: string | null }>> {
		const resolved = await resolveBaseCommit(this.#deps.git, {
			repoRootPath: repo.rootPath,
			remote,
			baseBranch: branch,
			allowLocalBase: repo.remoteUrl === null,
		});
		if (!resolved.ok) return resolved;
		return ok({ ...resolved.value, branchName: branch });
	}

	/** Runs the repo's setup script in a terminal and moves the workspace to ready or failed. */
	async runSetup(workspaceId: WorkspaceId): Promise<Result<void>> {
		// Register the start and its nonce before the first await. A second start or a cancel in
		// the same tick then sees this run instead of slipping past a check that waits on the row.
		if (this.#setupStarting.has(workspaceId)) return ok(undefined);
		const current = this.store.getState().setup[workspaceId];
		if (current === "running") return ok(undefined);

		const nonce = (this.#setupNonces.get(workspaceId) ?? 0) + 1;
		this.#setupNonces.set(workspaceId, nonce);
		this.#setupStarting.set(workspaceId, nonce);

		try {
			const found = await this.#deps.repos.workspaces.get(workspaceId);
			if (this.#setupNonces.get(workspaceId) !== nonce) return ok(undefined);
			if (!found.ok) return found;
			const workspace = found.value;
			if (workspace === null) {
				return err(appError("workspace_unknown", "That workspace no longer exists."));
			}
			checkHost(workspace.host, "shell");
			if (isArchivedWorkspace(workspace) || workspace.state === "archiving") {
				return err(appError("workspace_not_ready", "That workspace is archived."));
			}

			// Record the log path before the script starts, so a quit during setup leaves a row
			// that the next start can still show a log for.
			const logPath = setupLogFile(this.#deps.platform.fs.paths, workspaceId);
			const recorded = await this.#deps.repos.workspaces.setSetupLogPath(workspaceId, logPath);
			if (!recorded.ok) return recorded;
			this.#setSetupRun(workspaceId, {
				state: "detecting",
				exitCode: null,
				terminalId: null,
				logPath,
				log: "live",
				interruptedReason: null,
			});

			const result = await this.#deps.scripts.runSetup(workspaceId, (terminalId) => {
				if (this.#setupNonces.get(workspaceId) !== nonce) return;
				this.#setSetupRun(workspaceId, { state: "running", terminalId });
			});
			if (this.#setupNonces.get(workspaceId) !== nonce) return ok(undefined);

			if (!result.ok) {
				this.#setSetupRun(workspaceId, { state: "failed", exitCode: null, log: "missing" });
				const moved = await this.#finishSetup(workspaceId, false);
				return moved.ok ? err(result.error) : moved;
			}

			const run = result.value;
			const exitCode = run.exitCode;
			// A null exit code means the process was killed or its end is unknown. Only a real
			// exit code of 0, or no script to run, counts as success.
			const succeeded = run.scriptFound ? exitCode === 0 : true;
			if (!run.scriptFound) {
				const cleared = await this.#deps.repos.workspaces.setSetupLogPath(workspaceId, null);
				if (!cleared.ok) return cleared;
			}
			this.#setSetupRun(workspaceId, {
				state: succeeded ? "completed" : "failed",
				exitCode,
				terminalId: run.terminalId ?? null,
				logPath: run.scriptFound ? (run.logPath ?? null) : null,
				log: run.log ?? "missing",
			});
			const moved = await this.#finishSetup(workspaceId, succeeded);
			if (!moved.ok) return moved;
			return succeeded ? ok(undefined) : err(appError("setup_failed", SETUP_FAILED_MESSAGE));
		} finally {
			if (this.#setupStarting.get(workspaceId) === nonce) {
				this.#setupStarting.delete(workspaceId);
			}
		}
	}

	/** Reads the saved setup transcript for the Setup tab. */
	async readSetupLog(workspaceId: WorkspaceId): Promise<Result<string>> {
		const path = await this.#deps.repos.workspaces.getSetupLogPath(workspaceId);
		if (!path.ok) return path;
		if (path.value === null) {
			return err(appError("setup_log_missing", SETUP_LOG_MISSING_MESSAGE));
		}
		const text = await this.#deps.platform.fs.readText(path.value);
		return text.ok ? text : err(appError("setup_log_missing", SETUP_LOG_MISSING_MESSAGE));
	}

	/** Stops a running setup and shows "Cancelled setup script" instead of a failure. */
	async cancelSetup(workspaceId: WorkspaceId): Promise<Result<void>> {
		const current = this.store.getState().setup[workspaceId];
		const starting = this.#setupStarting.get(workspaceId);
		// A start that is still waiting on its row has no "running" state yet, but it must still
		// be cancelled rather than run after the user pressed Stop.
		if (current !== "running" && starting === undefined) return ok(undefined);
		this.#setupNonces.set(workspaceId, (this.#setupNonces.get(workspaceId) ?? 0) + 1);
		if (starting !== undefined && this.#setupStarting.get(workspaceId) === starting) {
			this.#setupStarting.delete(workspaceId);
		}
		this.#setSetupRun(workspaceId, { state: "stopping", exitCode: null, terminalId: null });
		let stopped: Result<void>;
		try {
			stopped = await this.#deps.scripts.stopWorkspace(workspaceId);
		} catch (cause) {
			stopped = err(appError("setup_stop_failed", "Couldn't stop the setup script.", cause));
		}
		this.#setSetupRun(workspaceId, { state: "cancelled", exitCode: null, terminalId: null });
		const finished = await this.#finishSetup(workspaceId, false);
		return stopped.ok ? finished : stopped;
	}

	/** Moves the workspace row to ready or failed after a setup run ends. */
	async #finishSetup(workspaceId: WorkspaceId, succeeded: boolean): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(workspaceId);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null) return ok(undefined);
		const next = succeeded ? "ready" : "failed";
		if (workspace.state === next) return ok(undefined);
		if (workspace.state !== "initializing" && workspace.state !== "ready") return ok(undefined);
		const moved = await this.#deps.repos.workspaces.transitionState(
			workspaceId,
			workspace.state,
			next,
		);
		if (!moved.ok) return moved;
		if (moved.value) this.#upsert({ ...workspace, state: next, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/** Stores one setup run and keeps the older `setup` map in step for the status rule. */
	#setSetupRun(workspaceId: WorkspaceId, patch: Partial<SetupRun>): void {
		this.store.setState((state) => {
			const previous = state.setupRuns?.[workspaceId];
			const next: SetupRun = {
				state: "idle",
				exitCode: null,
				terminalId: null,
				logPath: null,
				log: "missing",
				interruptedReason: null,
				...previous,
				...patch,
			};
			return {
				...state,
				setup: { ...state.setup, [workspaceId]: next.state },
				setupRuns: { ...state.setupRuns, [workspaceId]: next },
			};
		});
	}

	/**
	 * Renames the placeholder branch once the first message tells what the work is
	 * (services-map 3.11). A missing suggestion or a failed one leaves the placeholder in place, as
	 * D030 says. A branch the user or the agent already changed is left alone.
	 */
	async renameBranchAfterFirstMessage(
		sessionId: SessionId,
		firstUserMessage: string,
	): Promise<Result<void>> {
		if (!this.#deps.setting<boolean>("auto_rename_new_branches")) return ok(undefined);
		const foundSession = await this.#deps.repos.sessions.get(sessionId);
		if (!foundSession.ok) return foundSession;
		if (foundSession.value === null) {
			return err(appError("session_unknown", "That chat no longer exists."));
		}
		const found = await this.#deps.repos.workspaces.get(foundSession.value.workspaceId);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		checkHost(workspace.host, "git");
		if (!workspace.branchIsPlaceholder || workspace.prNumber !== null) return ok(undefined);
		const message = firstUserMessage.trim();
		if (message === "") return ok(undefined);

		const checkedOut = await this.#deps.git.stdout(branchShowCurrent(), {
			cwd: workspace.path,
		});
		if (!checkedOut.ok) return checkedOut;
		if (checkedOut.value.trim() !== workspace.branch) return ok(undefined);

		const suggester = this.#deps.branchNames;
		if (suggester === undefined) return ok(undefined);
		const repoResult = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repoResult.ok) return repoResult;
		const repo = repoResult.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));
		const config = await this.#deps.repoConfig(repo.id);
		if (!config.ok) return config;

		const suggestion = await suggester.suggestBranchName({
			session: foundSession.value,
			workspace,
			firstUserMessage: message,
			customPrompt: config.value.prompts.renameBranch,
		});
		// D030: a failed or empty suggestion keeps the placeholder and writes one log line.
		if (!suggestion.ok || suggestion.value === null) return ok(undefined);

		// The model call takes time, so read the row and the checkout again before writing: a user
		// or agent rename that landed meanwhile wins.
		const latest = await this.#deps.repos.workspaces.get(workspace.id);
		if (!latest.ok) return latest;
		const current = latest.value;
		if (current === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		if (!current.branchIsPlaceholder || current.prNumber !== null) return ok(undefined);
		const checkedOutAgain = await this.#deps.git.stdout(branchShowCurrent(), {
			cwd: current.path,
		});
		if (!checkedOutAgain.ok) return checkedOutAgain;
		if (checkedOutAgain.value.trim() !== current.branch) return ok(undefined);

		const prefix = await this.#branchPrefix(repo);
		if (!prefix.ok) return prefix;
		const requestedName = `${prefix.value.prefix}${suggestion.value}`;
		if (!isSafeRefName(requestedName)) return err(invalidRefNameError(requestedName));
		const remote = await this.#remoteFor(repo);
		if (!remote.ok) return remote;
		return renameBranchInWorktree(this.#deps.git, {
			worktreePath: current.path,
			repoRootPath: repo.rootPath,
			remote: remote.value,
			requestedName,
			onRenamed: (branch) => this.applyBranchRename(current.id, branch),
		});
	}

	/** Backs `Actions.workspaces.archive`: the six steps of services-map 3.10, then the row. */
	archive(
		id: WorkspaceId,
		options: { deleteBranch: boolean; discardGitOperationState?: boolean },
	): Promise<Result<void>> {
		return this.#archives.run(`archive:${id}`, () => this.#archiveNow(id, options));
	}

	async #archiveNow(
		id: WorkspaceId,
		options: { deleteBranch: boolean; discardGitOperationState?: boolean },
	): Promise<Result<void>> {
		// CLOUD-10: the sandbox sleeps with the archive, so its forwards stop first (D110).
		await this.#deps.portForwards?.pauseWorkspace(id);
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		checkHost(workspace.host, "lifecycle");
		if (isArchivedWorkspace(workspace)) return ok(undefined);
		if (workspace.state === "archiving") {
			return err(appError("workspace_archiving", "This workspace is already being archived."));
		}
		if (workspace.state === "initializing") {
			return err(appError("workspace_not_ready", ARCHIVE_NOT_READY_MESSAGE));
		}
		if (this.#deps.sessions.hasWorkingChats(id)) {
			return err(appError("workspace_has_running_sessions", ARCHIVE_RUNNING_CHATS_MESSAGE));
		}

		const repoResult = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repoResult.ok) return repoResult;
		const repo = repoResult.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const moved = await this.#deps.repos.workspaces.transitionState(
			id,
			workspace.state,
			"archiving",
		);
		if (!moved.ok) return moved;
		if (!moved.value) {
			return err(appError("workspace_not_ready", "This workspace cannot be archived now."));
		}
		this.#setArchiving(id, true);
		this.#upsert({ ...workspace, state: "archiving", updatedAt: this.#deps.now() });

		let worktreeRemoved = false;
		const rollBack = async (error: AppError): Promise<Result<never>> => {
			if (!worktreeRemoved) {
				const back = await this.#deps.repos.workspaces.transitionState(
					id,
					"archiving",
					workspace.state,
				);
				if (back.ok && back.value) {
					this.#upsert({ ...workspace, updatedAt: this.#deps.now() });
				}
			}
			this.#setArchiving(id, false);
			return err(error);
		};

		try {
			// A setup process can still be running on a row that has moved on, and a run action can
			// still be running too. Stop both before the snapshot so nothing writes into the worktree
			// while it is archived (services-map 3.10, 1.4).
			const setupState = this.store.getState().setup[id];
			const setupIsRunning =
				setupState === "running" || setupState === "detecting" || setupState === "stopping";
			const stopped = setupIsRunning
				? await this.cancelSetup(id)
				: await this.#deps.scripts.stopWorkspace(id);
			if (!stopped.ok) return await rollBack(stopped.error);
			this.#deps.scripts.clearRuns(id);

			const cancelled = await this.#deps.sessions.cancelAll(id);
			if (!cancelled.ok) return await rollBack(cancelled.error);

			const snapshot = await saveArchiveSnapshot(this.#deps.git, {
				workspaceId: id,
				checkpointerPath: this.#deps.checkpointerPath,
				worktreePath: workspace.path,
				discardGitOperationState: options.discardGitOperationState === true,
				fs: this.#deps.platform.fs,
			});
			if (!snapshot.ok) return await rollBack(snapshot.error);

			// The branch git reports is the one the archive keeps. A detached HEAD or a failed read
			// must stop the archive rather than record the name the row happened to have.
			const current = await this.#deps.git.stdout(branchShowCurrent(), {
				cwd: workspace.path,
			});
			if (!current.ok) return await rollBack(current.error);
			if (current.value === "") {
				return await rollBack(appError("git_detached_head", ARCHIVE_DETACHED_HEAD_MESSAGE));
			}
			const branch = current.value;
			if (branch !== workspace.branch) {
				const recorded = await this.#deps.repos.workspaces.setBranch(
					id,
					branch,
					workspace.branchIsPlaceholder,
				);
				if (!recorded.ok) return await rollBack(recorded.error);
			}

			const pinned = await pinArchiveHead(this.#deps.git, id, workspace.path);
			if (!pinned.ok) return await rollBack(pinned.error);

			const scripted = await this.#deps.scripts.runArchive(id);
			if (!scripted.ok) return await rollBack(scripted.error);

			const removal = await removeWorktree(this.#deps.git, this.#deps.platform.fs, {
				repoRootPath: repo.rootPath,
				worktreePath: workspace.path,
			});
			if (!removal.ok) return await rollBack(removal.error);
			worktreeRemoved = true;

			const marked = await this.#deps.repos.workspaces.markArchived(id, pinned.value);
			if (!marked.ok) {
				this.#setArchiving(id, false);
				return err(marked.error);
			}
			if (!marked.value) {
				this.#setArchiving(id, false);
				return err(appError("workspace_not_ready", "This workspace cannot be archived now."));
			}

			const at = this.#deps.now();
			this.#upsert({
				...workspace,
				branch,
				state: "archived",
				archiveCommit: pinned.value,
				archivedAt: at,
				updatedAt: at,
			});
			this.#setArchiving(id, false);

			const deleteBranch =
				options.deleteBranch || this.#deps.setting<boolean>("delete_branch_on_archive");
			if (deleteBranch && branch !== repo.defaultBranch) {
				const deleted = await this.#deps.git.runChecked(branchDeleteForce(branch), {
					cwd: repo.rootPath,
				});
				// The archive itself is finished. A branch that cannot be deleted is a warning for
				// the workspace's screen, not a failed archive (services-map 3.10 step 6).
				if (!deleted.ok) {
					this.#setArchiveWarning(
						id,
						`Couldn't delete the branch "${branch}": ${deleted.error.message}`,
					);
				}
			}
			return ok(undefined);
		} finally {
			this.#setArchiving(id, false);
		}
	}

	/**
	 * Finishes or rolls back workspaces that a crash left in `archiving`. A missing folder means
	 * the archive got as far as removing the worktree, so the row is finished with the commit
	 * repair read; a folder still on disk means the archive stopped early, so the row goes back
	 * to ready and can be archived again.
	 */
	async recoverArchiving(workspaces: readonly ArchivingWorkspace[]): Promise<Result<void>> {
		for (const row of workspaces) {
			if (row.folderExists) {
				const back = await this.#deps.repos.workspaces.transitionState(
					row.id,
					"archiving",
					"ready",
				);
				if (!back.ok) return back;
			} else {
				const finished = await this.#deps.repos.workspaces.markArchived(row.id, row.archiveCommit);
				if (!finished.ok) return finished;
			}
		}
		return ok(undefined);
	}

	/**
	 * Backs `Actions.workspaces.unarchive`: re-adds the worktree and restores the archive snapshot.
	 * A branch that is gone is recreated from the archive commit. A branch that is checked out
	 * elsewhere or has moved gives `needsBranchName` and changes nothing, so the screen can ask
	 * for a new name. A checkpoint restore that fails only sets `uncommittedChangesLost`.
	 */
	async unarchive(
		id: WorkspaceId,
		options: { branchName: string | null; clearChats: boolean },
	): Promise<Result<UnarchiveOutcome>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		checkHost(workspace.host, "lifecycle");
		if (!isArchivedWorkspace(workspace)) {
			return err(appError("workspace_not_archived", "This workspace is not archived."));
		}

		const repoFound = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repoFound.ok) return repoFound;
		const repo = repoFound.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const current = await readBranchState(this.#deps.git, repo.rootPath, workspace.branch);
		if (!current.ok) return current;
		const kind = classifyUnarchive({
			branchExists: current.value.exists,
			checkedOutElsewhere: current.value.checkedOutElsewhere,
			branchTip: current.value.tip,
			archiveCommit: workspace.archiveCommit,
		});

		let branch = workspace.branch;
		let createFrom: string | null = null;

		if (options.branchName !== null) {
			branch = options.branchName;
			if (!isSafeRefName(branch)) return err(invalidRefNameError(branch));
			const chosen = await readBranchState(this.#deps.git, repo.rootPath, branch);
			if (!chosen.ok) return chosen;
			if (chosen.value.checkedOutElsewhere) {
				return err(appError("branch_checked_out_elsewhere", BRANCH_CHECKED_OUT_MESSAGE));
			}
			if (chosen.value.exists) {
				return err(appError("branch_exists", `A branch named "${branch}" already exists.`));
			}
			if (workspace.archiveCommit === null) {
				return err(appError("archive_commit_missing", ARCHIVE_COMMIT_MISSING_MESSAGE));
			}
			createFrom = workspace.archiveCommit;
		} else if (kind === "branchTaken" || kind === "branchDiverged") {
			return ok({ needsBranchName: true, uncommittedChangesLost: false });
		} else if (kind === "branchDeleted") {
			if (workspace.archiveCommit === null) {
				return err(appError("archive_commit_missing", ARCHIVE_COMMIT_MISSING_MESSAGE));
			}
			createFrom = workspace.archiveCommit;
		}

		const listed = await this.#deps.repos.workspaces.listByRepo(repo.id);
		if (!listed.ok) return listed;
		const others = listed.value.filter((row) => row.id !== id);
		const root = this.#worktreesRoot();
		const reachable = await this.#registerFolders([root]);
		if (!reachable.ok) return reachable;
		let directoryName = workspace.directoryName;
		let worktreePath = workspace.path;
		const pathFree = !(await this.#deps.platform.fs.exists(worktreePath));
		const nameTaken = others.some((row) => row.directoryName === directoryName);
		if (!pathFree || nameTaken) {
			const taken = new Set(others.map((row) => row.directoryName));
			if (!pathFree) taken.add(directoryName);
			const picked = await nextFreeName(directoryName, async (candidate) => {
				if (taken.has(candidate)) return ok(true);
				return ok(
					await this.#deps.platform.fs.exists(worktreeFolderFor(root, repo.name, candidate)),
				);
			});
			if (!picked.ok) return picked;
			directoryName = picked.value;
			worktreePath = worktreeFolderFor(root, repo.name, directoryName);
		}

		const moved = await this.#deps.repos.workspaces.transitionState(id, "archived", "initializing");
		if (!moved.ok) return moved;
		if (!moved.value) {
			return err(appError("workspace_not_archived", "This workspace is not archived."));
		}
		this.#upsert({ ...workspace, state: "initializing", updatedAt: this.#deps.now() });

		/**
		 * Undoes a restore that failed: removes the re-added folder when there is one, deletes a
		 * branch this call created, and sets the state back to archived. Each step's failure is
		 * added to the message, so a folder, branch or state left behind is never hidden.
		 */
		const rollBack = async (message: string, removeFolder: boolean): Promise<string> => {
			const notes = [message];
			if (removeFolder) {
				const removed = await removeWorktree(this.#deps.git, this.#deps.platform.fs, {
					repoRootPath: repo.rootPath,
					worktreePath,
				});
				if (!removed.ok) {
					notes.push(`The folder "${worktreePath}" also stays: ${removed.error.message}`);
				}
			}
			if (createFrom !== null) {
				const deleted = await this.#deps.git.runChecked(branchDeleteForce(branch), {
					cwd: repo.rootPath,
				});
				if (!deleted.ok) notes.push(`The new branch "${branch}" also stays.`);
			}
			const back = await this.#deps.repos.workspaces.transitionState(
				id,
				"initializing",
				"archived",
			);
			if (!back.ok) {
				notes.push(
					`The workspace could not be set back to archived and stays initializing: ${back.error.message}`,
				);
			} else if (!back.value) {
				notes.push(
					"The workspace changed while it was being restored, so it was not set back to archived.",
				);
			} else {
				this.#upsert(workspace);
			}
			return notes.join(" ");
		};

		const added = await this.#deps.git.withWorktreeAndRepoLocks(worktreePath, repo.rootPath, () =>
			addWorktreeOnBranch(this.#deps.git, {
				repoRootPath: repo.rootPath,
				worktreePath,
				branch,
				createFrom,
			}),
		);
		if (!added.ok) {
			const message = await rollBack(added.error.message, false);
			return err(appError(added.error.code, message, added.error));
		}

		const restored = await restoreArchiveCheckpoint(
			this.#deps.git,
			this.#deps.checkpointerPath,
			id,
			worktreePath,
		);
		const uncommittedChangesLost = !restored.ok;

		const finished = await this.#deps.repos.workspaces.finishUnarchive(id, {
			branch,
			directoryName,
			path: worktreePath,
		});
		if (!finished.ok || !finished.value) {
			const message = await rollBack(
				finished.ok ? "This workspace could not be restored." : finished.error.message,
				true,
			);
			return finished.ok
				? err(appError("workspace_not_archived", message))
				: err(appError(finished.error.code, message, finished.error));
		}

		const at = this.#deps.now();
		this.#upsert({
			...workspace,
			branch,
			directoryName,
			path: worktreePath,
			state: "ready",
			archivedAt: null,
			lastActivityAt: Math.max(workspace.lastActivityAt, at),
			updatedAt: at,
		});

		if (options.clearChats) {
			const cleared = await this.#deps.sessions.deleteAll(id);
			if (!cleared.ok) return cleared;
		}

		return ok({ needsBranchName: false, uncommittedChangesLost });
	}

	/**
	 * Moves a workspace's recent activity forward (services-map.md 2.3.1). The database row is the
	 * home and the loaded row mirrors it, as every other workspace field does. A time at or before
	 * the stored one changes nothing, so activity never moves backwards.
	 */
	async touchActivity(id: WorkspaceId, at: number): Promise<Result<void>> {
		const written = await this.#deps.repos.workspaces.touchActivity(id, at);
		if (!written.ok) return written;
		this.store.setState((state) => {
			const current = state.workspacesById[id];
			if (current === undefined || current.lastActivityAt >= at) return {};
			return {
				workspacesById: { ...state.workspacesById, [id]: { ...current, lastActivityAt: at } },
			};
		});
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.setLinkedPaths`: the extra folders agents may read and edit. */
	async setLinkedPaths(id: WorkspaceId, paths: readonly string[]): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const normalised = normaliseLinkedPaths(paths);
		if (!normalised.ok) return normalised;
		const written = await this.#deps.repos.workspaces.setLinkedPaths(id, normalised.value);
		if (!written.ok) return written;
		this.#upsert({
			...found.value,
			linkedPaths: normalised.value,
			updatedAt: this.#deps.now(),
		});
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.remove`. */
	remove(id: WorkspaceId): Promise<Result<void>> {
		return this.#removals.run(`remove:${id}`, () => this.#removeNow(id, false));
	}

	/** Removes every workspace of a repository. Used when the repository is removed. */
	async removeWorkspacesOf(repoId: RepoId): Promise<Result<void>> {
		const listed = await this.#deps.repos.workspaces.listByRepo(repoId);
		if (!listed.ok) return listed;
		const ids = listed.value.map((workspace) => workspace.id);
		if (ids.length === 0) return ok(undefined);
		const stopped = await this.#deps.scripts.stopAllForRepository(ids);
		if (!stopped.ok) return stopped;
		for (const id of ids) {
			const removed = await this.#removals.run(`remove:${id}`, () => this.#removeNow(id, true));
			if (!removed.ok) return removed;
		}
		return ok(undefined);
	}

	/**
	 * Deletes one workspace. Everything that can refuse runs before the first irreversible step:
	 * cancelling chats, stopping processes and removing the worktree. The archive ref and the app
	 * data files go next, then the chats and the row. A step that fails leaves the rest for a retry.
	 */
	async #removeNow(id: WorkspaceId, processesStopped: boolean): Promise<Result<void>> {
		// CLOUD-10: deleting a workspace stops its forwards first (D110).
		await this.#deps.portForwards?.pauseWorkspace(id);
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		// Deleting a workspace that is already gone changes nothing.
		if (workspace === null) return ok(undefined);
		checkHost(workspace.host, "lifecycle");

		const repo = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repo.ok) return repo;
		if (repo.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		const repoRootPath = repo.value.rootPath;

		const cancelled = await this.#deps.sessions.cancelAll(id);
		if (!cancelled.ok) return cancelled;

		if (!processesStopped) {
			const stopped = await this.#deps.scripts.stopWorkspace(id);
			if (!stopped.ok) return stopped;
		}

		if (await this.#deps.platform.fs.exists(workspace.path)) {
			const removed = await removeWorktree(this.#deps.git, this.#deps.platform.fs, {
				repoRootPath,
				worktreePath: workspace.path,
			});
			if (!removed.ok) return removed;
		}

		// The archive ref keeps the last commit reachable until the workspace itself is deleted.
		if (await this.#deps.platform.fs.exists(repoRootPath)) {
			const archiveDeleted = await this.#deps.git.runChecked(updateRefDelete(archiveRef(id)), {
				cwd: repoRootPath,
			});
			if (!archiveDeleted.ok) return archiveDeleted;
		}

		const setupLog = await trashIfPresent(
			this.#deps.platform.fs,
			setupLogFile(this.#deps.platform.fs.paths, id),
		);
		if (!setupLog.ok) return setupLog;
		const viewed = await trashIfPresent(
			this.#deps.platform.fs,
			viewedFilesFile(this.#deps.platform.fs.paths, id),
		);
		if (!viewed.ok) return viewed;
		// Cursor's SDK keeps one run store per workspace path; nothing else ever removes it (D084).
		const cursorStore = await trashIfPresent(
			this.#deps.platform.fs,
			await cursorStoreFolder(this.#deps.platform.fs.paths, workspace.path),
		);
		if (!cursorStore.ok) return cursorStore;
		const cached = await this.#deps.gitCache?.remove(id);
		if (cached !== undefined && !cached.ok) return cached;

		const chats = await this.#deps.sessions.deleteAll(id);
		if (!chats.ok) return chats;

		const deleted = await this.#deps.repos.workspaces.delete(id);
		if (!deleted.ok) return deleted;

		this.#deps.scripts.clearRuns(id);
		this.#forgetWorkspace(id);
		return ok(undefined);
	}

	/** Forgets a deleted workspace and every in-memory value kept for it. */
	#forgetWorkspace(id: WorkspaceId): void {
		this.store.setState((state) => {
			const workspacesById = { ...state.workspacesById };
			delete workspacesById[id];
			const setup = { ...state.setup };
			delete setup[id];
			const setupRuns = { ...(state.setupRuns ?? {}) };
			delete setupRuns[id];
			const archiving = { ...state.archiving };
			delete archiving[id];
			const archiveWarnings = { ...(state.archiveWarnings ?? {}) };
			delete archiveWarnings[id];
			const warnings = { ...(state.warnings ?? {}) };
			delete warnings[id];
			const failedFirstInputs = { ...(state.failedFirstInputs ?? {}) };
			delete failedFirstInputs[id];
			return {
				...state,
				workspacesById,
				setup,
				setupRuns,
				archiving,
				archiveWarnings,
				warnings,
				failedFirstInputs,
				lastFailedCreate: state.lastFailedCreate?.id === id ? null : state.lastFailedCreate,
			};
		});
	}

	/**
	 * PR-10: stores the pull request the user linked by URL or number and keeps the loaded row in
	 * step, so the next poll and every screen read the new number.
	 */
	async setLinkedPullRequest(
		id: WorkspaceId,
		pr: { number: number; title: string | null; description: string | null },
	): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		const written = await this.#deps.repos.workspaces.setPullRequest(id, pr);
		if (!written.ok) return written;
		this.#upsert({
			...found.value,
			prNumber: pr.number,
			prTitle: pr.title,
			prDescription: pr.description,
			updatedAt: this.#deps.now(),
		});
		return ok(undefined);
	}

	/**
	 * Called by the GitHub service when a PR merges; archives when `archive_on_merge` asks for it.
	 * The stack rule is not built: without its open-PR data a stacked workspace archives too early.
	 */
	async onPullRequestMerged(id: WorkspaceId, prNumber: number): Promise<Result<void>> {
		if (!this.#deps.setting<boolean>("archive_on_merge")) return ok(undefined);
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		if (
			isArchivedWorkspace(workspace) ||
			workspace.state === "archiving" ||
			workspace.archiveCommit !== null
		) {
			return ok(undefined);
		}
		if (workspace.prNumber !== null && workspace.prNumber !== prNumber) return ok(undefined);
		if (!(await this.#deps.platform.fs.exists(workspace.path))) {
			return err(appError("workspace_corrupted", WORKSPACE_CORRUPTED_MESSAGE));
		}
		return this.archive(id, { deleteBranch: false });
	}

	/**
	 * GIT-09: saves the branch git renamed, so the header and sidebar show the new name. WS-04's
	 * "Rename the workspace with its branch" setting then renames an unnamed workspace to the new
	 * branch, and a failed name write puts the branch row back so the two agree.
	 */
	async applyBranchRename(id: WorkspaceId, branch: string): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		const written = await this.#deps.repos.workspaces.setBranch(id, branch, false);
		if (!written.ok) return written;
		const at = this.#deps.now();
		let displayName = found.value.displayName;
		const followBranch =
			displayName === null &&
			this.#deps.setting<boolean>("auto_rename_workspace_on_branch_name_set");
		if (followBranch) {
			const named = await this.#deps.repos.workspaces.setDisplayName(id, branch);
			if (!named.ok) {
				const back = await this.#deps.repos.workspaces.setBranch(
					id,
					found.value.branch,
					found.value.branchIsPlaceholder,
				);
				return back.ok ? named : err(appError(named.error.code, named.error.message, back.error));
			}
			displayName = branch;
		}
		this.#upsert({
			...found.value,
			branch,
			branchIsPlaceholder: false,
			displayName,
			updatedAt: at,
		});
		return ok(undefined);
	}

	async rename(id: WorkspaceId, name: string): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const displayName = name.trim() === "" ? null : name.trim();
		const written = await this.#deps.repos.workspaces.setDisplayName(id, displayName);
		if (!written.ok) return written;
		this.#upsert({ ...found.value, displayName, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/** Pins a workspace at the top of the list, or unpins it. Backs `Actions.workspaces.setPinned`. */
	async setPinned(id: WorkspaceId, pinned: boolean): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const pinnedAt = pinned ? this.#deps.now() : null;
		const written = await this.#deps.repos.workspaces.setPinned(id, pinnedAt);
		if (!written.ok) return written;
		this.#upsert({ ...found.value, pinnedAt, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/**
	 * GIT-08: stores the workspace's intended target branch and keeps the loaded row in step. The
	 * git work that follows (the open PR's base, or a fetch and reset) belongs to the GitService.
	 */
	async setIntendedTargetBranch(id: WorkspaceId, targetBranch: string): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const written = await this.#deps.repos.workspaces.setTargetBranch(id, targetBranch);
		if (!written.ok) return written;
		this.#upsert({ ...found.value, targetBranch, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/** Stores the workspace's user-set Kanban status and keeps the loaded row in step. */
	async setKanbanStatus(id: WorkspaceId, status: KanbanStatus): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		const written = await this.#deps.repos.workspaces.setKanbanStatus(id, status);
		if (!written.ok) return written;
		this.#upsert({ ...found.value, kanbanStatus: status, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/** Backs a workspace-level mark-read: the chats service clears the workspace's unread chats. */
	markRead(id: WorkspaceId): Promise<Result<void>> {
		return this.#deps.sessions.markAllRead(id);
	}

	/**
	 * Backs `Actions.workspaces.openIn`: opens the workspace folder in another app. Kaleidoscope is a
	 * diff tool, so as in Conductor (renderApp @2492504, services-map.md 3.11) a workspace with
	 * changes against HEAD opens those changes through `git difftool` with ksdiff; a workspace
	 * with none opens its folder in the app.
	 */
	async openIn(id: WorkspaceId, appName: string): Promise<Result<void>> {
		const workspace = this.store.getState().workspacesById[id];
		if (workspace === undefined)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		checkHost(workspace.host, "open-in");
		if (appName === KALEIDOSCOPE_APP) {
			const cwd = workspace.path;
			const changed = await this.#deps.git.runChecked(diffQuietHead(), { cwd });
			if (!changed.ok) return changed;
			if (changed.value.exitCode === 1) {
				const opened = await this.#deps.git.runChecked(diffToolKsdiff(), { cwd });
				return opened.ok ? ok(undefined) : opened;
			}
		}
		return this.#deps.platform.opener.openWith(appName, workspace.path);
	}

	/** Backs `Actions.workspaces.setActiveSession`: remembers the chat tab for the next launch. */
	async setActiveSession(id: WorkspaceId, sessionId: SessionId): Promise<Result<void>> {
		const written = await this.#deps.repos.workspaces.setActiveSession(id, sessionId);
		if (!written.ok) return written;
		const current = this.store.getState().workspacesById[id];
		if (current !== undefined) this.#upsert({ ...current, activeSessionId: sessionId });
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.retrySetup`. A second call while setup runs is ignored. */
	async retrySetup(id: WorkspaceId): Promise<Result<void>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		const workspace = found.value;
		if (workspace === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		checkHost(workspace.host, "shell");
		if (workspace.state !== "failed" && workspace.state !== "ready") return ok(undefined);

		const repoResult = await this.#deps.repos.repos.get(workspace.repoId);
		if (!repoResult.ok) return repoResult;
		const repo = repoResult.value;
		if (repo === null) return err(appError("repo_unknown", "That project no longer exists."));

		const moved = await this.#deps.repos.workspaces.transitionState(
			id,
			workspace.state,
			"initializing",
		);
		if (!moved.ok) return moved;
		// Another retry moved the row first, so its run does the work.
		if (!moved.value) return ok(undefined);
		const initializing = { ...workspace, state: "initializing" as const };
		this.#upsert({ ...initializing, updatedAt: this.#deps.now() });

		const remote = await this.#remoteFor(repo);
		if (!remote.ok) return this.#fail(initializing, remote.error);
		const materialised = await this.#materialise(initializing, repo, remote.value);
		if (!materialised.ok) return materialised;
		this.#baseShas.delete(id);
		this.#addWarnings(id, materialised.value.warnings);

		// A failed creation kept its first message, so a successful retry can start the chat.
		const firstInput = this.store.getState().failedFirstInputs?.[id];
		if (firstInput !== undefined) await this.#startFirstChat(id, firstInput);
		return ok(undefined);
	}

	/** Backs `Actions.workspaces.recoverPrompt`. */
	async recoverPrompt(id: WorkspaceId): Promise<Result<Draft>> {
		const found = await this.#deps.repos.workspaces.get(id);
		if (!found.ok) return found;
		if (found.value === null)
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		// A creation that failed keeps its first message here. That is more complete than the chat's
		// draft row, which may not exist yet or may have been cleared.
		const kept = this.store.getState().failedFirstInputs?.[id];
		if (kept !== undefined) {
			return ok({ text: kept.prompt, attachmentPaths: [...kept.attachmentPaths] });
		}
		return this.#deps.sessions.firstDraftOf(id);
	}

	/** Shown when a backlog workspace is started but its repository is gone (ui-map 3.9). */
	static readonly NO_READY_REPOSITORY_MESSAGE =
		"No ready repository. Pick one to start this workspace.";

	/**
	 * Backs `Actions.workspaces.addToBacklog`: saves the draft without making a worktree. Refused
	 * while the "Unstarted workspaces" setting is off, which is where the rule lives; screens only
	 * hide the button.
	 */
	async addToBacklog(input: NewWorkspaceInput): Promise<Result<BacklogWorkspace>> {
		if (this.#deps.setting<boolean>("unstarted_workspaces_enabled") === false) {
			return err(
				appError(
					"backlog_off",
					"The backlog is turned off. Turn on Unstarted workspaces in Settings, Experimental.",
				),
			);
		}
		const found = await this.#deps.repos.repos.get(input.repoId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		if (input.from.kind !== "default") {
			return err(
				appError(
					"backlog_base_unsupported",
					"A backlog workspace starts from the default branch. Create it now to use a branch, pull request or issue.",
				),
			);
		}
		const saved = await this.#deps.repos.backlogWorkspaces.create({
			repoId: input.repoId,
			displayName: null,
			prompt: input.prompt,
			attachmentPaths: [...input.attachmentPaths],
			config: input.config,
			sectionId: input.sectionId,
		});
		if (!saved.ok) return saved;
		this.#upsertBacklog(saved.value);
		return saved;
	}

	/** Backs `Actions.workspaces.startFromBacklog`: the normal create flow, keeping its draft. */
	async startFromBacklog(id: WorkspaceId): Promise<Result<Workspace>> {
		const found = await this.#deps.repos.backlogWorkspaces.get(id);
		if (!found.ok) return found;
		const entry = found.value;
		if (entry === null) {
			return err(appError("workspace_unknown", "That backlog workspace no longer exists."));
		}
		if (entry.repoId === null) {
			return err(appError("repo_unknown", WorkspaceService.NO_READY_REPOSITORY_MESSAGE));
		}
		const repoId = entry.repoId;
		const repo = await this.#deps.repos.repos.get(repoId);
		if (!repo.ok) return repo;
		if (repo.value === null) {
			return err(appError("repo_unknown", WorkspaceService.NO_READY_REPOSITORY_MESSAGE));
		}
		// The entry goes first: a removal that fails starts nothing, so a second Start can never
		// make a second workspace from the same draft.
		const removed = await this.#deps.repos.backlogWorkspaces.delete(id);
		if (!removed.ok) return removed;
		this.#forgetBacklog(id);
		const failedBefore = this.store.getState().lastFailedCreate;
		const created = await this.create({
			repoId,
			from: { kind: "default" },
			prompt: entry.prompt,
			attachmentPaths: [...entry.attachmentPaths],
			config: entry.config,
			sectionId: entry.sectionId,
		});
		if (created.ok) return created;
		// A create that made a failed workspace keeps the draft there (Retry setup, Recover prompt),
		// so the entry stays gone. One that failed before that puts the entry back as it was.
		const failedAfter = this.store.getState().lastFailedCreate;
		if (failedAfter !== null && failedAfter !== undefined && failedAfter !== failedBefore) {
			return created;
		}
		const restored = await this.#deps.repos.backlogWorkspaces.restore(entry);
		if (!restored.ok) {
			return err(
				appError(
					"backlog_restore_failed",
					`${created.error.message} The backlog entry could not be put back: ${restored.error.message}`,
					restored.error,
				),
			);
		}
		this.#upsertBacklog(entry);
		return created;
	}

	/**
	 * Backs `Actions.workspaces.setBacklogRepo`: the repository a backlog workspace starts in, for
	 * one whose repository was removed (WS-11).
	 */
	async setBacklogRepo(id: WorkspaceId, repoId: RepoId): Promise<Result<void>> {
		const repo = await this.#deps.repos.repos.get(repoId);
		if (!repo.ok) return repo;
		if (repo.value === null) {
			return err(appError("repo_unknown", "That project no longer exists."));
		}
		const written = await this.#deps.repos.backlogWorkspaces.setRepo(id, repoId);
		if (!written.ok) return written;
		const current = this.store.getState().backlogById[id];
		if (current !== undefined)
			this.#upsertBacklog({ ...current, repoId, updatedAt: this.#deps.now() });
		return ok(undefined);
	}

	/**
	 * Called after a repository row was deleted: the database set its backlog workspaces' repository
	 * to null (migration 0008), and the store follows, so the backlog asks for a repository.
	 */
	releaseBacklogOf(repoId: RepoId): void {
		this.store.setState((state) => {
			let changed = false;
			const backlogById: Record<string, BacklogWorkspace> = {};
			for (const [id, entry] of Object.entries(state.backlogById)) {
				if (entry.repoId === repoId) {
					changed = true;
					backlogById[id] = { ...entry, repoId: null };
				} else {
					backlogById[id] = entry;
				}
			}
			return changed ? { ...state, backlogById } : state;
		});
	}

	/** Backs `Actions.workspaces.removeFromBacklog`. */
	async removeFromBacklog(id: WorkspaceId): Promise<Result<void>> {
		const removed = await this.#deps.repos.backlogWorkspaces.delete(id);
		if (!removed.ok) return removed;
		this.#forgetBacklog(id);
		return ok(undefined);
	}

	/** Puts a saved backlog workspace in the store, so the backlog screen shows it after saving. */
	#upsertBacklog(entry: BacklogWorkspace): void {
		this.store.setState((state) => ({
			...state,
			backlogById: { ...state.backlogById, [entry.id]: entry },
		}));
	}

	#forgetBacklog(id: WorkspaceId): void {
		this.store.setState((state) => {
			const backlogById = { ...state.backlogById };
			delete backlogById[id];
			return { ...state, backlogById };
		});
	}

	/** Keeps the ids of workspaces being archived, so the sidebar can show that state (1.5). */
	#setArchiving(id: WorkspaceId, archiving: boolean): void {
		this.store.setState((state) => {
			const next = { ...state.archiving };
			if (archiving) next[id] = true;
			else delete next[id];
			return { ...state, archiving: next };
		});
	}

	/** Keeps a side step's failure after the archive has finished, so a screen can show it. */
	#setArchiveWarning(id: WorkspaceId, warning: string): void {
		this.store.setState((state) => ({
			...state,
			archiveWarnings: { ...(state.archiveWarnings ?? {}), [id]: warning },
		}));
	}

	/** Puts one workspace in the store, so the sidebar shows it before the git work finishes. */
	#upsert(workspace: Workspace): void {
		this.store.setState((state) => ({
			...state,
			workspacesById: { ...state.workspacesById, [workspace.id]: workspace },
		}));
	}

	/** Keeps the first message while a creation can still fail, so Retry and Recover have it. */
	#rememberFirstInput(id: WorkspaceId, input: NewWorkspaceInput): void {
		this.store.setState((state) => ({
			...state,
			failedFirstInputs: { ...(state.failedFirstInputs ?? {}), [id]: input },
		}));
	}

	#forgetFirstInput(id: WorkspaceId): void {
		this.store.setState((state) => {
			const failedFirstInputs = { ...(state.failedFirstInputs ?? {}) };
			delete failedFirstInputs[id];
			return { ...state, failedFirstInputs };
		});
	}

	/** Adds warnings the create page toasts once the action returns. */
	#addWarnings(id: WorkspaceId, warnings: readonly string[]): void {
		if (warnings.length === 0) return;
		this.store.setState((state) => ({
			...state,
			warnings: {
				...(state.warnings ?? {}),
				[id]: [...(state.warnings?.[id] ?? []), ...warnings],
			},
		}));
	}

	/**
	 * The remote the repository's config picks, validated before any git command uses it
	 * (ui-map 6 Git, services-map 3.1). A config that cannot be read stops creation with its
	 * error: the service never falls back to a remote the user did not choose.
	 */
	async #remoteFor(repo: Repo): Promise<Result<string>> {
		const configured = await this.#deps.repoConfig(repo.id);
		if (!configured.ok) return configured;
		return remoteNameFromConfig(configured.value);
	}

	/**
	 * Starts the first chat. The first message is forgotten only when the chat exists; any failure
	 * leaves it for Retry and Recover and adds a warning for the page.
	 */
	async #startFirstChat(workspaceId: WorkspaceId, input: NewWorkspaceInput): Promise<void> {
		const chatInput = await this.#firstChatInput(workspaceId, input);
		if (!chatInput.ok) {
			this.#addWarnings(workspaceId, [CHAT_CREATION_FAILED_MESSAGE]);
			return;
		}
		const chat = await this.#deps.sessions.createFirstChat(workspaceId, chatInput.value);
		if (!chat.ok) {
			this.#addWarnings(workspaceId, [CHAT_CREATION_FAILED_MESSAGE]);
			return;
		}
		this.#forgetFirstInput(workspaceId);
		// The workspace opens on its first chat: the route reopens the remembered tab (NAV-02). If the
		// write fails, the chat is still in the tab strip; the workspace just opens with no tab chosen.
		await this.setActiveSession(workspaceId, chat.value.id);
	}

	/**
	 * The first chat's config: the app's one default-config rule, with what the create page chose on
	 * top: the agent (and ACP agent), model, effort, fast mode and plan mode. The defaults keep the
	 * rest (directories, app tools, the per-agent options, Remote Control). Without the injected rule
	 * the page's config stands. When the rule cannot be read the chat is not started with a guessed
	 * config.
	 */
	async #firstChatInput(
		workspaceId: WorkspaceId,
		input: NewWorkspaceInput,
	): Promise<Result<NewWorkspaceInput>> {
		if (this.#deps.defaultConfig === undefined) return ok(input);
		const defaults = await this.#deps.defaultConfig(workspaceId);
		if (!defaults.ok) return defaults;
		const requested = input.config;
		const { acpAgent: _defaultAcpAgent, ...base } = defaults.value;
		const config: SessionConfig = {
			...base,
			agent: requested.agent,
			...(requested.acpAgent === undefined ? {} : { acpAgent: requested.acpAgent }),
			model: requested.model.trim() === "" ? defaults.value.model : requested.model.trim(),
			effort: requested.effort,
			fastMode: requested.fastMode,
			planMode: requested.planMode,
		};
		return ok({ ...input, config });
	}

	/** Puts a new workspace in the chosen section, and warns when that fails (ui-map 7.2). */
	async #placeInSection(workspace: Workspace, sectionId: SectionId | null): Promise<void> {
		if (sectionId === null) return;
		const placed = await this.#deps.repos.sections.moveWorkspace(workspace.id, sectionId);
		if (!placed.ok) this.#addWarnings(workspace.id, [SECTION_PLACEMENT_FAILED_MESSAGE]);
	}

	/** Moves a half-created workspace to failed and keeps its row (D034). */
	async #fail(workspace: Workspace, error: AppError): Promise<Result<never>> {
		const moved = await this.#deps.repos.workspaces.transitionState(
			workspace.id,
			"initializing",
			"failed",
		);
		const failed: Workspace = {
			...workspace,
			state: "failed",
			updatedAt: this.#deps.now(),
		};
		if (moved.ok && moved.value) this.#upsert(failed);
		this.store.setState((state) => ({ ...state, lastFailedCreate: failed }));
		return err(error);
	}

	/** The branch prefix from the Git settings, and the warning when the GitHub login is missing. */
	async #branchPrefix(repo: Repo): Promise<Result<{ prefix: string; warning: string | null }>> {
		const prefixType = this.#deps.setting<string>("branch_prefix_type");
		const login = prefixType === "github_username" ? await this.#githubLogin(repo.rootPath) : null;
		return ok({
			prefix: branchPrefixFor(
				prefixType,
				this.#deps.setting<string>("branch_prefix_custom"),
				login,
			),
			warning:
				prefixType === "github_username" && login === null ? GITHUB_LOGIN_MISSING_MESSAGE : null,
		});
	}

	/** The GitHub login used by the default branch prefix. Null when `gh` is not signed in. */
	async #githubLogin(repoRootPath: string): Promise<string | null> {
		const result = await this.#deps.git.run(apiUserLogin(), { cwd: repoRootPath });
		if (!result.ok || result.value.exitCode !== 0) return null;
		const login = result.value.stdout.trim();
		return login === "" ? null : login;
	}
}
