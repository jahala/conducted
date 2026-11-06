import { appError, err, ok, type RepoId, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { FileSystem, Platform, ShellOutput } from "../../platform/platform.ts";
import type { Repo, RepoConfig, Workspace } from "../model.ts";
import { RunScriptsService, type RunScriptsServiceDeps } from "./run-scripts.ts";

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

const workspace: Workspace = {
	id: "w1" as WorkspaceId,
	repoId: baseRepo.id,
	directoryName: "oslo",
	path: "/worktrees/oslo",
	branch: "feature/oslo",
	branchIsPlaceholder: false,
	displayName: null,
	targetBranch: "main",
	state: "ready",
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
};

const config = (overrides: Partial<RepoConfig> = {}): RepoConfig =>
	({ archiveScript: null, ...overrides }) as RepoConfig;

const output = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

function makeFs(): FileSystem {
	return {
		async readText(): Promise<Result<string>> {
			return err(appError("fs_not_found", "missing"));
		},
		async writeTextAtomic() {
			return ok(undefined);
		},
		async exists() {
			return false;
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
		assetUrl(path: string) {
			return `asset://localhost/${encodeURIComponent(path)}`;
		},
		paths: { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" },
	};
}

function harness(options: {
	archiveScript?: string | null;
	exitCode?: number;
	stderr?: string;
	withShell?: boolean;
}) {
	const run = vi.fn(async (_command: unknown) =>
		ok(output(options.exitCode ?? 0, "", options.stderr ?? "")),
	);
	const shell = { run } as unknown as Pick<Platform["shell"], "run">;
	const deps = {
		terminals: {
			runScript: vi.fn(),
			end: vi.fn(),
			stop: vi.fn(),
			outputFor: vi.fn(),
		},
		configFor: async () => ok(config({ archiveScript: options.archiveScript ?? null })),
		workspaceFor: async () => ok(workspace),
		repoFor: async () => ok(baseRepo),
		fs: makeFs(),
		...(options.withShell === false ? {} : { shell }),
	} as unknown as RunScriptsServiceDeps;
	return { service: new RunScriptsService(deps), run };
}

describe("WS-05 archive script", () => {
	it("runs the repository's archive script once with the workspace variables", async () => {
		const h = harness({ archiveScript: "echo bye" });

		const result = await h.service.runArchive("w1" as WorkspaceId);

		expect(result.ok).toBe(true);
		expect(h.run).toHaveBeenCalledTimes(1);
		const command = h.run.mock.calls[0]?.[0] as unknown as {
			program: string;
			args: string[];
			cwd: string;
			env: Record<string, string>;
		};
		expect(command.program).toBe("zsh");
		expect(command.args).toEqual(["-lc", "echo bye"]);
		expect(command.cwd).toBe("/worktrees/oslo");
		expect(command.env.CONDUCTED_WORKSPACE_PATH).toBe("/worktrees/oslo");
		expect(command.env.CONDUCTED_ROOT_PATH).toBe("/repo");
		expect(command.env.CONDUCTED_DEFAULT_BRANCH).toBe("main");
	});

	it("does nothing when the repository has no archive script", async () => {
		const h = harness({ archiveScript: "  " });

		const result = await h.service.runArchive("w1" as WorkspaceId);

		expect(result.ok).toBe(true);
		expect(h.run).not.toHaveBeenCalled();
	});

	it("reports a failing archive script", async () => {
		const h = harness({ archiveScript: "exit 2", exitCode: 2, stderr: "boom" });

		const result = await h.service.runArchive("w1" as WorkspaceId);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("archive_script_failed");
			expect(result.error.message).toContain("boom");
		}
	});

	it("reports that the shell was not provided", async () => {
		const h = harness({ archiveScript: "echo bye", withShell: false });

		const result = await h.service.runArchive("w1" as WorkspaceId);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("archive_script_failed");
		expect(h.run).not.toHaveBeenCalled();
	});
});
