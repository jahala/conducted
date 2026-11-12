/**
 * @feature WS-02 Create from a branch, PR or issue
 * Owns: resolving the create-from choice to a base commit, and creating from a local branch or a
 * pull request's head.
 * Behaviour: services-map.md 3.1 (workspace create) and 5B.8.3 (a PR or issue becomes a workspace).
 * Test first: a pull request's head is fetched from refs/pull/<n>/head and used as the base commit.
 */
import type { SessionConfig } from "@conducted/protocol";
import { appError, err, ok, type RepoId, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileSystem, ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { Repo, RepoConfig, Session, Workspace } from "../model.ts";
import { WorkspaceService, type WorkspaceServiceDeps } from "./workspace.ts";

const output = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

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

const repo: Repo = {
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

const session: Session = {
	id: "s1" as Session["id"],
	workspaceId: "w1" as WorkspaceId,
	title: null,
	config: sampleConfig,
	agentSessionId: null,
	forkResumeNativeMessageId: null,
	unreadCount: 0,
	contextUsedTokens: null,
	queuePausedAt: null,
	closedAt: null,
	lastUserMessageAt: null,
	createdAt: 1000,
	updatedAt: 1000,
};

function defaultReply(command: GitCommand, cwd: string): ShellOutput | undefined {
	if (starts(command, "git", ["rev-parse", "HEAD"]))
		return output(0, cwd.startsWith("/workspaces") ? "base-sha" : "head-sha");
	if (starts(command, "git", ["rev-parse", "--verify", "--quiet"])) return output(1);
	if (starts(command, "git", ["fetch"])) return output(0);
	if (starts(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
		return output(0, "remote-sha");
	if (starts(command, "git", ["worktree", "add"])) return output(0);
	if (starts(command, "git", ["config", "--local", "--get"])) return output(1);
	if (starts(command, "git", ["rev-parse", "--git-common-dir"])) return output(0, ".git");
	if (starts(command, "git", ["show-ref"])) return output(1);
	if (starts(command, "git", ["ls-files", "--others", "--ignored"])) return output(0);
	return undefined;
}

interface HarnessOptions {
	gitReply?: (command: GitCommand, cwd: string) => ShellOutput | undefined;
	pullRequest?: Result<{
		number: number;
		title: string;
		branch: string;
		authorLogin: string | null;
		authorAvatarUrl: string | null;
		state: "open" | "draft" | "merged" | "closed";
		updatedAt: number;
	}>;
	repoRow?: Repo | null;
}

function makeHarness(options: HarnessOptions = {}) {
	const rows: Workspace[] = [];
	const git = new FakeGitRunner((command, runOptions) =>
		ok((options.gitReply ?? defaultReply)(command, runOptions.cwd) ?? output(0)),
	);
	const fs = {
		async readText(): Promise<Result<string>> {
			return err(appError("fs_not_found", "missing"));
		},
		async writeTextAtomic(): Promise<Result<void>> {
			return ok(undefined);
		},
		async exists() {
			return ok(false);
		},
		async stat() {
			return err(appError("fs_not_found", "missing"));
		},
		async mkdirp() {
			return ok(undefined);
		},
		async readDir() {
			return ok([]);
		},
		async trash() {
			return ok(undefined);
		},
		async registerRoot() {
			return ok(undefined);
		},
		async readBytes() {
			return ok(new Uint8Array());
		},
		async writeBytes() {
			return ok(undefined);
		},
		assetUrl(path: string) {
			return `asset://localhost/${encodeURIComponent(path)}`;
		},
		paths: { home: "/Users/test", appData: "/app", temp: "/tmp", resources: "/res" },
	} satisfies FileSystem;
	const workspaces = {
		async listAll() {
			return ok([...rows]);
		},
		async listByRepo() {
			return ok(rows);
		},
		async listByState() {
			return ok(rows);
		},
		async get(id: WorkspaceId) {
			const row = rows.find((candidate) => candidate.id === id);
			return ok(row === undefined ? null : { ...row });
		},
		async getSetupLogPath() {
			return ok(null);
		},
		async listDirectoryNames() {
			return ok(rows.map((row) => row.directoryName));
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
				remoteFileSyncEnabled: false,
				host: { kind: "local" },
				displayName: null,
				targetBranch: input.targetBranch,
				state: "initializing",
				kanbanStatus: "in_progress",
				port: input.port,
				pinnedAt: null,
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
			};
			rows.push(workspace);
			return ok(workspace);
		},
		async transitionState(id: WorkspaceId, from: Workspace["state"], to: Workspace["state"]) {
			const workspace = rows.find((row) => row.id === id);
			if (workspace === undefined || workspace.state !== from) return ok(false);
			workspace.state = to;
			return ok(true);
		},
		async setFilesCopied() {
			return ok(undefined);
		},
		async setSetupLogPath() {
			return ok(undefined);
		},
	};
	const settings: Record<string, unknown> = {
		conductor_root_path: "~/conducted",
		branch_prefix_type: "none",
		branch_prefix_custom: "",
		worktree_push_auto_setup_remote: true,
	};
	// seam: WS-02 base resolution reads only the repository, git and GitHub ports.
	const deps = {
		platform: { fs, opener: {} },
		git,
		repos: {
			repos: {
				async get(id: RepoId) {
					if (options.repoRow === null) return ok(null);
					return id === repo.id ? ok(options.repoRow ?? repo) : ok(null);
				},
			},
			workspaces,
			sessions: {},
			sections: { moveWorkspace: async () => ok(undefined) },
			backlogWorkspaces: { list: async () => ok([]) },
		},
		placeNames: { pick: () => "oslo" },
		sessions: {
			createFirstChat: async () => ok(session),
			firstDraftOf: async () => ok({ text: "", attachmentPaths: [] }),
			cancelAll: async () => ok(undefined),
			hasWorkingChats: () => false,
			markAllRead: async () => ok(undefined),
			deleteAll: async () => ok(undefined),
		},
		ports: { allocateForNewWorkspace: async () => ok(55_000) },
		repoConfig: async (): Promise<Result<RepoConfig>> => ok({ remoteName: null } as RepoConfig),
		github: {
			pullRequestByNumber: async () =>
				options.pullRequest ??
				ok({
					number: 42,
					title: "Add the login form",
					branch: "feature/login",
					authorLogin: "ada",
					authorAvatarUrl: null,
					state: "open" as const,
					updatedAt: 1000,
				}),
		},
		scripts: {
			runSetup: async () => ok({ exitCode: 0 }),
			runArchive: async () => ok(undefined),
			stopWorkspace: async () => ok(undefined),
			clearRuns: () => {},
		},
		checkpointerPath: "/scripts/checkpointer.sh",
		setting: <T>(key: string) => settings[key] as T,
		now: () => 1000,
	} as unknown as WorkspaceServiceDeps;
	return { service: new WorkspaceService(deps), rows, git };
}

describe("WS-02 resolveBase", () => {
	it("uses an existing local branch without fetching it", async () => {
		const { service, git } = makeHarness({
			gitReply: (command) =>
				starts(command, "git", ["rev-parse", "--verify", "--quiet", "refs/heads/feature"])
					? output(0, "local-sha")
					: undefined,
		});

		const result = await service.resolveBase(repo.id, { kind: "branch", name: " feature " });

		expect(result).toEqual({
			ok: true,
			value: { baseSha: "local-sha", branchName: "feature", warning: null },
		});
		expect(git.commands.some((command) => command.args[0] === "fetch")).toBe(false);
	});

	it("fetches a pull request's head from refs/pull/<n>/head", async () => {
		const { service, git } = makeHarness({
			gitReply: (command) =>
				starts(command, "git", ["rev-parse", "refs/conducted/pull/42"])
					? output(0, "pr-head-sha")
					: undefined,
		});

		const result = await service.resolveBase(repo.id, { kind: "pull_request", number: 42 });

		expect(result).toEqual({
			ok: true,
			value: { baseSha: "pr-head-sha", branchName: "main", warning: null },
		});
		const fetch = git.commands.find((command) => command.args[0] === "fetch");
		expect(fetch?.args).toContain("refs/pull/42/head:refs/conducted/pull/42");
	});

	it("says a pull request could not be loaded when GitHub has no such PR", async () => {
		const { service } = makeHarness({
			pullRequest: err(appError("github_failed", "No pull request #99")),
		});

		const result = await service.resolveBase(repo.id, { kind: "pull_request", number: 99 });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toBe("Could not load that pull request");
	});

	it("starts an issue on the repository's default branch", async () => {
		const { service } = makeHarness();

		const result = await service.resolveBase(repo.id, {
			kind: "issue",
			provider: "github",
			id: "7",
		});

		expect(result).toEqual({
			ok: true,
			value: { baseSha: "remote-sha", branchName: "main", warning: null },
		});
	});

	it("says no repository was selected for a PR or issue without one", async () => {
		const { service } = makeHarness({ repoRow: null });

		const pull = await service.resolveBase(repo.id, { kind: "pull_request", number: 1 });
		const issue = await service.resolveBase(repo.id, {
			kind: "issue",
			provider: "github",
			id: "7",
		});

		expect(!pull.ok && pull.error.message).toBe("No repository selected");
		expect(!issue.ok && issue.error.message).toBe("No repository selected");
	});
});

describe("WS-02 create", () => {
	const input = {
		repoId: repo.id,
		from: { kind: "branch" as const, name: "feature" },
		prompt: "",
		attachmentPaths: [],
		config: sampleConfig,
		sectionId: null,
	};

	it("creates a workspace from an existing local branch at its commit", async () => {
		const { service, rows, git } = makeHarness({
			gitReply: (command) => {
				if (starts(command, "git", ["rev-parse", "--verify", "--quiet", "refs/heads/feature"]))
					return output(0, "local-sha");
				return defaultReply(command, "/repo");
			},
		});

		const result = await service.create(input);

		expect(result.ok).toBe(true);
		expect(rows[0]?.targetBranch).toBe("feature");
		const add = git.commands.find((command) => command.args[0] === "worktree");
		expect(add?.args).toContain("local-sha");
		expect(git.commands.some((command) => command.args[0] === "fetch")).toBe(false);
	});

	it("refuses to create from a PR or issue with no repository chosen", async () => {
		const { service } = makeHarness({ repoRow: null });

		const pull = await service.create({
			...input,
			from: { kind: "pull_request", number: 42 },
		});
		const issue = await service.create({
			...input,
			from: { kind: "issue", provider: "github", id: "7" },
		});

		expect(!pull.ok && pull.error.message).toBe("No repository selected");
		expect(!issue.ok && issue.error.message).toBe("No repository selected");
	});

	it("starts a pull request's workspace on the PR head commit", async () => {
		const { service, rows, git } = makeHarness({
			gitReply: (command) => {
				if (starts(command, "git", ["rev-parse", "refs/conducted/pull/42"]))
					return output(0, "pr-head-sha");
				return defaultReply(command, "/repo");
			},
		});

		const result = await service.create({
			...input,
			from: { kind: "pull_request", number: 42 },
		});

		expect(result.ok).toBe(true);
		expect(rows[0]?.targetBranch).toBe("main");
		const add = git.commands.find((command) => command.args[0] === "worktree");
		expect(add?.args).toContain("pr-head-sha");
	});
});
