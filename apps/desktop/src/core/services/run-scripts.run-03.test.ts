/**
 * @feature RUN-03 One port per workspace, port detection and preview URLs
 * Owns: tests for polling a workspace's listening ports into the run state, keeping the newest
 * scan, and activating the macOS app that owns a port.
 * Test first: the newest of two overlapping port scans is the one the Ports tab sees.
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem, ShellOutput } from "../../platform/platform.ts";
import type { Repo, RepoConfig, RunAction, Workspace } from "../model.ts";
import type { ListeningPort } from "./ports.ts";
import { RunScriptsService, type RunScriptsServiceDeps } from "./run-scripts.ts";

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
	directoryName: "workspace-w1",
	path: "/workspaces/w1",
	branch: "branch-w1",
	branchIsPlaceholder: true,
	host: { kind: "local" },
	displayName: null,
	targetBranch: "main",
	state: "ready",
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
	availableIn: ["local", "cloud"],
};

const config: RepoConfig = {
	setupScript: null,
	runScripts: [action],
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
};

interface RunInput {
	workspaceId: WorkspaceId;
	kind: "setup" | "run" | "spotlight";
	title: string;
	command: string;
	cwd: string;
	env: Readonly<Record<string, string>>;
	onOutput?: (text: string) => void;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const shellOutput = (exitCode: number, stderr = ""): Result<ShellOutput> =>
	ok({ exitCode, stdout: "", stderr });

function harness(listed: ListeningPort[] = [], options: { exitCode?: number } = {}) {
	const never = new Promise<number | null>(() => undefined);
	const listListening = vi.fn(
		async (_workspaceId: WorkspaceId, _path: string): Promise<Result<ListeningPort[]>> =>
			ok(listed),
	);
	const shellRun = vi.fn(async () => shellOutput(options.exitCode ?? 0));
	const log = vi.fn();
	const fs = {
		async writeTextAtomic() {
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
	const deps: RunScriptsServiceDeps = {
		terminals: {
			runScript: async (_input: RunInput) => ok({ terminalId: "t1" as TerminalId, exit: never }),
			stop: async () => ok(undefined),
			end: async () => ok(undefined),
			outputFor: async () => ok({ output: "", source: "run", running: false }),
		},
		configFor: async () => ok(config),
		workspaceFor: async () => ok(workspace),
		repoFor: async () => ok(repo),
		fs,
		ports: { listListening },
		shell: { run: shellRun },
		log,
	};
	return { service: new RunScriptsService(deps), listListening, shellRun, log };
}

const ws = workspace.id;

beforeEach(() => {
	globalThis.localStorage.clear();
});

afterEach(() => {
	globalThis.localStorage.clear();
});

describe("RUN-03 run scripts ports", () => {
	it("stores the listening ports with the process name and owning app", async () => {
		const { service } = harness([
			{ port: 3000, pid: 12, command: "node server.js", appName: "Google Chrome" },
		]);

		const refreshed = await service.refreshPorts(ws, workspace.path);

		expect(refreshed.ok).toBe(true);
		expect(service.store.getState().byWorkspace[ws]?.detectedPorts).toEqual([
			{ port: 3000, pid: 12, processName: "node server.js", appName: "Google Chrome" },
		]);
	});

	it("lets only the newest of two overlapping scans change the state", async () => {
		const { service, listListening } = harness();
		const older = deferred<Result<ListeningPort[]>>();
		const newer = deferred<Result<ListeningPort[]>>();
		listListening.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

		const first = service.refreshPorts(ws, workspace.path);
		const second = service.refreshPorts(ws, workspace.path);

		newer.resolve(ok([{ port: 5000, pid: 2, command: "newer", appName: null }]));
		await second;
		older.resolve(ok([{ port: 4000, pid: 1, command: "older", appName: null }]));
		await first;

		expect(
			service.store.getState().byWorkspace[ws]?.detectedPorts.map((entry) => entry.port),
		).toEqual([5000]);
	});

	it("reports a failed scan instead of showing a stale list as new", async () => {
		const { service, listListening, log } = harness();
		listListening.mockResolvedValueOnce(err(appError("ports_unavailable", "lsof is missing.")));

		const refreshed = await service.refreshPorts(ws, workspace.path);

		expect(refreshed.ok).toBe(false);
		expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("lsof is missing."));
	});

	it("starts polling when a run starts", async () => {
		const { service, listListening } = harness();

		const started = await service.start(ws, "dev");
		expect(started.ok).toBe(true);
		await vi.waitFor(() => expect(listListening).toHaveBeenCalled());

		await service.stopAll();
	});

	it("activates the app that owns a port instead of opening the URL", async () => {
		const { service, shellRun } = harness([
			{ port: 3000, pid: 12, command: "Electron", appName: "My App" },
		]);

		const activated = await service.activateApp(ws, 3000);

		expect(activated.ok).toBe(true);
		expect(shellRun).toHaveBeenCalledWith({
			program: "open",
			args: ["-a", "My App"],
			cwd: workspace.path,
		});
	});

	it("refuses to activate a port with no owning app", async () => {
		const { service } = harness([{ port: 3000, pid: 12, command: "node", appName: null }]);

		const activated = await service.activateApp(ws, 3000);

		expect(activated.ok).toBe(false);
		if (!activated.ok) expect(activated.error.code).toBe("app_not_detected");
	});

	it("refuses to activate a port nothing listens on", async () => {
		const { service } = harness([]);

		const activated = await service.activateApp(ws, 3000);

		expect(activated.ok).toBe(false);
		if (!activated.ok) expect(activated.error.code).toBe("port_not_found");
	});

	it("reports a failed activation instead of pretending the app came forward", async () => {
		const { service } = harness([{ port: 3000, pid: 12, command: "Electron", appName: "My App" }], {
			exitCode: 1,
		});

		const activated = await service.activateApp(ws, 3000);

		expect(activated.ok).toBe(false);
		if (!activated.ok) expect(activated.error.code).toBe("app_activate_failed");
	});
});
