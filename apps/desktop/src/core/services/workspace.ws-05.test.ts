import { appError, err, ok, type RepoId, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { FileSystem, ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { ArchivingWorkspace } from "../db/repair.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import type { Repo, Workspace } from "../model.ts";
import { WorkspaceService, type WorkspaceServiceDeps } from "./workspace.ts";

const output = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

const sameArgs = (command: GitCommand, args: readonly string[]): boolean =>
	command.program === "git" &&
	command.args.length === args.length &&
	args.every((arg, index) => command.args[index] === arg);

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

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "w1" as WorkspaceId,
		repoId: baseRepo.id,
		directoryName: "oslo",
		path: "/worktrees/oslo",
		branch: "feature/oslo",
		branchIsPlaceholder: false,
		host: { kind: "local" },
		displayName: null,
		targetBranch: "main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 55_000,
		pinnedAt: null,
		notes: null,
		linkedPaths: [],
		prNumber: 7,
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

function makeRunner(options: {
	currentBranch?: string | null;
	worktreeRemoveCode?: number;
	branchDeleteFails?: boolean;
}): {
	git: GitRunner;
	calls: { command: GitCommand; cwd: string }[];
} {
	const calls: { command: GitCommand; cwd: string }[] = [];
	const reply = (command: GitCommand): ShellOutput => {
		if (command.program === "/res/bin/checkpointer.sh") return output(0);
		if (sameArgs(command, ["rev-parse", "HEAD"])) return output(0, "sha-1");
		if (sameArgs(command, ["branch", "--show-current"])) {
			if (options.currentBranch === null) return output(1, "", "fatal: not a git repository");
			return output(0, options.currentBranch ?? "feature/oslo");
		}
		if (sameArgs(command, ["worktree", "remove", "--force", "--force", "/worktrees/oslo"])) {
			return output(options.worktreeRemoveCode ?? 0);
		}
		if (
			options.branchDeleteFails === true &&
			command.args[0] === "branch" &&
			command.args[1] === "-D"
		) {
			return output(1, "", "error: branch is checked out");
		}
		return output(0);
	};
	const git = new FakeGitRunner((command, runOptions) => {
		calls.push({ command, cwd: runOptions.cwd });
		return ok(reply(command));
	});
	return { calls, git };
}

function makeFs(folderExists = true): { fs: FileSystem; trashed: string[] } {
	const trashed: string[] = [];
	return {
		trashed,
		fs: {
			async readText(): Promise<Result<string>> {
				return err(appError("fs_not_found", "missing"));
			},
			async writeTextAtomic(): Promise<Result<void>> {
				return ok(undefined);
			},
			async exists() {
				return folderExists;
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
			async trash(path: string) {
				trashed.push(path);
				return ok(undefined);
			},
			async registerRoot() {
				return ok(undefined);
			},
			assetUrl(path: string) {
				return `asset://localhost/${encodeURIComponent(path)}`;
			},
			paths: { home: "/Users/test", appData: "/app", temp: "/tmp", resources: "/res" },
		} satisfies FileSystem,
	};
}

interface HarnessOptions {
	rows?: Workspace[];
	hasWorkingChats?: boolean;
	settings?: Record<string, unknown>;
	currentBranch?: string | null;
	worktreeRemoveCode?: number;
	branchDeleteFails?: boolean;
	archiveScriptFails?: boolean;
	folderExists?: boolean;
}

function harness(options: HarnessOptions = {}) {
	const rows = options.rows ?? [makeWorkspace()];
	const settings: Record<string, unknown> = {
		delete_branch_on_archive: false,
		archive_on_merge: false,
		...options.settings,
	};
	const { git, calls } = makeRunner({
		currentBranch: options.currentBranch,
		worktreeRemoveCode: options.worktreeRemoveCode,
		branchDeleteFails: options.branchDeleteFails,
	});
	const { fs, trashed } = makeFs(options.folderExists ?? true);
	const transitions: { id: WorkspaceId; from: string; to: string }[] = [];
	const marks: { id: WorkspaceId; commit: string | null }[] = [];

	const workspaces = {
		async get(id: WorkspaceId) {
			const row = rows.find((candidate) => candidate.id === id);
			return ok(row === undefined ? null : { ...row });
		},
		async transitionState(id: WorkspaceId, from: Workspace["state"], to: Workspace["state"]) {
			transitions.push({ id, from, to });
			const row = rows.find((candidate) => candidate.id === id);
			if (row === undefined || row.state !== from) return ok(false);
			row.state = to;
			return ok(true);
		},
		async markArchived(id: WorkspaceId, archiveCommit: string | null) {
			marks.push({ id, commit: archiveCommit });
			const row = rows.find((candidate) => candidate.id === id);
			if (row === undefined || row.state !== "archiving") return ok(false);
			row.state = "archived";
			row.archiveCommit = archiveCommit;
			row.archivedAt = 6000;
			return ok(true);
		},
		async setBranch(id: WorkspaceId, branch: string) {
			const row = rows.find((candidate) => candidate.id === id);
			if (row !== undefined) row.branch = branch;
			return ok(undefined);
		},
	};

	const cancelAll = vi.fn(async () => ok(undefined));
	const stopWorkspace = vi.fn(async () => ok(undefined));
	const clearRuns = vi.fn();
	const runArchive = vi.fn(async () =>
		options.archiveScriptFails === true
			? err(appError("archive_script_failed", "archive script failed"))
			: ok(undefined),
	);

	const deps = {
		platform: { fs, opener: { openWith: vi.fn() }, shell: { run: vi.fn() } },
		git,
		repos: {
			repos: { get: async () => ok(baseRepo) },
			workspaces,
			backlogWorkspaces: { list: async () => ok([]) },
		},
		placeNames: { pick: () => "oslo" },
		sessions: {
			createFirstChat: vi.fn(),
			firstDraftOf: vi.fn(),
			cancelAll,
			hasWorkingChats: () => options.hasWorkingChats === true,
			markAllRead: vi.fn(),
			deleteAll: vi.fn(),
		},
		scripts: {
			runSetup: vi.fn(),
			runArchive,
			stopWorkspace,
			clearRuns,
		},
		checkpointerPath: "/res/bin/checkpointer.sh",
		setting: <T>(key: string) => settings[key] as T,
		now: () => 7000,
	} as unknown as WorkspaceServiceDeps;

	return {
		service: new WorkspaceService(deps),
		rows,
		calls,
		trashed,
		cancelAll,
		stopWorkspace,
		clearRuns,
		runArchive,
		transitions,
		marks,
	};
}

describe("WS-05 archive steps", () => {
	it("archives a ready workspace through every step and records the commit", async () => {
		const h = harness();

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: false });

		expect(archived.ok).toBe(true);
		expect(h.cancelAll).toHaveBeenCalledWith("w1");
		expect(h.calls.some((call) => call.command.program === "/res/bin/checkpointer.sh")).toBe(true);
		expect(
			h.calls.some((call) =>
				sameArgs(call.command, ["update-ref", "refs/conducted/archive/w1", "sha-1"]),
			),
		).toBe(true);
		expect(h.runArchive).toHaveBeenCalledWith("w1");
		expect(h.calls.some((call) => call.cwd === "/repo")).toBe(true);
		expect(h.marks).toEqual([{ id: "w1", commit: "sha-1" }]);
		const row = h.rows[0];
		expect(row).toMatchObject({
			state: "archived",
			archiveCommit: "sha-1",
			archivedAt: 6000,
		});
		expect(h.service.store.getState().archiving.w1).toBeUndefined();
	});

	it("refuses while a chat in the workspace is running", async () => {
		const h = harness({ hasWorkingChats: true });

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: false });

		expect(archived.ok).toBe(false);
		if (!archived.ok) expect(archived.error.code).toBe("workspace_has_running_sessions");
		expect(h.cancelAll).not.toHaveBeenCalled();
		expect(h.transitions).toEqual([]);
		expect(h.rows[0]?.state).toBe("ready");
	});

	it("rolls the state back when the archive script fails", async () => {
		const h = harness({ archiveScriptFails: true });

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: false });

		expect(archived.ok).toBe(false);
		expect(h.transitions).toEqual([
			{ id: "w1", from: "ready", to: "archiving" },
			{ id: "w1", from: "archiving", to: "ready" },
		]);
		expect(h.rows[0]?.state).toBe("ready");
		expect(h.marks).toEqual([]);
		expect(h.service.store.getState().archiving.w1).toBeUndefined();
	});

	it("stops a setup script that is still running before archiving", async () => {
		const h = harness();
		h.service.store.setState((state) => ({
			...state,
			setup: { ...state.setup, w1: "running" },
		}));

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: false });

		expect(archived.ok).toBe(true);
		expect(h.stopWorkspace).toHaveBeenCalledWith("w1");
		expect(h.rows[0]?.state).toBe("archived");
	});

	it("stops the workspace's run processes and clears its run state", async () => {
		const h = harness();

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: false });

		expect(archived.ok).toBe(true);
		expect(h.stopWorkspace).toHaveBeenCalledWith("w1");
		expect(h.clearRuns).toHaveBeenCalledWith("w1");
	});
});

describe("WS-05 branch read at archive", () => {
	it("rolls back when git cannot report the current branch", async () => {
		const h = harness({ currentBranch: null });

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: false });

		expect(archived.ok).toBe(false);
		expect(h.rows[0]?.state).toBe("ready");
		expect(h.marks).toEqual([]);
		expect(
			h.calls.some((call) =>
				sameArgs(call.command, ["update-ref", "refs/conducted/archive/w1", "sha-1"]),
			),
		).toBe(false);
	});

	it("rolls back on a detached HEAD instead of archiving the stored branch name", async () => {
		const h = harness({ currentBranch: "" });

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: false });

		expect(archived.ok).toBe(false);
		if (!archived.ok) expect(archived.error.code).toBe("git_detached_head");
		expect(h.rows[0]?.state).toBe("ready");
		expect(h.marks).toEqual([]);
	});
});

describe("WS-05 branch deletion", () => {
	it("never deletes the default branch", async () => {
		const h = harness({ currentBranch: "main" });

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: true });

		expect(archived.ok).toBe(true);
		expect(h.calls.some((call) => sameArgs(call.command, ["branch", "-D", "--", "main"]))).toBe(
			false,
		);
	});

	it("deletes the branch when the setting asks for it", async () => {
		const h = harness({ settings: { delete_branch_on_archive: true } });

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: false });

		expect(archived.ok).toBe(true);
		const deletion = h.calls.find((call) =>
			sameArgs(call.command, ["branch", "-D", "--", "feature/oslo"]),
		);
		expect(deletion?.cwd).toBe("/repo");
	});

	it("keeps the finished archive when deleting the branch fails, and records a warning", async () => {
		const h = harness({ branchDeleteFails: true });

		const archived = await h.service.archive("w1" as WorkspaceId, { deleteBranch: true });

		expect(archived.ok).toBe(true);
		expect(h.rows[0]?.state).toBe("archived");
		expect(h.service.store.getState().archiveWarnings?.w1).toContain("feature/oslo");
	});
});

describe("WS-05 archive on merge", () => {
	it("does nothing unless the setting is on", async () => {
		const h = harness();

		const result = await h.service.onPullRequestMerged("w1" as WorkspaceId, 7);

		expect(result.ok).toBe(true);
		expect(h.transitions).toEqual([]);
	});

	it("archives the workspace on the merged transition", async () => {
		const h = harness({ settings: { archive_on_merge: true } });

		const result = await h.service.onPullRequestMerged("w1" as WorkspaceId, 7);

		expect(result.ok).toBe(true);
		expect(h.rows[0]?.state).toBe("archived");
	});

	it("ignores another pull request and reports a running chat", async () => {
		const other = harness({ settings: { archive_on_merge: true } });
		expect((await other.service.onPullRequestMerged("w1" as WorkspaceId, 99)).ok).toBe(true);
		expect(other.transitions).toEqual([]);

		const running = harness({
			settings: { archive_on_merge: true },
			hasWorkingChats: true,
		});
		const failed = await running.service.onPullRequestMerged("w1" as WorkspaceId, 7);
		expect(failed.ok).toBe(false);
		if (!failed.ok) expect(failed.error.code).toBe("workspace_has_running_sessions");
	});

	it("reports a corrupted workspace whose folder is gone", async () => {
		const h = harness({ settings: { archive_on_merge: true }, folderExists: false });

		const result = await h.service.onPullRequestMerged("w1" as WorkspaceId, 7);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("workspace_corrupted");
		expect(h.transitions).toEqual([]);
	});
});

describe("WS-05 startup recovery of archiving workspaces", () => {
	const archiving = (folderExists: boolean): ArchivingWorkspace => ({
		id: "w1" as WorkspaceId,
		path: "/worktrees/oslo",
		archiveCommit: "sha-1",
		folderExists,
	});

	it("rolls back when the folder is still on disk", async () => {
		const h = harness({ rows: [makeWorkspace({ state: "archiving" })] });

		const result = await h.service.recoverArchiving([archiving(true)]);

		expect(result.ok).toBe(true);
		expect(h.transitions).toEqual([{ id: "w1", from: "archiving", to: "ready" }]);
		expect(h.rows[0]?.state).toBe("ready");
	});

	it("finishes the archive when the folder is gone", async () => {
		const h = harness({ rows: [makeWorkspace({ state: "archiving" })] });

		const result = await h.service.recoverArchiving([archiving(false)]);

		expect(result.ok).toBe(true);
		expect(h.marks).toEqual([{ id: "w1", commit: "sha-1" }]);
		expect(h.rows[0]?.state).toBe("archived");
	});
});
