/**
 * @feature SET-13 Chosen program paths reach terminals and scripts
 * Owns: tests that setup, run and archive scripts carry `CONDUCTED_PATH_PREFIX`.
 * Test first: a setup script's environment gets the folder the path prefix source returns.
 */
import { ok, type RepoId, type Result, type TerminalId, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { FileSystem, ShellCommand } from "../../platform/platform.ts";
import type { Repo, RepoConfig, RunAction, Workspace } from "../model.ts";
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
	path: "/workspaces/w1",
	branch: "branch-w1",
	branchIsPlaceholder: true,
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
	lastActivityAt: 1,
	createdAt: 1,
	updatedAt: 1,
};

const action: RunAction = {
	id: "dev",
	label: "Dev server",
	command: "bun dev",
	args: [],
	cwd: null,
	isDefault: true,
	hidden: false,
	icon: null,
	origin: "local",
};

const baseConfig: RepoConfig = {
	setupScript: "bun install",
	runScripts: [action],
	runMode: "concurrent",
	archiveScript: "bun run clean",
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
};

interface RunInput {
	workspaceId: WorkspaceId;
	kind: "setup" | "run" | "spotlight";
	title: string;
	command: string;
	cwd: string;
	env: Readonly<Record<string, string>>;
}

function harness(options: { pathPrefixFor?: () => Promise<Result<string>> } = {}) {
	let nextTerminal = 0;
	const runs: RunInput[] = [];
	const shellCalls: ShellCommand[] = [];
	const never = new Promise<number | null>(() => undefined);
	const runScript = vi.fn(async (input: RunInput) => {
		runs.push(input);
		nextTerminal += 1;
		return ok({
			terminalId: `t${nextTerminal}` as TerminalId,
			exit: input.kind === "setup" ? Promise.resolve(0) : never,
		});
	});
	const shellRun = vi.fn(async (command: ShellCommand) => {
		shellCalls.push(command);
		return ok({ exitCode: 0, stdout: "", stderr: "" });
	});
	const fs = {
		async writeTextAtomic() {
			return ok(undefined);
		},
		async mkdirp() {
			return ok(undefined);
		},
		paths: { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" },
	} as unknown as Pick<FileSystem, "writeTextAtomic" | "mkdirp"> & {
		paths: FileSystem["paths"];
	};
	const service = new RunScriptsService({
		terminals: {
			runScript,
			stop: async () => ok(undefined),
			end: async () => ok(undefined),
			outputFor: async () => ok({ output: "", source: "setup", running: false }),
		},
		configFor: async () => ok(baseConfig),
		workspaceFor: async () => ok(workspace),
		repoFor: async () => ok(repo),
		fs,
		shell: { run: shellRun },
		pathPrefixFor: options.pathPrefixFor,
	});
	return { service, runs, shellCalls };
}

const shimFolder = "/data/bin-overrides/abc";

describe("SET-13 scripts receive the chosen program path prefix", () => {
	it("puts the prefix in a setup script's environment", async () => {
		const { service, runs } = harness({ pathPrefixFor: async () => ok(shimFolder) });

		const result = await service.runSetup(workspace.id);

		expect(result.ok).toBe(true);
		expect(runs[0]?.kind).toBe("setup");
		expect(runs[0]?.env.CONDUCTED_PATH_PREFIX).toBe(shimFolder);
	});

	it("puts the prefix in a run action's environment", async () => {
		const { service, runs } = harness({ pathPrefixFor: async () => ok(shimFolder) });

		const result = await service.start(workspace.id, action.id);

		expect(result.ok).toBe(true);
		expect(runs[0]?.kind).toBe("run");
		expect(runs[0]?.env.CONDUCTED_PATH_PREFIX).toBe(shimFolder);
	});

	it("puts the prefix in an archive script's environment", async () => {
		const { service, shellCalls } = harness({ pathPrefixFor: async () => ok(shimFolder) });

		const result = await service.runArchive(workspace.id);

		expect(result.ok).toBe(true);
		expect(shellCalls[0]?.env?.CONDUCTED_PATH_PREFIX).toBe(shimFolder);
	});

	it("uses the bundled bin folder when no prefix source is wired", async () => {
		const { service, runs } = harness();

		await service.start(workspace.id, action.id);

		expect(runs[0]?.env.CONDUCTED_PATH_PREFIX).toBe("/app/bin");
	});
});
