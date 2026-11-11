/**
 * @feature WS-03 Setup script in a terminal
 * Owns: tests for starting the setup terminal with CONDUCTED_* variables and writing its log.
 * Test first: the setup script runs in a terminal of kind "setup" with CONDUCTED_* variables and
 * its transcript is written when it ends.
 */
import type { Host } from "@conducted/protocol";
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
	remoteFileSyncEnabled: false,
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
};

const config = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
	setupScript: "npm install",
	runScripts: [],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrls: [],
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

function harness(
	options: {
		setupScript?: string | null;
		exitCode?: number | null;
		host?: Host;
		environmentFor?: (repo: Repo, workspace: Workspace) => Promise<Result<Record<string, string>>>;
	} = {},
) {
	let started = 0;
	const runScript = vi.fn(
		async (_input: {
			workspaceId: WorkspaceId;
			kind: "setup" | "run" | "spotlight";
			title: string;
			command: string;
			cwd: string;
			env: Readonly<Record<string, string>>;
		}) => {
			started += 1;
			return ok({
				terminalId: `t${started}` as TerminalId,
				exit: Promise.resolve(options.exitCode === undefined ? 0 : options.exitCode),
			});
		},
	);
	const outputFor = vi.fn(async () => ok({ output: "installed", source: "setup", running: false }));
	const end = vi.fn(async (_id: TerminalId) => ok(undefined) as Result<void>);
	const transcripts: { path: string; text: string }[] = [];
	const fs = {
		async writeTextAtomic(path: string, text: string) {
			transcripts.push({ path, text });
			return ok(undefined);
		},
		async mkdirp() {
			return ok(undefined);
		},
		async exists() {
			return true;
		},
		paths: { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" },
	} as unknown as Pick<FileSystem, "writeTextAtomic" | "mkdirp" | "exists"> & {
		paths: FileSystem["paths"];
	};

	const service = new RunScriptsService({
		terminals: { runScript, outputFor, end, stop: vi.fn(async () => ok(undefined)) },
		configFor: async () => ok(config({ setupScript: options.setupScript ?? "npm install" })),
		workspaceFor: async () => ok({ ...workspace, host: options.host ?? workspace.host }),
		repoFor: async () => ok(repo),
		fs,
		...(options.environmentFor === undefined ? {} : { environmentFor: options.environmentFor }),
	});
	return { service, runScript, end, transcripts };
}

describe("SET-04 environment variables reach scripts", () => {
	it("gives the setup, archive and run scripts the repository's saved variables", async () => {
		const seen: Record<string, string>[] = [];
		const asked: { repo: Repo; workspace: Workspace }[] = [];
		const { service, runScript } = harness({
			environmentFor: async (fromRepo, fromWorkspace) => {
				asked.push({ repo: fromRepo, workspace: fromWorkspace });
				return ok({ TOKEN: "secret" });
			},
		});
		runScript.mockImplementation(async (input: { env: Record<string, string> }) => {
			seen.push({ ...input.env });
			return ok({ terminalId: "t1" as TerminalId, exit: Promise.resolve(0) });
		});

		await service.runSetup(workspace.id);

		expect(runScript).toHaveBeenCalledTimes(1);
		expect(seen[0]?.TOKEN).toBe("secret");
		// The rule needs both folders, so it can read the repository's and the workspace's files.
		expect(asked).toEqual([{ repo, workspace }]);
	});
});

describe("CLOUD-09 a cloud setup script", () => {
	it("runs with strict shell options, as the research has it for a remote host", async () => {
		const { service, runScript } = harness({
			host: { kind: "cloud", url: "https://conducted.example.workers.dev", vmId: "vm-1" },
		});
		await service.runSetup(workspace.id);
		const input = runScript.mock.calls[0]?.[0] as { command: string };
		expect(input.command.startsWith("set -euo pipefail\n")).toBe(true);
	});

	it("leaves a local setup script as written", async () => {
		const { service, runScript } = harness();
		await service.runSetup(workspace.id);
		const input = runScript.mock.calls[0]?.[0] as { command: string };
		expect(input.command).toBe("npm install");
	});
});

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
			scriptFound: true,
			exitCode: 0,
			terminalId: "t1",
			logPath: "/app/setup-logs/w1.log",
			log: "saved",
		});
		expect(transcripts).toEqual([{ path: "/app/setup-logs/w1.log", text: "installed" }]);
	});

	it("keeps the setup log in the app data folder for the workspace's lifetime", async () => {
		const { service, transcripts } = harness({ exitCode: 0 });

		await service.runSetup(workspace.id);

		expect(transcripts[0]?.path).toBe("/app/setup-logs/w1.log");
		expect(transcripts[0]?.path.startsWith("/tmp")).toBe(false);
	});

	it("does not start a terminal when the repository has no setup script", async () => {
		const { service, runScript } = harness({ setupScript: "" });

		const result = await service.runSetup(workspace.id);

		expect(result).toEqual(
			ok({
				scriptFound: false,
				exitCode: null,
				terminalId: null,
				logPath: null,
				log: "missing",
			}),
		);
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
		let scriptStarted: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			scriptStarted = resolve;
		});
		const runScript = vi.fn(
			async (_input: {
				workspaceId: WorkspaceId;
				kind: "setup" | "run" | "spotlight";
				title: string;
				command: string;
				cwd: string;
				env: Readonly<Record<string, string>>;
			}) => {
				scriptStarted();
				return ok({
					terminalId: "t1" as TerminalId,
					exit: new Promise<number | null>((resolve) => {
						release = resolve;
					}),
				});
			},
		);
		const service = new RunScriptsService({
			terminals: {
				runScript,
				outputFor: async () => ok({ output: "", source: "setup", running: false }),
				end: async () => ok(undefined),
				stop: async () => ok(undefined),
			},
			configFor: async () => ok(config()),
			workspaceFor: async () => ok(workspace),
			repoFor: async () => ok(repo),
			fs: {
				writeTextAtomic: async () => ok(undefined),
				mkdirp: async () => ok(undefined),
				exists: async () => true,
				paths: { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" },
			},
		});

		const first = service.runSetup(workspace.id);
		const second = service.runSetup(workspace.id);
		await started;
		release(0);
		await Promise.all([first, second]);

		expect(runScript).toHaveBeenCalledTimes(1);
	});
});

describe("WS-03 RunScriptsService terminals", () => {
	it("ends the earlier setup terminal when setup runs again", async () => {
		const { service, end } = harness();
		await service.runSetup(workspace.id);
		expect(end).not.toHaveBeenCalled();
		await service.runSetup(workspace.id);
		expect(end).toHaveBeenCalledTimes(1);
		expect(end).toHaveBeenCalledWith("t1");
	});

	it("ends the setup terminal when everything stops, once", async () => {
		const { service, end } = harness();
		await service.runSetup(workspace.id);
		await service.runSetup(workspace.id);
		end.mockClear();

		expect((await service.stopAll()).ok).toBe(true);
		expect(end).toHaveBeenCalledTimes(1);
		expect(end).toHaveBeenCalledWith("t2");
		expect((await service.stopAll()).ok).toBe(true);
		expect(end).toHaveBeenCalledTimes(1);
	});

	it("returns the failure when a terminal will not end", async () => {
		const { service, end } = harness();
		await service.runSetup(workspace.id);
		end.mockResolvedValueOnce(err(appError("terminal_close_failed", "Couldn't close it.")));

		const result = await service.stopAll();

		expect(result).toMatchObject({ ok: false, error: { code: "terminal_close_failed" } });
	});
});
