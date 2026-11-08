/**
 * @feature WS-03 Setup script in a terminal
 * Owns: tests for the setup run and its workspace state moves, and for the file-copy match rules.
 * Test first: a setup script that exits 0 moves the workspace from initializing to ready, and a
 * nonzero exit moves it to failed.
 */
import {
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { GitRunner } from "../git/runner.ts";
import type { Repo, Workspace } from "../model.ts";
import type { SetupRunResult } from "./run-scripts.ts";
import {
	COPY_FILE_SIZE_LIMIT,
	DEFAULT_COPY_FILES,
	matchesCopyPattern,
	parseWorktreeInclude,
	SETUP_FAILED_MESSAGE,
	selectIncludedPaths,
	WorkspaceService,
	type WorkspaceServiceDeps,
} from "./workspace.ts";

const repo: Repo = {
	id: "r1" as RepoId,
	name: "Project",
	rootPath: "/repo",
	remoteUrl: "https://example.com/project.git",
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
};

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
	id: "w1" as WorkspaceId,
	repoId: repo.id,
	directoryName: "oslo",
	path: "/workspaces/oslo",
	branch: "oslo",
	branchIsPlaceholder: true,
	host: { kind: "local" },
	displayName: null,
	targetBranch: "main",
	state: "initializing",
	kanbanStatus: "in_progress",
	port: 55_000,
	pinnedAt: null,
	linkedPaths: [],
	prNumber: null,
	prTitle: null,
	prDescription: null,
	archiveCommit: null,
	archivedAt: null,
	activeSessionId: null,
	filesCopied: null,
	lastActivityAt: 1,
	createdAt: 1,
	updatedAt: 1,
	...overrides,
});

const setupResult = (overrides: Partial<SetupRunResult> = {}): SetupRunResult => ({
	scriptFound: true,
	exitCode: 0,
	terminalId: null,
	logPath: null,
	log: "missing",
	...overrides,
});

interface HarnessOptions {
	rows?: Workspace[];
	logPaths?: Readonly<Record<string, string | null>>;
	logExists?: (path: string) => boolean;
	shell?: WorkspaceServiceDeps["platform"]["shell"];
}

function harness(runSetup: () => Promise<Result<SetupRunResult>>, options: HarnessOptions = {}) {
	const rows = options.rows ?? [workspace()];
	const stopWorkspace = vi.fn(async () => ok(undefined));
	const setSetupLogPath = vi.fn(async (_path: string | null) => ok(undefined));
	const workspaces = {
		async listAll() {
			return ok([...rows]);
		},
		async listByRepo() {
			return ok([...rows]);
		},
		async listByState() {
			return ok([]);
		},
		async get(id: WorkspaceId) {
			return ok(rows.find((row) => row.id === id) ?? null);
		},
		async getSetupLogPath(id: WorkspaceId) {
			return ok(options.logPaths?.[id] ?? null);
		},
		async listDirectoryNames() {
			return ok([]);
		},
		async listPorts() {
			return ok([]);
		},
		async create() {
			throw new Error("not used");
		},
		async transitionState(id: WorkspaceId, from: Workspace["state"], to: Workspace["state"]) {
			const row = rows.find((candidate) => candidate.id === id);
			if (row === undefined || row.state !== from) return ok(false);
			row.state = to;
			return ok(true);
		},
		async markArchived() {
			return ok(false);
		},
		async setKanbanStatus() {
			return ok(undefined);
		},
		async setDisplayName() {
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
		async setLinkedPaths() {
			return ok(undefined);
		},
		async setPullRequest() {
			return ok(undefined);
		},
		async setSetupLogPath(_id: WorkspaceId, path: string | null) {
			return setSetupLogPath(path);
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

	const settings: Record<string, unknown> = {
		worktree_push_auto_setup_remote: true,
		conductor_root_path: "~/conducted",
	};
	const deps = {
		platform: {
			fs: {
				async readText() {
					return err(appError("fs_not_found", "missing"));
				},
				async writeTextAtomic() {
					return ok(undefined);
				},
				async exists(path: string) {
					return options.logExists?.(path) ?? false;
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
				paths: { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" },
			},
			opener: {},
			shell:
				options.shell ??
				({
					run: async () => ok({ exitCode: 0, stdout: "", stderr: "" }),
				} as unknown as WorkspaceServiceDeps["platform"]["shell"]),
		},
		git: {} as GitRunner,
		repos: {
			repos: { get: async () => ok(repo) },
			workspaces,
			sessions: {},
			sections: { moveWorkspace: async () => ok(undefined) },
			backlogWorkspaces: { list: async () => ok([]) },
		},
		placeNames: { pick: () => "oslo" },
		sessions: {
			createFirstChat: async () => ok({}),
			firstDraftOf: async () => ok({ text: "", attachmentPaths: [] }),
			cancelAll: async () => ok(undefined),
			hasWorkingChats: () => false,
			markAllRead: async () => ok(undefined),
			deleteAll: async () => ok(undefined),
		},
		scripts: { runSetup, runArchive: async () => ok(undefined), stopWorkspace },
		setting: <T>(key: string): T => settings[key] as T,
		now: () => 100,
	} as unknown as WorkspaceServiceDeps;

	return {
		service: new WorkspaceService(deps),
		rows,
		stopWorkspace,
		setSetupLogPath,
	};
}

describe("WS-03 WorkspaceService.runSetup", () => {
	it("moves an initializing workspace to ready when the script exits 0", async () => {
		const { service, rows, setSetupLogPath } = harness(async () =>
			ok(setupResult({ exitCode: 0, logPath: "/tmp/setup.log", log: "saved" })),
		);

		const result = await service.runSetup(rows[0]?.id as WorkspaceId);

		expect(result.ok).toBe(true);
		expect(rows[0]?.state).toBe("ready");
		expect(setSetupLogPath).toHaveBeenCalledWith("/app/setup-logs/w1.log");
		expect(service.store.getState().setupRuns?.[rows[0]?.id ?? ""]?.state).toBe("completed");
	});

	it("moves the workspace to failed when the script exits nonzero", async () => {
		const { service, rows } = harness(async () => ok(setupResult({ exitCode: 2 })));

		const result = await service.runSetup(rows[0]?.id as WorkspaceId);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toBe(SETUP_FAILED_MESSAGE);
		expect(rows[0]?.state).toBe("failed");
		expect(service.store.getState().setupRuns?.[rows[0]?.id ?? ""]?.exitCode).toBe(2);
	});

	it("treats a killed script with no exit code as failed", async () => {
		const { service, rows } = harness(async () =>
			ok(setupResult({ scriptFound: true, exitCode: null, terminalId: "t1" as TerminalId })),
		);

		const result = await service.runSetup(rows[0]?.id as WorkspaceId);

		expect(result.ok).toBe(false);
		expect(rows[0]?.state).toBe("failed");
		const run = service.store.getState().setupRuns?.[rows[0]?.id ?? ""];
		expect(run?.state).toBe("failed");
		expect(run?.exitCode).toBeNull();
	});

	it("moves to ready when the repository has no setup script", async () => {
		const { service, rows } = harness(async () => ok(setupResult({ scriptFound: false })));

		const result = await service.runSetup(rows[0]?.id as WorkspaceId);

		expect(result.ok).toBe(true);
		expect(rows[0]?.state).toBe("ready");
	});

	it("ignores a second start while the first is running", async () => {
		let release: (value: Result<SetupRunResult>) => void = () => {};
		let scriptStarted: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			scriptStarted = resolve;
		});
		const scripts = vi.fn(() => {
			scriptStarted();
			return new Promise<Result<SetupRunResult>>((resolve) => {
				release = resolve;
			});
		});
		const { service, rows } = harness(scripts);
		const id = rows[0]?.id as WorkspaceId;

		const first = service.runSetup(id);
		const second = service.runSetup(id);
		await started;
		release(ok(setupResult()));

		await Promise.all([first, second]);
		expect(scripts).toHaveBeenCalledTimes(1);
	});

	it("shows a cancelled run after cancelSetup", async () => {
		let release: (value: Result<SetupRunResult>) => void = () => {};
		const scripts = vi.fn(
			() =>
				new Promise<Result<SetupRunResult>>((resolve) => {
					release = resolve;
				}),
		);
		const { service, rows, stopWorkspace } = harness(scripts);
		const id = rows[0]?.id as WorkspaceId;

		const run = service.runSetup(id);
		await service.cancelSetup(id);
		release(ok(setupResult({ exitCode: 1 })));
		await run;

		expect(stopWorkspace).toHaveBeenCalledWith(id);
		expect(service.store.getState().setupRuns?.[id]?.state).toBe("cancelled");
		expect(rows[0]?.state).toBe("failed");
	});
});

describe("WS-03 loading a saved setup run", () => {
	it("does not invent an exit code or a reason for a failed workspace", async () => {
		const row = workspace({ state: "failed" });
		const { service } = harness(async () => ok(setupResult()), {
			rows: [row],
			logPaths: { w1: "/app/setup-logs/w1.log" },
			logExists: () => true,
		});

		await service.start();

		expect(service.store.getState().setupRuns?.w1).toMatchObject({
			state: "failed",
			exitCode: null,
			interruptedReason: null,
			logPath: "/app/setup-logs/w1.log",
			log: "saved",
		});
	});

	it("does not invent an exit code for a ready workspace", async () => {
		const row = workspace({ state: "ready" });
		const { service } = harness(async () => ok(setupResult()), {
			rows: [row],
			logPaths: { w1: "/app/setup-logs/w1.log" },
			logExists: () => true,
		});

		await service.start();

		expect(service.store.getState().setupRuns?.w1).toMatchObject({
			state: "completed",
			exitCode: null,
			interruptedReason: null,
		});
	});

	it("shows no run for a workspace whose log was never recorded", async () => {
		const row = workspace({ state: "failed" });
		const { service } = harness(async () => ok(setupResult()), { rows: [row] });

		await service.start();

		expect(service.store.getState().setupRuns?.w1).toBeUndefined();
	});
});

describe("WS-03 worktree include copy rules", () => {
	it("reads .worktreeinclude lines and ignores comments", () => {
		expect(parseWorktreeInclude("# config\n.env\n\nconfig/*.json\n")).toEqual([
			".env",
			"config/*.json",
		]);
	});

	it("matches the default .env patterns and directory patterns", () => {
		expect(DEFAULT_COPY_FILES).toEqual([".env*"]);
		expect(matchesCopyPattern(".env", ".env*")).toBe(true);
		expect(matchesCopyPattern(".env.local", ".env*")).toBe(true);
		expect(matchesCopyPattern("config/app.json", "config/*.json")).toBe(true);
		expect(matchesCopyPattern("config/nested/app.json", "config/*.json")).toBe(false);
		expect(matchesCopyPattern("secrets/key", "secrets/")).toBe(true);
		expect(matchesCopyPattern("README.md", ".env*")).toBe(false);
	});

	it("keeps a 256 KiB per-file cap in one place", () => {
		expect(COPY_FILE_SIZE_LIMIT).toBe(256 * 1024);
	});

	it("applies patterns in order so a later ! can remove a match", () => {
		const paths = [".env", ".env.local", "config/app.json"];
		expect(selectIncludedPaths(paths, [".env*", "config/*.json"])).toEqual([
			".env",
			".env.local",
			"config/app.json",
		]);
		expect(selectIncludedPaths(paths, [".env*", "!.env.local"])).toEqual([".env"]);
	});
});
