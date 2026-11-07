import { appError, err, ok, type RepoId, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import type { Repo, Workspace } from "../model.ts";
import { WorkspaceService, type WorkspaceServiceDeps } from "./workspace.ts";

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
		state: "archived",
		kanbanStatus: "in_progress",
		port: 55_000,
		pinnedAt: null,
		linkedPaths: [],
		prNumber: 7,
		prTitle: null,
		prDescription: null,
		archiveCommit: "archive-sha",
		archivedAt: 5000,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 1000,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

interface HarnessOptions {
	rows?: Workspace[];
	branchExists?: boolean;
	branchTip?: string | null;
	checkedOutElsewhere?: boolean;
	worktreeAddFails?: boolean;
	branchCreateFails?: boolean;
	restoreFails?: boolean;
	clearChatsFails?: boolean;
	rollbackStateFails?: boolean;
	finishFails?: boolean;
	worktreeRemoveFails?: boolean;
	existingPaths?: ReadonlySet<string>;
	settings?: Record<string, unknown>;
}

function harness(options: HarnessOptions = {}) {
	const rows = options.rows ?? [makeWorkspace()];
	const branchExists = options.branchExists ?? true;
	const branchTip = options.branchTip ?? "archive-sha";
	const checkedOutElsewhere = options.checkedOutElsewhere ?? false;
	const settings: Record<string, unknown> = {
		conducted_root_path: "/worktrees",
		...options.settings,
	};
	const replies: string[] = [];
	const git = new FakeGitRunner((command) => {
		if (command.program === "/res/bin/checkpointer.sh") {
			return options.restoreFails === true
				? ok({ exitCode: 1, stdout: "", stderr: "saved state is gone" })
				: ok({ exitCode: 0, stdout: "", stderr: "" });
		}
		if (command.args[0] === "show-ref" && command.args[1] === "--verify") {
			const ref = command.args[command.args.length - 1] ?? "";
			const exists = ref.startsWith("refs/heads/") ? branchExists : false;
			return ok({ exitCode: exists ? 0 : 1, stdout: "", stderr: "" });
		}
		if (command.args[0] === "rev-parse" && command.args[1]?.startsWith("refs/heads/")) {
			return ok({ exitCode: 0, stdout: `${branchTip ?? ""}\n`, stderr: "" });
		}
		if (sameArgs(command, ["worktree", "list", "--porcelain"])) {
			// Both the workspace's branch and the name a caller may supply are reported as taken,
			// so the checked-out-elsewhere test covers either path.
			const line = checkedOutElsewhere
				? "branch refs/heads/feature/oslo\nbranch refs/heads/feature/restored\n"
				: "";
			return ok({ exitCode: 0, stdout: line, stderr: "" });
		}
		if (command.args[0] === "branch" && command.args[1] === "--") {
			replies.push("branch");
			return options.branchCreateFails === true
				? ok({ exitCode: 1, stdout: "", stderr: "cannot create branch" })
				: ok({ exitCode: 0, stdout: "", stderr: "" });
		}
		if (command.args[0] === "worktree" && command.args[1] === "add") {
			replies.push("add");
			return options.worktreeAddFails === true
				? ok({ exitCode: 1, stdout: "", stderr: "worktree add failed" })
				: ok({ exitCode: 0, stdout: "", stderr: "" });
		}
		if (
			options.worktreeRemoveFails === true &&
			command.args[0] === "worktree" &&
			(command.args[1] === "remove" || command.args[1] === "prune")
		) {
			return ok({ exitCode: 1, stdout: "", stderr: "folder is locked" });
		}
		if (command.args[0] === "branch" && command.args[1] === "-D") {
			replies.push("delete");
			return ok({ exitCode: 0, stdout: "", stderr: "" });
		}
		return ok({ exitCode: 0, stdout: "", stderr: "" });
	});

	const finished: { id: WorkspaceId; branch: string; directoryName: string; path: string }[] = [];
	const transitions: { id: WorkspaceId; from: string; to: string }[] = [];
	const workspaces = {
		async get(id: WorkspaceId) {
			const row = rows.find((candidate) => candidate.id === id);
			return ok(row === undefined ? null : { ...row });
		},
		async listByRepo(repoId: RepoId) {
			return ok(rows.filter((row) => row.repoId === repoId).map((row) => ({ ...row })));
		},
		async transitionState(id: WorkspaceId, from: Workspace["state"], to: Workspace["state"]) {
			transitions.push({ id, from, to });
			if (options.rollbackStateFails === true && from === "initializing" && to === "archived") {
				return err(appError("db_busy", "database is locked"));
			}
			const row = rows.find((candidate) => candidate.id === id);
			if (row === undefined || row.state !== from) return ok(false);
			row.state = to;
			return ok(true);
		},
		async finishUnarchive(
			id: WorkspaceId,
			input: { branch: string; directoryName: string; path: string },
		) {
			finished.push({ id, ...input });
			if (options.finishFails === true) return err(appError("db_busy", "disk is full"));
			const row = rows.find((candidate) => candidate.id === id);
			if (row === undefined || row.state !== "initializing") return ok(false);
			row.state = "ready";
			row.branch = input.branch;
			row.directoryName = input.directoryName;
			row.path = input.path;
			row.archivedAt = null;
			return ok(true);
		},
	};

	const deleteAll = vi.fn(async () =>
		options.clearChatsFails === true
			? err(appError("chat_delete_failed", "chats survived"))
			: ok(undefined),
	);
	const trash: string[] = [];
	const existing = options.existingPaths ?? new Set<string>();
	const fs = {
		async readText(): Promise<Result<string>> {
			return err(appError("fs_not_found", "missing"));
		},
		async writeTextAtomic(): Promise<Result<void>> {
			return ok(undefined);
		},
		async exists(path: string) {
			return existing.has(path);
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
			trash.push(path);
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
	// seam: WS-06 the workspace service's outside world (git, repositories) is scripted here.
	const deps = {
		platform: {
			fs,
			opener: { openWith: vi.fn() },
			shell: { run: vi.fn() },
		},
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
			cancelAll: vi.fn(),
			hasWorkingChats: () => false,
			markAllRead: vi.fn(),
			deleteAll,
		},
		scripts: {
			runSetup: vi.fn(),
			runArchive: vi.fn(),
			stopWorkspace: vi.fn(),
			clearRuns: vi.fn(),
		},
		checkpointerPath: "/res/bin/checkpointer.sh",
		setting: <T>(key: string) => settings[key] as T,
		now: () => 7000,
	} as unknown as WorkspaceServiceDeps;

	return {
		service: new WorkspaceService(deps),
		git,
		rows,
		finished,
		transitions,
		deleteAll,
		trash,
		replies,
	};
}

const archiveCheckpoint = (call: { command: GitCommand }): boolean =>
	call.command.program === "/res/bin/checkpointer.sh" &&
	call.command.args.length === 2 &&
	call.command.args[0] === "restore" &&
	call.command.args[1] === "archive-w1";

describe("WS-06 unarchive on the same branch", () => {
	it("re-adds the worktree, restores the checkpoint and clears the archive time", async () => {
		const h = harness();

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result).toEqual({
			ok: true,
			value: { needsBranchName: false, uncommittedChangesLost: false },
		});
		expect(
			h.git.calls.some(
				(call) =>
					sameArgs(call.command, ["worktree", "add", "/worktrees/oslo", "feature/oslo"]) &&
					call.options.cwd === "/repo",
			),
		).toBe(true);
		expect(h.git.calls.some(archiveCheckpoint)).toBe(true);
		expect(h.transitions).toEqual([{ id: "w1", from: "archived", to: "initializing" }]);
		expect(h.finished).toEqual([
			{
				id: "w1",
				branch: "feature/oslo",
				directoryName: "oslo",
				path: "/worktrees/oslo",
			},
		]);
		expect(h.rows[0]).toMatchObject({
			state: "ready",
			branch: "feature/oslo",
			archivedAt: null,
		});
		// Conductor's unarchive stamps the recent activity with the restore time (services-map.md
		// 3.10); the loaded row follows the database.
		expect(h.service.store.getState().workspacesById["w1" as WorkspaceId]?.lastActivityAt).toBe(
			7000,
		);
	});
});

describe("WS-06 unarchive edge cases", () => {
	it("creates the branch from the archive commit when it was deleted", async () => {
		const h = harness({ branchExists: false });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result).toMatchObject({
			ok: true,
			value: { needsBranchName: false, uncommittedChangesLost: false },
		});
		expect(
			h.git.calls.some((call) =>
				sameArgs(call.command, ["branch", "--", "feature/oslo", "archive-sha"]),
			),
		).toBe(true);
	});

	it("asks for a branch name when the branch is checked out elsewhere", async () => {
		const h = harness({ checkedOutElsewhere: true });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result).toEqual({
			ok: true,
			value: { needsBranchName: true, uncommittedChangesLost: false },
		});
		expect(h.transitions).toEqual([]);
	});

	it("asks for a branch name when the branch has diverged from the archive commit", async () => {
		const h = harness({ branchTip: "other-sha" });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result).toEqual({
			ok: true,
			value: { needsBranchName: true, uncommittedChangesLost: false },
		});
		expect(h.transitions).toEqual([]);
	});

	it("uses the branch name the caller supplies, created from the archive commit", async () => {
		const h = harness({ branchExists: false });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: "feature/restored",
			clearChats: false,
		});

		expect(result).toMatchObject({ ok: true, value: { needsBranchName: false } });
		expect(
			h.git.calls.some((call) =>
				sameArgs(call.command, ["branch", "--", "feature/restored", "archive-sha"]),
			),
		).toBe(true);
		expect(h.finished[0]?.branch).toBe("feature/restored");
	});

	it("reports a supplied branch that is checked out elsewhere", async () => {
		const h = harness({ checkedOutElsewhere: true });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: "feature/restored",
			clearChats: false,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("branch_checked_out_elsewhere");
			expect(result.error.message).toContain("checked out elsewhere");
		}
		expect(h.transitions).toEqual([]);
	});

	it("treats a failed checkpoint restore as a notice", async () => {
		const h = harness({ restoreFails: true });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result).toEqual({
			ok: true,
			value: { needsBranchName: false, uncommittedChangesLost: true },
		});
		expect(h.rows[0]?.state).toBe("ready");
	});

	it("refuses a workspace that is not archived", async () => {
		const h = harness({ rows: [makeWorkspace({ state: "ready" })] });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "workspace_not_archived" },
		});
		expect(h.transitions).toEqual([]);
	});

	it("gives the workspace a new folder name and path when the old path exists", async () => {
		const h = harness({
			existingPaths: new Set(["/worktrees/oslo"]),
		});

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result).toMatchObject({ ok: true });
		expect(h.finished).toEqual([
			{
				id: "w1",
				branch: "feature/oslo",
				directoryName: "oslo-v1",
				path: "/worktrees/workspaces/Project/oslo-v1",
			},
		]);
		expect(
			h.git.calls.some((call) =>
				sameArgs(call.command, [
					"worktree",
					"add",
					"/worktrees/workspaces/Project/oslo-v1",
					"feature/oslo",
				]),
			),
		).toBe(true);
	});

	it("clears the chats when Clear & unarchive asks for it", async () => {
		const h = harness();

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: true,
		});

		expect(result).toMatchObject({ ok: true });
		expect(h.deleteAll).toHaveBeenCalledWith("w1");
	});
});

describe("WS-06 unarchive failure", () => {
	it("rolls the state back and removes the new branch when the worktree cannot be added", async () => {
		const h = harness({ branchExists: false, worktreeAddFails: true });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result.ok).toBe(false);
		expect(h.transitions).toEqual([
			{ id: "w1", from: "archived", to: "initializing" },
			{ id: "w1", from: "initializing", to: "archived" },
		]);
		expect(h.rows[0]?.state).toBe("archived");
		expect(
			h.git.calls.some((call) => sameArgs(call.command, ["branch", "-D", "--", "feature/oslo"])),
		).toBe(true);
	});
});

describe("WS-06 rollback failures are reported", () => {
	it("names a state that could not go back to archived, and keeps the store on initializing", async () => {
		const h = harness({ worktreeAddFails: true, rollbackStateFails: true });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toMatch(
			/ The workspace could not be set back to archived and stays initializing: database is locked$/,
		);
		expect(h.rows[0]?.state).toBe("initializing");
		expect(h.service.store.getState().workspacesById["w1" as WorkspaceId]?.state).toBe(
			"initializing",
		);
	});

	it("names a re-added folder that could not be removed after the row update failed", async () => {
		const h = harness({ finishFails: true, worktreeRemoveFails: true });

		const result = await h.service.unarchive("w1" as WorkspaceId, {
			branchName: null,
			clearChats: false,
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toContain('The folder "/worktrees/oslo" also stays:');
		expect(h.rows[0]?.state).toBe("archived");
	});
});

describe("WS-06 through the real container", () => {
	it("unarchives through the workspace service the composition root builds", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			await test.database.execute(
				"UPDATE workspaces SET state = 'archived', archive_commit = $1, archived_at = $2 WHERE id = $3",
				["archive-sha", 10, workspace.id],
			);
			const checkpointer = (command: { program: string }): boolean =>
				command.program.endsWith("checkpointer.sh");
			test.memory.controls.scriptShell((command) => {
				if (checkpointer(command)) return ok({ exitCode: 0, stdout: "", stderr: "" });
				const args = command.program === "git" ? command.args.slice(2) : command.args;
				if (args[0] === "rev-parse") {
					return ok({ exitCode: 0, stdout: "archive-sha\n", stderr: "" });
				}
				return ok({ exitCode: 0, stdout: "", stderr: "" });
			});

			const result = await test.container.services.workspace.unarchive(workspace.id, {
				branchName: null,
				clearChats: false,
			});

			expect(result).toEqual({
				ok: true,
				value: { needsBranchName: false, uncommittedChangesLost: false },
			});
			const stored =
				test.container.services.workspace.store.getState().workspacesById[workspace.id];
			expect(stored).toMatchObject({ state: "ready", archivedAt: null });
		} finally {
			test.close();
		}
	});
});
