import type { SessionConfig } from "@conducted/protocol";
import {
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { FileSystem, ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "../git/commands.ts";
import { type GitRunner, isSuccessfulExit } from "../git/runner.ts";
import type { Repo, Session, Workspace } from "../model.ts";
import {
	baseBranchFor,
	branchPrefixFor,
	classifyUnarchive,
	expandHome,
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
	calls: { command: GitCommand; cwd: string }[];
}

function makeHarness(
	options: {
		rows?: Workspace[];
		settings?: Record<string, unknown>;
		exists?: boolean;
		draft?: { text: string; attachmentPaths: string[] };
		gitReply?: (command: GitCommand, cwd: string) => ShellOutput | undefined;
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
			return ok(rows.find((row) => row.id === id) ?? null);
		},
		async getByPath(path: string) {
			return ok(rows.find((row) => row.path === path) ?? null);
		},
		async getSetupLogPath() {
			return ok(null);
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

	const createFirstChat = vi.fn(async () => ok(sampleSession));
	const firstDraftOf = vi.fn(async () =>
		ok(options.draft ?? { text: "Fix the login bug", attachmentPaths: [] }),
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

	it("keeps the row and marks it failed when the worktree cannot be made", async () => {
		const { service, rows, createFirstChat } = makeHarness({
			gitReply: (command, _cwd) => {
				if (matches(command, "git", ["rev-parse", "HEAD"])) return output(0, "head-sha");
				if (starts(command, "git", ["fetch"])) return output(0);
				if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
					return output(0, "base-sha");
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
