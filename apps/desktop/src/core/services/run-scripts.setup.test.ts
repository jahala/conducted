/**
 * @feature WS-03 Setup script in a terminal
 * Owns: tests for starting the setup terminal with CONDUCTED_* variables and writing its log.
 * Test first: the setup script runs in a terminal of kind "setup" with CONDUCTED_* variables and
 * its transcript is written when it ends.
 */
import { ok, type RepoId, type TerminalId, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../../platform/platform.ts";
import type { Repo, RepoConfig, Workspace } from "../model.ts";
import { RunScriptsService } from "./run-scripts.ts";

const repo: Repo = {
	id: "r1" as RepoId,
	name: "Project",
	rootPath: "/repo",
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
};

const workspace: Workspace = {
	id: "w1" as WorkspaceId,
	repoId: repo.id,
	directoryName: "oslo",
	path: "/workspaces/oslo",
	branch: "oslo",
	branchIsPlaceholder: true,
	displayName: null,
	targetBranch: "main",
	state: "initializing",
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
	lastActivityAt: 1,
	createdAt: 1,
	updatedAt: 1,
};

const config = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
	setupScript: "npm install",
	runScripts: [],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrlTemplate: null,
	spotlightTesting: false,
	autoRunAfterSetup: false,
	remoteName: "origin",
	prompts: {
		general: null,
		codeReview: null,
		createPr: null,
		fixErrors: null,
		resolveConflicts: null,
		renameBranch: null,
	},
	...overrides,
});

function harness(options: { setupScript?: string | null; exitCode?: number | null } = {}) {
	const runScript = vi.fn(
		async (_input: {
			workspaceId: WorkspaceId;
			kind: "setup" | "run" | "spotlight";
			title: string;
			command: string;
			cwd: string;
			env: Readonly<Record<string, string>>;
		}) =>
			ok({
				terminalId: "t1" as TerminalId,
				exit: Promise.resolve(options.exitCode === undefined ? 0 : options.exitCode),
			}),
	);
	const outputFor = vi.fn(async () => ok({ output: "installed", source: "setup", running: false }));
	const close = vi.fn(async () => ok(undefined));
	const transcripts: { path: string; text: string }[] = [];
	const fs = {
		async writeTextAtomic(path: string, text: string) {
			transcripts.push({ path, text });
			return ok(undefined);
		},
		async exists() {
			return true;
		},
		paths: { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" },
	} as unknown as Pick<FileSystem, "writeTextAtomic" | "exists"> & {
		paths: FileSystem["paths"];
	};

	const service = new RunScriptsService({
		terminals: { runScript, outputFor, close, stop: vi.fn(async () => ok(undefined)) },
		configFor: async () => ok(config({ setupScript: options.setupScript ?? "npm install" })),
		workspaceFor: async () => ok(workspace),
		repoFor: async () => ok(repo),
		fs,
	});
	return { service, runScript, close, transcripts };
}

describe("WS-03 RunScriptsService.runSetup", () => {
	it("runs the script as a setup terminal with the workspace variables", async () => {
		const { service, runScript } = harness();

		const result = await service.runSetup(workspace.id);

		expect(result.ok).toBe(true);
		expect(runScript).toHaveBeenCalledTimes(1);
		const input = runScript.mock.calls[0]?.[0] as {
			kind: string;
			command: string;
			cwd: string;
			env: Record<string, string>;
		};
		expect(input.kind).toBe("setup");
		expect(input.command).toBe("npm install");
		expect(input.cwd).toBe("/workspaces/oslo");
		expect(input.env.CONDUCTED_WORKSPACE_PATH).toBe("/workspaces/oslo");
		expect(input.env.CONDUCTED_ROOT_PATH).toBe("/repo");
		expect(input.env.CONDUCTED_DEFAULT_BRANCH).toBe("main");
		expect(input.env.CONDUCTED_PORT).toBe("55000");
		expect(Object.keys(input.env).some((key) => key.startsWith("CONDUCTOR_"))).toBe(false);
	});

	it("writes the transcript to the setup log when the script ends", async () => {
		const { service, transcripts } = harness({ exitCode: 0 });

		const result = await service.runSetup(workspace.id);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({
			exitCode: 0,
			terminalId: "t1",
			logPath: "/tmp/conducted-setup-w1.log",
			log: "saved",
		});
		expect(transcripts).toEqual([{ path: "/tmp/conducted-setup-w1.log", text: "installed" }]);
	});

	it("does not start a terminal when the repository has no setup script", async () => {
		const { service, runScript } = harness({ setupScript: "" });

		const result = await service.runSetup(workspace.id);

		expect(result).toEqual(ok({ exitCode: null, terminalId: null, logPath: null, log: "missing" }));
		expect(runScript).not.toHaveBeenCalled();
	});

	it("returns the failed exit code without hiding it", async () => {
		const { service } = harness({ exitCode: 2 });

		const result = await service.runSetup(workspace.id);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.exitCode).toBe(2);
	});

	it("ignores a second start while the same workspace is running", async () => {
		let release: (value: number | null) => void = () => {};
		const runScript = vi.fn(
			async (_input: {
				workspaceId: WorkspaceId;
				kind: "setup" | "run" | "spotlight";
				title: string;
				command: string;
				cwd: string;
				env: Readonly<Record<string, string>>;
			}) =>
				ok({
					terminalId: "t1" as TerminalId,
					exit: new Promise<number | null>((resolve) => {
						release = resolve;
					}),
				}),
		);
		const service = new RunScriptsService({
			terminals: {
				runScript,
				outputFor: async () => ok({ output: "", source: "setup", running: false }),
				close: async () => ok(undefined),
				stop: async () => ok(undefined),
			},
			configFor: async () => ok(config()),
			workspaceFor: async () => ok(workspace),
			repoFor: async () => ok(repo),
			fs: {
				writeTextAtomic: async () => ok(undefined),
				paths: { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" },
			},
		});

		const first = service.runSetup(workspace.id);
		const second = service.runSetup(workspace.id);
		release(0);
		await Promise.all([first, second]);

		expect(runScript).toHaveBeenCalledTimes(1);
	});
});
