/**
 * @feature WS-01 Workspace service: create, set up, archive, unarchive, delete
 * @feature WS-02 Create from a branch, PR or issue
 * @feature WS-03 Copy the repository's included files into a new worktree
 * @feature CHAT-21 Fork a chat to a new workspace
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: workspace creation, local and cloud: the row, the place name, the branch, the folder, the
 * copy of the repository's included files and the first chat. `WorkspaceService` delegates
 * `create`, `createFirst`, `createFromCommit` and `resolveBase` here.
 * Behaviour: frontend.md 6 (creation and naming), services-map.md 3.1 (create) and 5A.5.5 (copied
 * files), ui-map.md 3.9 (create form), D125 (the split), D127 (cloud creation).
 * Must handle: the directory name is a unique place name for the repo and the branch is prefix +
 * name, suffixed -v1, -v2 when taken; a branch or prefix that git could read as an option is
 * rejected before any git call; creation fetches the base, falls back to the cached remote ref
 * offline and tells the user; copying the repo's files is part of creation and never overwrites a
 * file already in the worktree; the row comes first so the sidebar shows the workspace at once
 * (`initializing`) and the slow git work follows.
 * CLOUD-19: a create that names a Worker (`cloudUrl`) gives the row its own sandbox name and the
 * folder `/workspace/<name>`, starts the sandbox, clones the project's GitHub repository there and
 * checks out the new branch from `origin/<base>` (a pull request's head is fetched first). The
 * worktree config, the copy of the Mac's included files and the Mac's base fetch do not apply in a
 * sandbox; the file count, setup, section and first chat are shared. A project with no GitHub
 * remote is refused before the Worker is asked anything, because the Worker clones from GitHub only
 * (D104). D127.
 */
import { type Host, LOCAL_HOST, type SessionConfig } from "@conducted/protocol";
import {
	type AppError,
	appError,
	createKeyedQueue,
	err,
	type IdSource,
	ok,
	type RepoId,
	type Result,
	type SectionId,
	type SessionId,
	trimTrailingSlashes,
	type WorkspaceId,
} from "@conducted/shared";
import type { StoreApi } from "zustand/vanilla";
import { globToRegExp } from "../../platform/glob.ts";
import type { Platform } from "../../platform/platform.ts";
import type { NewWorkspaceInput } from "../api.ts";
import { AUTO_SYNC_SETTING, initialSyncEnabled } from "../cloud/file-sync.ts";
import {
	cloudWorkspaceFolder,
	cloudWorkspaceName,
	startCloudWorkspace,
} from "../cloud/lifecycle.ts";
import { copyFileKeepingMode, FILE_COPY_FAILED } from "../fs-helpers.ts";
import {
	branchShowCurrent,
	checkoutNewBranch,
	cloneWithProgress,
	configSet,
	fetch,
	lsFiles,
	lsFilesIgnoredNul,
	revParse,
	revParseVerify,
} from "../git/commands.ts";
import { apiUserLogin } from "../git/gh-commands.ts";
import type { GitRunner } from "../git/runner.ts";
import {
	addContextFolder,
	branchNameIsTaken,
	createWorktree,
	nextFreeName,
	prepareWorktree,
	resolveBaseCommit,
	WORKTREE_CONFIG_SKIPPED_MESSAGE,
} from "../git/worktree.ts";
import type { Repo, RepoConfig, Workspace } from "../model.ts";
import { cloudRepositories } from "../organization.ts";
import { PLACE_GAZETTEER, type PlaceTier, placeFolderName } from "../place-gazetteer.ts";
import {
	branchPrefixFor,
	invalidRefNameError,
	isSafeRefName,
	NEW_CHAT_EFFORT_FALLBACK,
	NEW_CHAT_MODEL_FALLBACK,
	remoteNameFromConfig,
} from "../workspace-helpers.ts";
import type { WorkspaceServiceDeps, WorkspaceState } from "./workspace.ts";

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

/** The app tools a new chat exposes (ui-map 3.9). One home for the create form and the defaults. */
export const FIRST_CHAT_APP_TOOLS = {
	diffComments: true,
	progressUpdates: true,
	setTargetBranch: true,
} as const;

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

/**
 * The first chat's config from the user's defaults, for a workspace made without the create form:
 * a deep link's plan, and the first workspace of a project just added (Conductor's
 * autoCreateWorkspace).
 */
export function newWorkspaceConfigFromSettings(setting: <T>(key: string) => T): SessionConfig {
	return newWorkspaceSessionConfig({
		model: setting<string>("default_model"),
		effort: setting<string>("default_claude_effort_level"),
		fastMode: setting<boolean>("default_fast_mode"),
		planMode: setting<boolean>("default_plan_mode"),
		requireToolApproval: setting<boolean>("tool_approvals_enabled"),
	});
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

/** The folder a workspace's worktree gets: `<root>/workspaces/<repo>/<place>`. */
export function worktreeFolderFor(root: string, repoName: string, place: string): string {
	return `${trimTrailingSlashes(root)}/workspaces/${repoName}/${place}`;
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
	const hasInclude = await deps.fs.exists(includePath);
	if (!hasInclude.ok) {
		warnings.push(`Couldn't read .worktreeinclude: ${hasInclude.error.message}`);
	} else if (hasInclude.value) {
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
	const already = await deps.fs.exists(target);
	if (!already.ok) return already;
	if (already.value) return ok(undefined);
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

/** Why a project cannot become a cloud workspace: the Worker clones from GitHub only (D104). */
export const CLOUD_REPO_NOT_GITHUB_MESSAGE =
	"A cloud workspace is cloned from GitHub, and this project has no GitHub remote.";

const cloudRepoNotGithub = (): AppError =>
	appError("cloud_repo_not_github", CLOUD_REPO_NOT_GITHUB_MESSAGE);

const cloudCreateUnavailable = (): AppError =>
	appError("cloud_unavailable", "Cloud workspaces cannot be created in this window.");

/** Where a cloud workspace's branch starts, and the ref to fetch first (CLOUD-19). */
export interface WorkspaceCreationStart {
	fetch: string | null;
	startPoint: string;
}

/**
 * The workspace state and the operations a creation shares with the service that owns it. The
 * owner passes its store, the commit and cloud starts a retry reuses, and the setup and active-tab
 * steps the first chat ends with.
 */
export interface WorkspaceCreationHost {
	store: StoreApi<WorkspaceState>;
	/** A commit resolved for a workspace before its row existed, so Retry setup reuses it. */
	baseShas: Map<WorkspaceId, string>;
	/** Where a cloud workspace's branch starts, kept until Retry setup makes its checkout. */
	cloudStarts: Map<WorkspaceId, WorkspaceCreationStart>;
	/** Puts one workspace in the store, so the sidebar shows it before the git work finishes. */
	put(workspace: Workspace): void;
	worktreesRoot(): string;
	registerFolders(folders: readonly string[]): Promise<Result<void>>;
	runSetup(workspaceId: WorkspaceId): Promise<Result<void>>;
	setActiveSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<Result<void>>;
}

/** Creates a workspace's row, folder, branch and first chat, on this Mac or in a sandbox. */
export class WorkspaceCreation {
	readonly #deps: WorkspaceServiceDeps;
	readonly #host: WorkspaceCreationHost;
	/** Creates pick a folder name, branch and port from one read, so they run one at a time. */
	readonly #createQueue = createKeyedQueue();

	constructor(deps: WorkspaceServiceDeps, host: WorkspaceCreationHost) {
		this.#deps = deps;
		this.#host = host;
	}

	/**
	 * Backs `Actions.workspaces.createFirst`: a just-added project's first workspace, from the
	 * default branch with the user's default chat settings and no first message, as Conductor's
	 * repo-created step makes it (renderApp @1713146, autoCreateWorkspace).
	 */
	createFirst(repoId: RepoId): Promise<Result<Workspace>> {
		return this.create({
			repoId,
			from: { kind: "default" },
			prompt: "",
			attachmentPaths: [],
			config: newWorkspaceConfigFromSettings(this.#deps.setting),
			sectionId: null,
		});
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

		// A cloud workspace is cloned from the project's GitHub repository in its own sandbox, so a
		// project the Worker cannot clone is refused before anything is asked of it (CLOUD-19).
		const cloud = input.cloudUrl === undefined ? null : this.#cloudTarget(repo, input.cloudUrl);
		if (cloud !== null && !cloud.ok) return cloud;

		const remoteRead = await this.remoteFor(repo);
		if (!remoteRead.ok) return remoteRead;
		const remote = remoteRead.value;

		let targetBranch: string;
		let baseSha: string | null = presetBaseSha;
		let baseWarning: string | null = null;
		let cloudStart: WorkspaceCreationStart | null = null;
		// A preset commit (a fork's checkpoint head) is already known, so its branch is only named.
		// Resolving it would read or fetch the branch for nothing, and fail offline or when the
		// branch is gone.
		if (input.from.kind === "default" || presetBaseSha !== null) {
			const target = baseBranchFor(repo.defaultBranch, input.from);
			if (!target.ok) return target;
			targetBranch = target.value;
		} else if (cloud !== null) {
			// The sandbox's clone has the remote's branches; a pull request's head is fetched there.
			const target =
				input.from.kind === "branch"
					? baseBranchFor(repo.defaultBranch, input.from)
					: ok(repo.defaultBranch);
			if (!target.ok) return target;
			targetBranch = target.value;
			if (input.from.kind === "pull_request") {
				if (!Number.isSafeInteger(input.from.number) || input.from.number <= 0) {
					return err(appError("pull_request_unavailable", "Could not load that pull request"));
				}
				const ref = `refs/conducted/pull/${input.from.number}`;
				cloudStart = { fetch: `refs/pull/${input.from.number}/head:${ref}`, startPoint: ref };
			}
		} else {
			const resolved = await this.resolveBase(repo.id, input.from);
			if (!resolved.ok) return resolved;
			targetBranch = resolved.value.branchName;
			if (baseSha === null) baseSha = resolved.value.baseSha;
			baseWarning = resolved.value.warning;
		}

		const root = this.#host.worktreesRoot();
		const reachable = await this.#host.registerFolders([root]);
		if (!reachable.ok) return reachable;
		const names = await this.#deps.repos.workspaces.listDirectoryNames(repo.id);
		if (!names.ok) return names;
		const taken = new Set(names.value);
		const picked = this.#deps.placeNames.pick(taken);
		const folder = await nextFreeName(picked, async (candidate) => {
			if (taken.has(candidate)) return ok(true);
			return this.#deps.platform.fs.exists(worktreeFolderFor(root, repo.name, candidate));
		});
		if (!folder.ok) return folder;

		const warnings: string[] = [];
		if (baseWarning !== null) warnings.push(baseWarning);
		const prefix = await this.branchPrefix(repo);
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

		let host: Host = LOCAL_HOST;
		let worktreePath = worktreeFolderFor(root, repo.name, folder.value);
		if (cloud !== null) {
			const vmId = cloudWorkspaceName(cloud.value.ids.uuid());
			host = { kind: "cloud", url: cloud.value.url, vmId };
			worktreePath = cloudWorkspaceFolder(vmId);
			cloudStart ??= { fetch: null, startPoint: baseSha ?? `origin/${targetBranch}` };
		}
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
			// A worktree on this Mac, or the named Worker's sandbox (CLOUD-19).
			host,
			remoteFileSyncEnabled: initialSyncEnabled(
				host,
				this.#deps.setting<boolean>(AUTO_SYNC_SETTING) === true,
			),
		});
		if (!row.ok) return row;
		this.#host.put(row.value);
		const wantsChat = input.prompt.trim() !== "" || input.attachmentPaths.length > 0;
		if (wantsChat) this.#rememberFirstInput(row.value.id, input);
		if (baseSha !== null && cloudStart === null) this.#host.baseShas.set(row.value.id, baseSha);
		if (cloudStart !== null) this.#host.cloudStarts.set(row.value.id, cloudStart);

		const materialised = await this.materialise(row.value, repo, remote);
		if (!materialised.ok) {
			this.addWarnings(row.value.id, warnings);
			return materialised;
		}
		this.addWarnings(row.value.id, [...warnings, ...materialised.value.warnings]);
		this.#host.baseShas.delete(materialised.value.workspace.id);

		await this.#placeInSection(materialised.value.workspace, input.sectionId);

		if (wantsChat) {
			await this.startFirstChat(materialised.value.workspace.id, input);
		} else {
			this.#forgetFirstInput(materialised.value.workspace.id);
		}
		return ok(materialised.value.workspace);
	}

	/**
	 * The git work a created or retried workspace needs: the worktree when the folder is missing,
	 * then the worktree config, then the move to ready. Both `create` and `retrySetup` use it.
	 */
	async materialise(
		workspace: Workspace,
		repo: Repo,
		remote: string,
	): Promise<Result<{ workspace: Workspace; warnings: string[] }>> {
		const placed =
			workspace.host.kind === "cloud"
				? await this.#placeInSandbox(workspace, workspace.host, repo)
				: await this.#placeWorktree(workspace, repo, remote);
		if (!placed.ok) return this.fail(workspace, placed.error);
		const warnings = placed.value;

		const counted = await this.#countWorktreeFiles(workspace);
		if (!counted.ok) return this.fail(workspace, counted.error);

		const setup = await this.#host.runSetup(workspace.id);
		if (!setup.ok) return this.fail(workspace, setup.error);

		const final = await this.#deps.repos.workspaces.get(workspace.id);
		if (!final.ok) return this.fail(workspace, final.error);
		if (final.value === null) {
			return this.fail(
				workspace,
				appError("workspace_unknown", "That workspace no longer exists."),
			);
		}
		return ok({ workspace: final.value, warnings });
	}

	/**
	 * A Mac workspace's folder: the worktree when it is missing, its config, and the copy of the
	 * repository's included files. Returns the warnings to show.
	 */
	async #placeWorktree(
		workspace: Workspace,
		repo: Repo,
		remote: string,
	): Promise<Result<string[]>> {
		const warnings: string[] = [];
		const exists = await this.#deps.platform.fs.exists(workspace.path);
		if (!exists.ok) return exists;
		if (!exists.value) {
			const baseSha = this.#host.baseShas.get(workspace.id);
			const created = await createWorktree(this.#deps.git, {
				repoRootPath: repo.rootPath,
				remote,
				baseBranch: workspace.targetBranch,
				newBranch: workspace.branch,
				worktreePath: workspace.path,
				allowLocalBase: repo.remoteUrl === null,
				...(baseSha === undefined ? {} : { baseSha }),
			});
			if (!created.ok) return created;
			if (created.value.warning !== null) warnings.push(created.value.warning);
		}

		const prepared = await prepareWorktree(this.#deps.git, {
			repoRootPath: repo.rootPath,
			worktreePath: workspace.path,
			autoSetupUpstream: this.#deps.setting<boolean>("worktree_push_auto_setup_remote"),
			fs: this.#deps.platform.fs,
		});
		if (!prepared.ok) return prepared;
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
		if (!copied.ok) return copied;
		warnings.push(...copied.value);
		return ok(warnings);
	}

	/**
	 * A cloud workspace's folder (CLOUD-19): the sandbox is started, the project is cloned into the
	 * workspace's folder when it is not there yet, the new branch is checked out when it is not the
	 * current one, and the `.context` folder is kept out of git. The workspace's folder belongs to
	 * its sandbox, so these git and file calls reach the Worker. Returns the warnings to show.
	 */
	async #placeInSandbox(
		workspace: Workspace,
		host: Extract<Host, { kind: "cloud" }>,
		repo: Repo,
	): Promise<Result<string[]>> {
		const cloud = this.#deps.cloud;
		if (cloud === undefined) return err(cloudCreateUnavailable());
		const warnings: string[] = [];
		const started = await startCloudWorkspace(cloud, host);
		if (!started.ok) return started;

		const fs = this.#deps.platform.fs;
		const git = this.#deps.git;
		const cwd = workspace.path;
		const start = this.#host.cloudStarts.get(workspace.id) ?? {
			fetch: null,
			startPoint: `origin/${workspace.targetBranch}`,
		};
		const present = await fs.exists(cwd);
		if (!present.ok) return present;
		if (!present.value) {
			const source = cloudRepositories([repo])[0];
			if (source === undefined) return err(cloudRepoNotGithub());
			const made = await fs.mkdirp(cwd);
			if (!made.ok) return made;
			const cloned = await git.runChecked(cloneWithProgress(source.cloneUrl, "."), { cwd });
			if (!cloned.ok) return cloned;
		}
		const current = await git.stdout(branchShowCurrent(), { cwd });
		if (!current.ok) return current;
		if (current.value !== workspace.branch) {
			if (start.fetch !== null) {
				const fetched = await git.runChecked(fetch("origin", [start.fetch]), { cwd });
				if (!fetched.ok) {
					return err(
						appError("pull_request_unavailable", "Could not load that pull request", fetched.error),
					);
				}
			}
			const checkedOut = await git.runChecked(
				checkoutNewBranch(workspace.branch, start.startPoint),
				{ cwd },
			);
			if (!checkedOut.ok) return checkedOut;
		}
		this.#host.cloudStarts.delete(workspace.id);

		if (this.#deps.setting<boolean>("worktree_push_auto_setup_remote")) {
			const upstream = await git.runChecked(configSet("push.autoSetupRemote", "true"), { cwd });
			if (!upstream.ok) warnings.push(WORKTREE_CONFIG_SKIPPED_MESSAGE);
		}
		const context = await addContextFolder(git, { worktreePath: cwd, fs });
		if (!context.ok) return context;
		return ok(warnings);
	}

	/** The Worker and ids a cloud create needs, or the refusal when the project cannot go there. */
	#cloudTarget(repo: Repo, url: string): Result<{ url: string; ids: IdSource }> {
		if (cloudRepositories([repo]).length === 0) return err(cloudRepoNotGithub());
		const ids = this.#deps.ids;
		if (ids === undefined || this.#deps.cloud === undefined) return err(cloudCreateUnavailable());
		return ok({ url, ids });
	}

	/** Counts the files in the new worktree with `git ls-files`, for the Setup tab (3.1). */
	async #countWorktreeFiles(workspace: Workspace): Promise<Result<void>> {
		const listed = await this.#deps.git.run(lsFiles(), { cwd: workspace.path });
		if (!listed.ok) return listed;
		const count = listed.value.stdout.split("\n").filter((line) => line !== "").length;
		const written = await this.#deps.repos.workspaces.setFilesCopied(workspace.id, count);
		if (!written.ok) return written;
		this.#host.put({ ...workspace, filesCopied: count, updatedAt: this.#deps.now() });
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
		const remoteRead = await this.remoteFor(repo);
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

	/** Keeps the first message while a creation can still fail, so Retry and Recover have it. */
	#rememberFirstInput(id: WorkspaceId, input: NewWorkspaceInput): void {
		this.#host.store.setState((state) => ({
			...state,
			failedFirstInputs: { ...(state.failedFirstInputs ?? {}), [id]: input },
		}));
	}

	#forgetFirstInput(id: WorkspaceId): void {
		this.#host.store.setState((state) => {
			const failedFirstInputs = { ...(state.failedFirstInputs ?? {}) };
			delete failedFirstInputs[id];
			return { ...state, failedFirstInputs };
		});
	}

	/** Adds warnings the create page toasts once the action returns. */
	addWarnings(id: WorkspaceId, warnings: readonly string[]): void {
		if (warnings.length === 0) return;
		this.#host.store.setState((state) => ({
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
	async remoteFor(repo: Repo): Promise<Result<string>> {
		const configured = await this.#deps.repoConfig(repo.id);
		if (!configured.ok) return configured;
		return remoteNameFromConfig(configured.value);
	}

	/**
	 * Starts the first chat. The first message is forgotten only when the chat exists; any failure
	 * leaves it for Retry and Recover and adds a warning for the page.
	 */
	async startFirstChat(workspaceId: WorkspaceId, input: NewWorkspaceInput): Promise<void> {
		const chatInput = await this.#firstChatInput(workspaceId, input);
		if (!chatInput.ok) {
			this.addWarnings(workspaceId, [CHAT_CREATION_FAILED_MESSAGE]);
			return;
		}
		const chat = await this.#deps.sessions.createFirstChat(workspaceId, chatInput.value);
		if (!chat.ok) {
			this.addWarnings(workspaceId, [CHAT_CREATION_FAILED_MESSAGE]);
			return;
		}
		this.#forgetFirstInput(workspaceId);
		// The workspace opens on its first chat: the route reopens the remembered tab (NAV-02). If the
		// write fails, the chat is still in the tab strip; the workspace just opens with no tab chosen.
		await this.#host.setActiveSession(workspaceId, chat.value.id);
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
		if (!placed.ok) this.addWarnings(workspace.id, [SECTION_PLACEMENT_FAILED_MESSAGE]);
	}

	/** Moves a half-created workspace to failed and keeps its row (D034). */
	async fail(workspace: Workspace, error: AppError): Promise<Result<never>> {
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
		if (moved.ok && moved.value) this.#host.put(failed);
		this.#host.store.setState((state) => ({ ...state, lastFailedCreate: failed }));
		return err(error);
	}

	/** The branch prefix from the Git settings, and the warning when the GitHub login is missing. */
	async branchPrefix(repo: Repo): Promise<Result<{ prefix: string; warning: string | null }>> {
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
