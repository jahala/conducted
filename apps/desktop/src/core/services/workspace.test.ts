import type { SessionConfig } from "@conducted/protocol";
import {
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type SectionId,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { FileSystem, ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import { type GitRunner, isSuccessfulExit } from "../git/runner.ts";
import { OFFLINE_FALLBACK_MESSAGE } from "../git/worktree.ts";
import type { Repo, RepoConfig, Session, Workspace } from "../model.ts";
import {
	baseBranchFor,
	branchPrefixFor,
	CHAT_CREATION_FAILED_MESSAGE,
	classifyUnarchive,
	createPlaceNames,
	expandHome,
	isSafeRefName,
	SECTION_PLACEMENT_FAILED_MESSAGE,
	WorkspaceService,
	type WorkspaceServiceDeps,
	worktreeFolderFor,
} from "./workspace.ts";

const output = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

const matches = (command: GitCommand, program: string, args: readonly string[]): boolean =>
	command.program === program &&
	command.args.length === args.length &&
	args.every((arg, index) => command.args[index] === arg);

const starts = (command: GitCommand, program: string, args: readonly string[]): boolean =>
	command.program === program && args.every((arg, index) => command.args[index] === arg);

const sampleConfig: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const baseRepo: Repo = {
	id: "r1" as RepoId,
	name: "Project",
	rootPath: "/repo",
	remoteUrl: "git@github.com:me/project.git",
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1000,
	updatedAt: 1000,
};

const sampleSession: Session = {
	id: "s1" as SessionId,
	workspaceId: "w1" as WorkspaceId,
	title: null,
	config: sampleConfig,
	agentSessionId: null,
	unreadCount: 0,
	contextUsedTokens: null,
	contextWindowTokens: null,
	queuePausedAt: null,
	closedAt: null,
	lastUserMessageAt: null,
	createdAt: 1000,
	updatedAt: 1000,
};

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "w1" as WorkspaceId,
		repoId: baseRepo.id,
		directoryName: "oslo",
		path: "/Users/test/conducted/workspaces/Project/oslo",
		branch: "oslo",
		branchIsPlaceholder: true,
		displayName: null,
		targetBranch: "main",
		state: "failed",
		kanbanStatus: "in_progress",
		port: 55_000,
		pinnedAt: null,
		notes: null,
		linkedPaths: [],
		prNumber: null,
		prTitle: null,
		prDescription: null,
		archiveCommit: null,
		archivedAt: null,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 1000,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

function makeRunner(reply: (command: GitCommand, cwd: string) => ShellOutput | undefined): {
	git: GitRunner;
	calls: { command: GitCommand; cwd: string }[];
} {
	const calls: { command: GitCommand; cwd: string }[] = [];
	const answer = (command: GitCommand, cwd: string): ShellOutput =>
		reply(command, cwd) ?? output(0);
	const run: GitRunner["run"] = async (command, options) => {
		calls.push({ command, cwd: options.cwd });
		return ok(answer(command, options.cwd));
	};
	const runChecked: GitRunner["runChecked"] = async (command, options) => {
		const result = await run(command, options);
		if (!result.ok) return result;
		return isSuccessfulExit(command, result.value.exitCode)
			? result
			: err(appError("git_failed", result.value.stderr.trim() || "git failed"));
	};
	const stdout: GitRunner["stdout"] = async (command, options) => {
		const result = await runChecked(command, options);
		return result.ok ? ok(result.value.stdout.trim()) : result;
	};
	return {
		calls,
		git: {
			run,
			runChecked,
			stdout,
			async start() {
				throw new Error("start is not used in these tests");
			},
			async withWorktreeLock(_path, work) {
				return work();
			},
			async withWorktreeAndRepoLocks(_worktree, _root, work) {
				return work();
			},
		},
	};
}

function defaultGitReply(worktreePath: string) {
	return (command: GitCommand, cwd: string): ShellOutput | undefined => {
		if (matches(command, "git", ["rev-parse", "HEAD"]))
			return output(0, cwd === worktreePath ? "base-sha" : "head-sha");
		if (starts(command, "git", ["fetch"])) return output(0);
		if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
			return output(0, "base-sha");
		if (starts(command, "git", ["worktree", "add"])) return output(0);
		if (matches(command, "git", ["config", "--local", "--get", "core.worktree"])) return output(1);
		if (matches(command, "git", ["config", "--local", "--get", "core.bare"])) return output(1);
		if (matches(command, "git", ["rev-parse", "--git-common-dir"])) return output(0, ".git");
		if (starts(command, "git", ["show-ref"])) return output(1);
		return undefined;
	};
}

interface Harness {
	service: WorkspaceService;
	rows: Workspace[];
	createFirstChat: ReturnType<typeof vi.fn>;
	firstDraftOf: ReturnType<typeof vi.fn>;
	moveWorkspace: ReturnType<typeof vi.fn>;
	calls: { command: GitCommand; cwd: string }[];
}

function makeHarness(
	options: {
		rows?: Workspace[];
		settings?: Record<string, unknown>;
		exists?: boolean;
		draft?: { text: string; attachmentPaths: string[] };
		gitReply?: (command: GitCommand, cwd: string) => ShellOutput | undefined;
		chatFails?: boolean;
		draftMissing?: boolean;
		repoRemoteName?: string | null;
		defaultConfigValue?: SessionConfig;
		moveFails?: boolean;
		setupLogPathError?: boolean;
		repoConfigError?: boolean;
		defaultConfigError?: boolean;
	} = {},
): Harness {
	const rows = options.rows ?? [];
	const settings: Record<string, unknown> = {
		conducted_root_path: "~/conducted",
		branch_prefix_type: "none",
		branch_prefix_custom: "",
		worktree_push_auto_setup_remote: true,
		...options.settings,
	};
	const worktreePath = worktreeFolderFor("/Users/test/conducted", "Project", "oslo");
	const { git, calls } = makeRunner(options.gitReply ?? defaultGitReply(worktreePath));
	const made: string[] = [];
	const texts = new Map<string, string>();
	const fs = {
		async readText(path: string): Promise<Result<string>> {
			const text = texts.get(path);
			return text === undefined ? err(appError("fs_not_found", "missing")) : ok(text);
		},
		async writeTextAtomic(path: string, text: string): Promise<Result<void>> {
			texts.set(path, text);
			return ok(undefined);
		},
		async exists() {
			return options.exists ?? false;
		},
		async stat() {
			return err(appError("fs_not_found", "missing"));
		},
		async mkdirp(path: string) {
			made.push(path);
			return ok(undefined);
		},
		async readDir() {
			return ok([]);
		},
		async trash() {
			return ok(undefined);
		},
		paths: { home: "/Users/test", appData: "/app", temp: "/tmp", resources: "/res" },
	} satisfies FileSystem;

	const workspaces = {
		async listAll() {
			return ok([...rows]);
		},
		async listByRepo(repoId: RepoId) {
			return ok(rows.filter((row) => row.repoId === repoId));
		},
		async listByState(state: Workspace["state"]) {
			return ok(rows.filter((row) => row.state === state));
		},
		async get(id: WorkspaceId) {
			// A database hands out a new object on every read, so a later change does not reach it.
			const row = rows.find((candidate) => candidate.id === id);
			return ok(row === undefined ? null : { ...row });
		},
		async getByPath(path: string) {
			return ok(rows.find((row) => row.path === path) ?? null);
		},
		async getSetupLogPath() {
			return options.setupLogPathError === true
				? err(appError("db.failed", "The setup log path could not be read."))
				: ok(null);
		},
		async listDirectoryNames(repoId: RepoId) {
			return ok(rows.filter((row) => row.repoId === repoId).map((row) => row.directoryName));
		},
		async listPorts() {
			return ok(rows.map((row) => row.port));
		},
		async create(input: {
			repoId: RepoId;
			directoryName: string;
			path: string;
			branch: string;
			branchIsPlaceholder: boolean;
			targetBranch: string;
			port: number;
			linkedPaths: string[];
			setupLogPath: string | null;
		}) {
			const workspace: Workspace = {
				id: `w-${rows.length + 1}` as WorkspaceId,
				repoId: input.repoId,
				directoryName: input.directoryName,
				path: input.path,
				branch: input.branch,
				branchIsPlaceholder: input.branchIsPlaceholder,
				displayName: null,
				targetBranch: input.targetBranch,
				state: "initializing",
				kanbanStatus: "in_progress",
				port: input.port,
				pinnedAt: null,
				notes: null,
				linkedPaths: [...input.linkedPaths],
				prNumber: null,
				prTitle: null,
				prDescription: null,
				archiveCommit: null,
				archivedAt: null,
				activeSessionId: null,
				filesCopied: null,
				lastActivityAt: 1000,
				createdAt: 1000,
				updatedAt: 1000,
			};
			rows.push(workspace);
			return ok(workspace);
		},
		async transitionState(id: WorkspaceId, from: Workspace["state"], to: Workspace["state"]) {
			const workspace = rows.find((row) => row.id === id);
			if (workspace === undefined || workspace.state !== from) return ok(false);
			workspace.state = to;
			workspace.updatedAt = 1000;
			return ok(true);
		},
		async markArchived() {
			return ok(false);
		},
		async setKanbanStatus() {
			return ok(undefined);
		},
		async setDisplayName(id: WorkspaceId, name: string | null) {
			const workspace = rows.find((row) => row.id === id);
			if (workspace === undefined) return err(appError("db.not_found", "missing"));
			workspace.displayName = name;
			return ok(undefined);
		},
		async setBranch() {
			return ok(undefined);
		},
		async setTargetBranch() {
			return ok(undefined);
		},
		async setPinned() {
			return ok(undefined);
		},
		async setNotes() {
			return ok(undefined);
		},
		async setLinkedPaths() {
			return ok(undefined);
		},
		async setPullRequest() {
			return ok(undefined);
		},
		async clearPullRequest() {
			return ok(undefined);
		},
		async setSetupLogPath() {
			return ok(undefined);
		},
		async setActiveSession() {
			return ok(undefined);
		},
		async setFilesCopied() {
			return ok(undefined);
		},
		async touchActivity() {
			return ok(undefined);
		},
		async delete() {
			return ok(undefined);
		},
	};

	const createFirstChat = vi.fn(async () =>
		options.chatFails === true
			? err(appError("chat_failed", "The agent could not start."))
			: ok(sampleSession),
	);
	const firstDraftOf = vi.fn(async () =>
		options.draftMissing === true
			? err(appError("workspace_draft_missing", "This workspace has no first message to recover."))
			: ok(options.draft ?? { text: "Fix the login bug", attachmentPaths: [] }),
	);
	const moveWorkspace = vi.fn(async () =>
		options.moveFails === true ? err(appError("section_missing", "missing")) : ok(undefined),
	);

	const deps = {
		platform: { fs, opener: {} },
		git,
		repos: {
			repos: {
				async get(id: RepoId) {
					return id === baseRepo.id ? ok(baseRepo) : ok(null);
				},
			},
			workspaces,
			sessions: {},
			sections: { moveWorkspace },
		},
		placeNames: { pick: () => "oslo" },
		sessions: {
			createFirstChat,
			firstDraftOf,
			cancelAll: async () => ok(undefined),
			hasWorkingChats: () => false,
			markAllRead: async () => ok(undefined),
			deleteAll: async () => ok(undefined),
		},
		ports: { allocateForNewWorkspace: async () => ok(55_000) },
		repoConfig: async (): Promise<Result<RepoConfig>> =>
			options.repoConfigError === true
				? err(appError("settings_invalid", "settings.toml is invalid."))
				: ok({ remoteName: options.repoRemoteName ?? null } as RepoConfig),
		defaultConfig: async () =>
			options.defaultConfigError === true
				? err(appError("config_failed", "The default config could not be read."))
				: ok(options.defaultConfigValue ?? sampleConfig),
		scripts: {
			runSetup: async () => ok({ exitCode: 0 }),
			runArchive: async () => ok(undefined),
			stopWorkspace: async () => ok(undefined),
		},
		setting: <T>(key: string) => settings[key] as T,
		now: () => 1000,
	} as unknown as WorkspaceServiceDeps;

	return {
		service: new WorkspaceService(deps),
		rows,
		createFirstChat,
		firstDraftOf,
		moveWorkspace,
		calls,
	};
}

const newInput = {
	repoId: baseRepo.id,
	from: { kind: "default" as const },
	prompt: "Fix the login bug",
	attachmentPaths: [],
	config: sampleConfig,
	sectionId: null,
};

describe("WS-01 classifyUnarchive", () => {
	const base = {
		branchExists: true,
		checkedOutElsewhere: false,
		branchTip: "abc",
		archiveCommit: "abc",
	};
	it("is happy when the branch is where it was left", () => {
		expect(classifyUnarchive(base)).toBe("happy");
	});
	it("reports a deleted branch first", () => {
		expect(classifyUnarchive({ ...base, branchExists: false, checkedOutElsewhere: true })).toBe(
			"branchDeleted",
		);
	});
	it("reports a branch checked out elsewhere", () => {
		expect(classifyUnarchive({ ...base, checkedOutElsewhere: true })).toBe("branchTaken");
	});
	it("reports a branch that moved", () => {
		expect(classifyUnarchive({ ...base, branchTip: "def" })).toBe("branchDiverged");
	});
});

describe("WS-01 naming", () => {
	it("builds the branch prefix from the setting", () => {
		expect(branchPrefixFor("github_username", "feature/", "me")).toBe("me/");
		expect(branchPrefixFor("custom", "feature/", "me")).toBe("feature/");
		expect(branchPrefixFor("none", "feature/", "me")).toBe("");
		expect(branchPrefixFor("github_username", "", null)).toBe("");
	});
	it("expands a leading tilde in the root folder", () => {
		expect(expandHome("~/conducted", "/Users/test")).toBe("/Users/test/conducted");
		expect(expandHome("/tmp/root", "/Users/test")).toBe("/tmp/root");
	});
	it("puts worktrees under workspaces/repo/place", () => {
		expect(worktreeFolderFor("/Users/test/conducted", "Project", "oslo")).toBe(
			"/Users/test/conducted/workspaces/Project/oslo",
		);
	});
	it("resolves the base branch from the create-from choice", () => {
		expect(baseBranchFor("main", { kind: "default" })).toEqual({ ok: true, value: "main" });
		expect(baseBranchFor("main", { kind: "branch", name: " dev " })).toEqual({
			ok: true,
			value: "dev",
		});
		expect(baseBranchFor("main", { kind: "branch", name: "" }).ok).toBe(false);
	});
});

describe("WS-01 createPlaceNames", () => {
	it("never returns a name that is already taken", () => {
		const source = createPlaceNames(() => 0.25);
		const taken = new Set<string>();
		for (let i = 0; i < 80; i++) {
			const name = source.pick(taken);
			expect(taken.has(name)).toBe(false);
			taken.add(name);
		}
	});

	it("falls back to a suffixed name once every tier is taken", () => {
		const source = createPlaceNames(() => 0.5);
		const taken = new Set<string>();
		for (let i = 0; i < 400; i++) taken.add(source.pick(taken));
		const name = source.pick(taken);
		expect(taken.has(name)).toBe(false);
	});
});

describe("WS-01 WorkspaceService.start", () => {
	it("loads the stored workspaces into the store", async () => {
		const workspace = makeWorkspace();
		const { service } = makeHarness({ rows: [workspace] });

		const result = await service.start();

		expect(result.ok).toBe(true);
		expect(service.store.getState().loaded).toBe(true);
		expect(service.store.getState().workspacesById[workspace.id]).toEqual(workspace);
	});
});

describe("WS-01 WorkspaceService.create", () => {
	it("picks a place name and port, creates the worktree, and starts the first chat", async () => {
		const { service, rows, createFirstChat } = makeHarness();

		const result = await service.create(newInput);

		expect(result.ok).toBe(true);
		expect(rows[0]).toMatchObject({
			directoryName: "oslo",
			path: "/Users/test/conducted/workspaces/Project/oslo",
			branch: "oslo",
			targetBranch: "main",
			port: 55_000,
			state: "ready",
		});
		expect(createFirstChat).toHaveBeenCalledTimes(1);
		expect(createFirstChat.mock.calls[0]?.[1]).toEqual(newInput);
		const stored = service.store.getState().workspacesById[rows[0]?.id ?? ""];
		expect(stored?.state).toBe("ready");
	});

	it("uses the custom branch prefix", async () => {
		const { service, rows } = makeHarness({
			settings: { branch_prefix_type: "custom", branch_prefix_custom: "feature/" },
		});

		const result = await service.create({ ...newInput, prompt: "" });

		expect(result.ok).toBe(true);
		expect(rows[0]?.branch).toBe("feature/oslo");
	});

	it("keeps the fetch fallback warning for the page to show", async () => {
		const { service, rows } = makeHarness({
			gitReply: (command, cwd) => {
				if (matches(command, "git", ["rev-parse", "HEAD"]))
					return output(
						0,
						cwd === "/Users/test/conducted/workspaces/Project/oslo" ? "cached" : "head-sha",
					);
				if (starts(command, "git", ["fetch"]))
					return output(128, "", "fatal: Could not resolve host: github.com");
				if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
					return output(0, "cached");
				if (starts(command, "git", ["worktree", "add"])) return output(0);
				if (matches(command, "git", ["rev-parse", "--git-common-dir"])) return output(0, ".git");
				if (starts(command, "git", ["show-ref"])) return output(1);
				return undefined;
			},
		});

		const result = await service.create(newInput);
		expect(result.ok).toBe(true);
		expect(service.store.getState().warnings?.[rows[0]?.id ?? ""] ?? []).toContain(
			OFFLINE_FALLBACK_MESSAGE,
		);
	});

	it("keeps the workspace when the first chat fails and warns separately", async () => {
		const { service, rows } = makeHarness({ chatFails: true });

		const result = await service.create(newInput);

		expect(result.ok).toBe(true);
		expect(rows[0]?.state).toBe("ready");
		expect(service.store.getState().warnings?.[rows[0]?.id ?? ""] ?? []).toContain(
			CHAT_CREATION_FAILED_MESSAGE,
		);
	});

	it("keeps the first message of a failed creation for Recover and Retry", async () => {
		let adds = 0;
		const { service, rows, createFirstChat } = makeHarness({
			draftMissing: true,
			gitReply: (command) => {
				if (matches(command, "git", ["rev-parse", "HEAD"])) return output(0, "head-sha");
				if (starts(command, "git", ["fetch"])) return output(0);
				if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
					return output(0, "base-sha");
				if (starts(command, "git", ["worktree", "add"])) {
					adds++;
					return adds === 1 ? output(128, "", "fatal: cannot create worktree") : output(0);
				}
				if (matches(command, "git", ["worktree", "list", "--porcelain"])) return output(0, "");
				if (matches(command, "git", ["rev-parse", "--git-common-dir"])) return output(0, ".git");
				if (starts(command, "git", ["show-ref"])) return output(1);
				return undefined;
			},
		});

		const failed = await service.create(newInput);
		expect(failed.ok).toBe(false);
		const id = (rows[0]?.id ?? "") as WorkspaceId;
		expect(service.store.getState().lastFailedCreate?.id).toBe(id);

		const recovered = await service.recoverPrompt(id);
		expect(recovered).toEqual(
			ok({ text: newInput.prompt, attachmentPaths: newInput.attachmentPaths }),
		);

		const retried = await service.retrySetup(id);
		expect(retried.ok).toBe(true);
		expect(createFirstChat).toHaveBeenCalledTimes(1);
		expect(createFirstChat.mock.calls[0]?.[1]).toMatchObject({ prompt: newInput.prompt });
	});

	it("adds the workspace to the chosen section and warns when that fails", async () => {
		const { service, rows, moveWorkspace } = makeHarness({ moveFails: true });
		const sectionId = "s1" as SectionId;

		const result = await service.create({ ...newInput, sectionId });

		expect(result.ok).toBe(true);
		expect(moveWorkspace).toHaveBeenCalledWith(rows[0]?.id, sectionId);
		expect(service.store.getState().warnings?.[rows[0]?.id ?? ""] ?? []).toContain(
			SECTION_PLACEMENT_FAILED_MESSAGE,
		);
	});

	it("gives two creates started together different folders and ports", async () => {
		const { service, rows } = makeHarness();

		const [first, second] = await Promise.all([
			service.create({ ...newInput, prompt: "" }),
			service.create({ ...newInput, prompt: "" }),
		]);

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		expect(rows.map((row) => row.directoryName).sort()).toEqual(["oslo", "oslo-v1"]);
		expect(rows.map((row) => row.port).sort()).toEqual([55_000, 55_010]);
	});

	it("fetches from the remote the repository config names", async () => {
		const { service, calls } = makeHarness({
			repoRemoteName: "upstream",
			gitReply: (command, cwd) => {
				if (matches(command, "git", ["rev-parse", "HEAD"]))
					return output(
						0,
						cwd === "/Users/test/conducted/workspaces/Project/oslo" ? "base-sha" : "head-sha",
					);
				if (starts(command, "git", ["fetch"])) return output(0);
				if (matches(command, "git", ["rev-parse", "refs/remotes/upstream/main"]))
					return output(0, "base-sha");
				if (starts(command, "git", ["worktree", "add"])) return output(0);
				if (matches(command, "git", ["rev-parse", "--git-common-dir"])) return output(0, ".git");
				if (starts(command, "git", ["show-ref"])) return output(1);
				return undefined;
			},
		});

		const result = await service.create(newInput);

		expect(result.ok).toBe(true);
		const fetch = calls.find((call) => call.command.args[0] === "fetch");
		expect(fetch?.command.args).toContain("upstream");
	});

	it("builds the first chat from the app's default config and the user's choices", async () => {
		const defaults: SessionConfig = {
			...sampleConfig,
			model: "default-model",
			effort: "low",
			appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
		};
		const requested: SessionConfig = {
			...sampleConfig,
			model: "chosen-model",
			effort: "max",
			planMode: true,
			appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
		};
		const { service, createFirstChat } = makeHarness({ defaultConfigValue: defaults });

		const result = await service.create({ ...newInput, config: requested });

		expect(result.ok).toBe(true);
		expect(createFirstChat.mock.calls[0]?.[1]).toMatchObject({
			config: {
				model: "chosen-model",
				effort: "low",
				planMode: true,
				appTools: defaults.appTools,
			},
		});
	});

	it("keeps the row and marks it failed when the worktree cannot be made", async () => {
		const { service, rows, createFirstChat } = makeHarness({
			gitReply: (command, _cwd) => {
				if (matches(command, "git", ["rev-parse", "HEAD"])) return output(0, "head-sha");
				if (starts(command, "git", ["fetch"])) return output(0);
				if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
					return output(0, "base-sha");
				if (matches(command, "git", ["rev-parse", "--git-common-dir"])) return output(0, ".git");
				if (starts(command, "git", ["show-ref"])) return output(1);
				if (starts(command, "git", ["worktree", "add"]))
					return output(128, "", "fatal: cannot create worktree");
				if (matches(command, "git", ["worktree", "list", "--porcelain"])) return output(0, "");
				return undefined;
			},
		});

		const result = await service.create(newInput);

		expect(result.ok).toBe(false);
		expect(rows[0]?.state).toBe("failed");
		expect(service.store.getState().workspacesById[rows[0]?.id ?? ""]?.state).toBe("failed");
		expect(createFirstChat).not.toHaveBeenCalled();
	});
});

describe("WS-01 WorkspaceService.rename", () => {
	it("sets the display name and updates the store", async () => {
		const workspace = makeWorkspace({ state: "ready" });
		const { service, rows } = makeHarness({ rows: [workspace] });

		const result = await service.rename(workspace.id, "  Login fix  ");

		expect(result.ok).toBe(true);
		expect(rows[0]?.displayName).toBe("Login fix");
		expect(service.store.getState().workspacesById[workspace.id]?.displayName).toBe("Login fix");
	});
});

describe("WS-01 WorkspaceService.retrySetup", () => {
	it("prepares the existing worktree again and returns to ready", async () => {
		const workspace = makeWorkspace({ state: "failed" });
		const { service, rows } = makeHarness({ rows: [workspace], exists: true });

		const result = await service.retrySetup(workspace.id);

		expect(result.ok).toBe(true);
		expect(rows[0]?.state).toBe("ready");
	});
});

describe("WS-01 WorkspaceService.recoverPrompt", () => {
	it("returns the first chat's draft", async () => {
		const workspace = makeWorkspace();
		const { service, firstDraftOf } = makeHarness({
			rows: [workspace],
			draft: { text: "Fix the login bug", attachmentPaths: ["/tmp/shot.png"] },
		});

		const result = await service.recoverPrompt(workspace.id);

		expect(result).toEqual({
			ok: true,
			value: { text: "Fix the login bug", attachmentPaths: ["/tmp/shot.png"] },
		});
		expect(firstDraftOf).toHaveBeenCalledWith(workspace.id);
	});
});

describe("WS-01 names that git or gh could read as options", () => {
	it("accepts ordinary branch names and refuses the ones git refuses", () => {
		for (const good of ["oslo", "me/oslo", "feature/x-1", "v1.2"]) {
			expect(isSafeRefName(good), good).toBe(true);
		}
		for (const bad of [
			"",
			"-oslo",
			"--upload-pack=sh",
			"/oslo",
			"oslo/",
			"a..b",
			"a b",
			"a~1",
			"a:b",
			"a\\b",
			"a//b",
			"x.lock",
			".hidden/x",
			"a@{1}",
			"a\nb",
		]) {
			expect(isSafeRefName(bad), JSON.stringify(bad)).toBe(false);
		}
	});

	it("refuses to create a workspace when the branch prefix makes an unsafe branch", async () => {
		const { service, rows, calls } = makeHarness({
			settings: { branch_prefix_type: "custom", branch_prefix_custom: "-x/" },
		});

		const result = await service.create({ ...newInput, prompt: "" });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("workspace_branch_invalid");
		expect(rows).toHaveLength(0);
		expect(calls.some((call) => call.command.args.includes("worktree"))).toBe(false);
	});

	it("refuses a remote name from the repository config that starts with a dash", async () => {
		const { service, rows, calls } = makeHarness({ repoRemoteName: "--upload-pack=sh" });

		const result = await service.create({ ...newInput, prompt: "" });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("workspace_branch_invalid");
		expect(rows).toHaveLength(0);
		expect(calls.some((call) => call.command.args[0] === "fetch")).toBe(false);
	});

	it("refuses a base branch that starts with a dash", () => {
		const result = baseBranchFor("main", { kind: "branch", name: "--output=/tmp/x" });
		expect(result.ok).toBe(false);
	});
});

describe("WS-01 failures that must reach the user", () => {
	it("warns when the repository config cannot be read, instead of silently using origin", async () => {
		const { service, rows } = makeHarness({ repoConfigError: true });

		const result = await service.create({ ...newInput, prompt: "" });

		expect(result.ok).toBe(true);
		const warnings = service.store.getState().warnings?.[rows[0]?.id ?? ""] ?? [];
		expect(warnings.some((warning) => warning.includes("settings.toml is invalid."))).toBe(true);
	});

	it("does not start the first chat with a guessed config when the default config fails", async () => {
		const { service, rows, createFirstChat } = makeHarness({ defaultConfigError: true });

		const result = await service.create(newInput);

		expect(result.ok).toBe(true);
		expect(createFirstChat).not.toHaveBeenCalled();
		const id = rows[0]?.id ?? "";
		expect(service.store.getState().warnings?.[id]).toContain(CHAT_CREATION_FAILED_MESSAGE);
		expect(service.store.getState().failedFirstInputs?.[id]).toEqual(newInput);
	});

	it("loads the workspaces but returns the error when a setup log path cannot be read", async () => {
		const workspace = makeWorkspace({ state: "ready" });
		const { service } = makeHarness({ rows: [workspace], setupLogPathError: true });

		const result = await service.start();

		expect(result.ok).toBe(false);
		expect(service.store.getState().loaded).toBe(true);
		expect(service.store.getState().workspacesById[workspace.id]).toBeDefined();
	});
});

describe("WS-01 retrySetup pressed twice", () => {
	it("prepares the worktree once when two retries start together", async () => {
		const workspace = makeWorkspace({ state: "failed" });
		const { service, calls } = makeHarness({ rows: [workspace], exists: true });

		const [first, second] = await Promise.all([
			service.retrySetup(workspace.id),
			service.retrySetup(workspace.id),
		]);

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		const copyListings = calls.filter((call) => call.command.args.includes("--others"));
		expect(copyListings).toHaveLength(1);
	});
});
