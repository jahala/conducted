/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * Owns: tests for starting and stopping actions, run mode, parked starts, auto-run after setup,
 * quoted arguments, folder variables, the URL found in output, the newest-attempt rule, a stop
 * while a start is still opening, the saved history, and clearing a workspace's runs.
 * Test first: starting an action while another runs in the same workspace stops the first.
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
import type { FileSystem } from "../../platform/platform.ts";
import type { Repo, RepoConfig, RunAction, Workspace } from "../model.ts";
import {
	RUN_HISTORY_LIMIT,
	RunScriptsService,
	runHistoryStorageKey,
	type SetupRunResult,
} from "./run-scripts.ts";

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

const workspaceFor = (id: WorkspaceId, patch: Partial<Workspace> = {}): Workspace => ({
	id,
	repoId: repo.id,
	directoryName: `workspace-${id}`,
	path: `/workspaces/${id}`,
	branch: `branch-${id}`,
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
	...patch,
});

const action = (patch: Partial<RunAction> = {}): RunAction => ({
	id: "dev",
	label: "Dev server",
	command: "bun dev",
	args: [],
	cwd: null,
	isDefault: true,
	hidden: false,
	icon: null,
	origin: "local",
	...patch,
});

const config = (patch: Partial<RepoConfig> = {}): RepoConfig => ({
	setupScript: null,
	runScripts: [action()],
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
	...patch,
});

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

function harness(
	options: {
		config?: RepoConfig;
		workspaces?: Workspace[];
		runScript?: (
			input: RunInput,
			call: number,
		) => Promise<Result<{ terminalId: TerminalId; exit: Promise<number | null> }>>;
		stop?: (id: TerminalId) => Promise<Result<void>>;
	} = {},
) {
	let nextTerminal = 0;
	let calls = 0;
	const never = new Promise<number | null>(() => undefined);
	const runScript = vi.fn(async (input: RunInput) => {
		calls += 1;
		if (options.runScript !== undefined) return options.runScript(input, calls);
		nextTerminal += 1;
		return ok({ terminalId: `t${nextTerminal}` as TerminalId, exit: never });
	});
	const stop = vi.fn(options.stop ?? (async () => ok(undefined) as Result<void>));
	const close = vi.fn(async (_id: TerminalId) => ok(undefined) as Result<void>);
	const outputFor = vi.fn(async () => ok({ output: "", source: "setup", running: false }));
	const writeTextAtomic = vi.fn(async (_path: string, _text: string) => ok(undefined));
	const fs = {
		writeTextAtomic,
		async mkdirp() {
			return ok(undefined);
		},
		paths: { home: "/home", appData: "/app", temp: "/tmp", resources: "/res" },
	} as unknown as Pick<FileSystem, "writeTextAtomic" | "mkdirp"> & {
		paths: FileSystem["paths"];
	};
	const workspaces =
		options.workspaces ??
		(["w1", "w2"] as WorkspaceId[]).map((id) => workspaceFor(id as WorkspaceId));
	const service = new RunScriptsService({
		terminals: { runScript, stop, close, outputFor },
		configFor: async () => ok(options.config ?? config()),
		workspaceFor: async (id) =>
			ok(workspaces.find((workspace) => workspace.id === id) ?? workspaceFor(id)),
		repoFor: async () => ok(repo),
		fs,
	});
	return { service, runScript, stop, close, writeTextAtomic };
}

const ws = "w1" as WorkspaceId;
const ws2 = "w2" as WorkspaceId;

beforeEach(() => {
	globalThis.localStorage.clear();
});

afterEach(() => {
	globalThis.localStorage.clear();
});

describe("RUN-01 run scripts service", () => {
	it("starts the default action with quoted args and the expanded folder variables", async () => {
		const { service, runScript } = harness({
			config: config({
				runScripts: [
					action({
						command: "bun",
						args: ["run", "start", "--name", "a b"],
						cwd: "$CONDUCTED_WORKSPACE_PATH/src",
					}),
				],
			}),
		});

		const started = await service.start(ws, "dev");

		expect(started.ok).toBe(true);
		expect(runScript).toHaveBeenCalledTimes(1);
		const input = runScript.mock.calls[0]?.[0] as RunInput;
		expect(input).toMatchObject({
			kind: "run",
			title: "Dev server",
			command: "bun run start --name 'a b'",
			cwd: "/workspaces/w1/src",
		});
		expect(input.env.CONDUCTED_PORT).toBe("55000");
		expect(input.env.TERM).toBe("xterm-256color");
		expect(input.env.CONDUCTED_PATH_PREFIX).toBe("/res/bin");
		expect(service.store.getState().phases[ws]).toBe("running");
		expect(service.store.getState().byWorkspace[ws]?.running[0]).toMatchObject({
			actionId: "dev",
			terminalId: "t1",
			phase: "running",
		});
	});

	it("stops the workspace's previous action before starting another one", async () => {
		const { service, runScript, stop } = harness({
			config: config({
				runScripts: [
					action(),
					action({ id: "test", label: "Tests", command: "bun test", isDefault: false }),
				],
			}),
		});

		await service.start(ws, "dev");
		await service.start(ws, "test");

		expect(stop).toHaveBeenCalledWith("t1");
		expect(runScript).toHaveBeenCalledTimes(2);
		expect(service.store.getState().byWorkspace[ws]?.running[0]?.actionId).toBe("test");
	});

	it("stops another workspace's action in exclusive run mode", async () => {
		const { service, stop } = harness({ config: config({ runMode: "exclusive" }) });

		await service.start(ws, "dev");
		await service.start(ws2, "dev");

		expect(stop).toHaveBeenCalledWith("t1");
		expect(service.store.getState().byWorkspace[ws2]?.running[0]?.actionId).toBe("dev");
	});

	it("parks a start while setup runs and starts it when setup finishes", async () => {
		let finishSetup = (code: number): void => {
			void code;
		};
		const setupExit = new Promise<number | null>((resolve) => {
			finishSetup = (code) => resolve(code);
		});
		const { service, runScript } = harness({
			config: config({ setupScript: "bun install" }),
			workspaces: [workspaceFor(ws, { state: "initializing" })],
			runScript: async (input) => {
				if (input.kind === "setup") {
					return ok({ terminalId: "setup" as TerminalId, exit: setupExit });
				}
				return ok({ terminalId: "run" as TerminalId, exit: new Promise(() => undefined) });
			},
		});

		const setup = service.runSetup(ws);
		await vi.waitFor(() => expect(runScript).toHaveBeenCalledTimes(1));
		await service.start(ws, "dev");

		expect(service.store.getState().phases[ws]).toBe("waiting_for_setup");
		expect(service.store.getState().byWorkspace[ws]?.running).toEqual([]);

		finishSetup(0);
		const finished = await setup;

		expect(finished.ok).toBe(true);
		expect(runScript).toHaveBeenCalledTimes(2);
		expect(service.store.getState().phases[ws]).toBe("running");
	});

	it("does not start a parked action when setup fails", async () => {
		let finishSetup = (code: number): void => {
			void code;
		};
		const setupExit = new Promise<number | null>((resolve) => {
			finishSetup = (code) => resolve(code);
		});
		const { service, runScript } = harness({
			config: config({ setupScript: "bun install" }),
			workspaces: [workspaceFor(ws, { state: "initializing" })],
			runScript: async (input) => {
				if (input.kind === "setup") {
					return ok({ terminalId: "setup" as TerminalId, exit: setupExit });
				}
				return ok({ terminalId: "run" as TerminalId, exit: new Promise(() => undefined) });
			},
		});

		const setup = service.runSetup(ws);
		await vi.waitFor(() => expect(runScript).toHaveBeenCalledTimes(1));
		await service.start(ws, "dev");
		finishSetup(1);
		const finished = await setup;

		expect(finished.ok).toBe(true);
		expect(runScript).toHaveBeenCalledTimes(1);
		expect(service.store.getState().phases[ws]).toBe("stopped");
	});

	it("runs the default action after a successful setup when the repository asks for it", async () => {
		const { service, runScript } = harness({ config: config({ autoRunAfterSetup: true }) });

		const finished = await service.runSetup(ws);

		expect(finished.ok).toBe(true);
		expect(runScript).toHaveBeenCalledTimes(1);
		expect(service.store.getState().byWorkspace[ws]?.running[0]?.actionId).toBe("dev");
	});

	it("does not run an action after a failed setup", async () => {
		const { service, runScript } = harness({
			config: config({ setupScript: "bun install", autoRunAfterSetup: true }),
			runScript: async (input) =>
				input.kind === "setup"
					? ok({ terminalId: "setup" as TerminalId, exit: Promise.resolve(1) })
					: ok({ terminalId: "run" as TerminalId, exit: new Promise(() => undefined) }),
		});

		await service.runSetup(ws);

		expect(runScript).toHaveBeenCalledTimes(1);
		expect(service.store.getState().byWorkspace[ws]?.running ?? []).toEqual([]);
	});

	it("reports a stop that did not confirm and still returns the button to Run", async () => {
		const { service } = harness({
			stop: async () => err(appError("run_stop_unconfirmed", "Stop not confirmed.")),
		});

		await service.start(ws, "dev");
		const stopped = await service.stop(ws, "dev");

		expect(stopped).toMatchObject({ ok: false, error: { code: "run_stop_unconfirmed" } });
		expect(service.store.getState().phases[ws]).toBe("stopped");
		expect(service.store.getState().byWorkspace[ws]?.running).toEqual([]);
		expect(service.store.getState().outcomes[ws]).toBe("stop-unconfirmed");
	});

	it("keeps the last local URL found in the run output", async () => {
		const { service } = harness({
			runScript: async (input) => {
				input.onOutput?.("compiled\nready at http://localhost:3000\n");
				return ok({ terminalId: "t1" as TerminalId, exit: new Promise(() => undefined) });
			},
		});

		await service.start(ws, "dev");

		expect(service.store.getState().byWorkspace[ws]?.running[0]?.url).toBe("http://localhost:3000");
	});

	it("lets only the newest start change state", async () => {
		const first = deferred<Result<{ terminalId: TerminalId; exit: Promise<number | null> }>>();
		let reachedRun = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			reachedRun = resolve;
		});
		const { service, runScript, stop } = harness({
			config: config({
				runScripts: [action(), action({ id: "test", label: "Tests", isDefault: false })],
			}),
			runScript: async (_input, call) => {
				if (call === 1) {
					reachedRun();
					return first.promise;
				}
				return ok({ terminalId: "t2" as TerminalId, exit: new Promise(() => undefined) });
			},
		});

		const older = service.start(ws, "dev");
		await started;
		await service.start(ws, "test");
		first.resolve(ok({ terminalId: "t1" as TerminalId, exit: new Promise(() => undefined) }));
		await older;

		expect(runScript).toHaveBeenCalledTimes(2);
		expect(stop).toHaveBeenCalledWith("t1");
		expect(service.store.getState().byWorkspace[ws]?.running[0]?.actionId).toBe("test");
	});

	it("stops the setup and run terminals of a workspace together", async () => {
		const { service, stop } = harness({
			config: config({ setupScript: "bun install" }),
			runScript: async (input) => {
				if (input.kind === "setup") {
					return ok({ terminalId: "t1" as TerminalId, exit: Promise.resolve(0) });
				}
				return ok({ terminalId: "t2" as TerminalId, exit: new Promise(() => undefined) });
			},
		});

		const setup = await service.runSetup(ws);
		expect(setup.ok).toBe(true);
		await service.start(ws, "dev");
		await service.stopWorkspace(ws);

		expect(stop.mock.calls.map(([id]) => id)).toEqual(expect.arrayContaining(["t1", "t2"]));
	});

	it("stops every workspace of a repository", async () => {
		const { service, stop } = harness();

		await service.start(ws, "dev");
		await service.start(ws2, "dev");
		await service.stopAllForRepository([ws, ws2]);

		expect(stop.mock.calls.map(([id]) => id)).toEqual(expect.arrayContaining(["t1", "t2"]));
	});

	it("moves a run to the front of the history and keeps it without duplicates", async () => {
		const { service } = harness({
			config: config({
				runScripts: [action(), action({ id: "test", label: "Tests", isDefault: false })],
			}),
		});

		await service.start(ws, "dev");
		await service.start(ws, "test");
		await service.start(ws, "dev");

		expect(service.store.getState().history[ws]).toEqual(["dev", "test"]);
	});

	it("reports the busy state and the last run counter", async () => {
		const { service } = harness();

		await service.start(ws, "dev");

		expect(service.isBusy(ws)).toBe(true);
		expect(service.lastRunId(ws)).toBe(1);
	});

	it("stops a run whose terminal is still opening", async () => {
		const opened = deferred<Result<{ terminalId: TerminalId; exit: Promise<number | null> }>>();
		let reached = (): void => undefined;
		const inFlight = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const { service, stop: stopTerminal } = harness({
			runScript: async () => {
				reached();
				return opened.promise;
			},
		});

		const starting = service.start(ws, "dev");
		await inFlight;
		expect(service.store.getState().phases[ws]).toBe("starting");

		const stopped = await service.stop(ws, "dev");

		expect(stopped.ok).toBe(true);
		expect(service.store.getState().phases[ws]).toBe("stopped");

		opened.resolve(ok({ terminalId: "t1" as TerminalId, exit: new Promise(() => undefined) }));
		await starting;

		expect(stopTerminal).toHaveBeenCalledWith("t1");
		expect(service.store.getState().phases[ws]).toBe("stopped");
		expect(service.store.getState().byWorkspace[ws]?.running).toEqual([]);
	});

	it("stops another workspace's start that is still opening in exclusive mode", async () => {
		const opened = deferred<Result<{ terminalId: TerminalId; exit: Promise<number | null> }>>();
		let reached = (): void => undefined;
		const inFlight = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const { service, stop: stopTerminal } = harness({
			config: config({ runMode: "exclusive" }),
			runScript: async (_input, call) => {
				if (call === 1) {
					reached();
					return opened.promise;
				}
				return ok({ terminalId: "t2" as TerminalId, exit: new Promise(() => undefined) });
			},
		});

		const first = service.start(ws, "dev");
		await inFlight;
		await service.start(ws2, "dev");

		expect(service.store.getState().phases[ws]).toBe("stopped");
		expect(service.store.getState().byWorkspace[ws2]?.running[0]?.actionId).toBe("dev");

		opened.resolve(ok({ terminalId: "t1" as TerminalId, exit: new Promise(() => undefined) }));
		await first;

		expect(stopTerminal).toHaveBeenCalledWith("t1");
		expect(service.store.getState().phases[ws]).toBe("stopped");
	});

	it("cancels a start that is still opening when its workspace is stopped", async () => {
		const opened = deferred<Result<{ terminalId: TerminalId; exit: Promise<number | null> }>>();
		let reached = (): void => undefined;
		const inFlight = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const { service, stop: stopTerminal } = harness({
			runScript: async () => {
				reached();
				return opened.promise;
			},
		});

		const starting = service.start(ws, "dev");
		await inFlight;
		await service.stopWorkspace(ws);

		expect(service.store.getState().phases[ws]).toBe("stopped");

		opened.resolve(ok({ terminalId: "t1" as TerminalId, exit: new Promise(() => undefined) }));
		await starting;

		expect(stopTerminal).toHaveBeenCalledWith("t1");
		expect(service.store.getState().phases[ws]).toBe("stopped");
	});

	it("stops a start parked for setup without running anything", async () => {
		const { service, runScript } = harness({
			workspaces: [workspaceFor(ws, { state: "initializing" })],
		});

		await service.start(ws, "dev");
		expect(service.store.getState().phases[ws]).toBe("waiting_for_setup");

		const stopped = await service.stop(ws, "dev");

		expect(stopped.ok).toBe(true);
		expect(service.store.getState().phases[ws]).toBe("stopped");
		expect(runScript).not.toHaveBeenCalled();
	});

	it("does not start a new action while the previous stop is not confirmed", async () => {
		const { service, runScript } = harness({
			config: config({
				runScripts: [
					action(),
					action({ id: "test", label: "Tests", command: "bun test", isDefault: false }),
				],
			}),
			stop: async () => err(appError("run_stop_unconfirmed", "Stop not confirmed.")),
		});

		await service.start(ws, "dev");
		const started = await service.start(ws, "test");

		expect(started).toMatchObject({ ok: false, error: { code: "run_stop_unconfirmed" } });
		expect(runScript).toHaveBeenCalledTimes(1);
		expect(service.store.getState().phases[ws]).toBe("stopped");
		expect(service.store.getState().outcomes[ws]).toBe("stop-unconfirmed");
	});

	it("keeps the last 20 run ids per workspace across a new service", async () => {
		const actions = [
			action(),
			action({ id: "test", label: "Tests", command: "bun test", isDefault: false }),
		];
		const first = harness({ config: config({ runScripts: actions }) });

		await first.service.start(ws, "dev");
		await first.service.start(ws, "test");

		const second = harness({ config: config({ runScripts: actions }) });

		expect(second.service.store.getState().history[ws]).toEqual(["test", "dev"]);
		expect(JSON.parse(globalThis.localStorage.getItem(runHistoryStorageKey(ws)) ?? "[]")).toEqual([
			"test",
			"dev",
		]);
	});

	it("keeps at most 20 run ids in a saved history", async () => {
		const stored = Array.from({ length: RUN_HISTORY_LIMIT }, (_, index) => `old-${index}`);
		globalThis.localStorage.setItem(runHistoryStorageKey(ws), JSON.stringify(stored));

		const { service } = harness();

		await service.start(ws, "dev");

		const history = service.store.getState().history[ws] ?? [];
		expect(history).toHaveLength(RUN_HISTORY_LIMIT);
		expect(history[0]).toBe("dev");
	});

	it("clears a workspace's run state, history and last run id", async () => {
		const { service } = harness();

		await service.start(ws, "dev");
		service.clearRuns(ws);

		expect(service.store.getState().history[ws]).toBeUndefined();
		expect(service.store.getState().phases[ws]).toBeUndefined();
		expect(service.store.getState().byWorkspace[ws]).toBeUndefined();
		expect(service.lastRunId(ws)).toBeNull();
		expect(globalThis.localStorage.getItem(runHistoryStorageKey(ws))).toBeNull();
	});

	it("never writes run output to disk", async () => {
		const { service, writeTextAtomic } = harness();

		await service.start(ws, "dev");

		expect(writeTextAtomic).not.toHaveBeenCalled();
	});
});

describe("RUN-01 setup auto-run integration", () => {
	it("starts the default action after a setup script exits 0", async () => {
		const { service, runScript } = harness({
			config: config({
				setupScript: "bun install",
				autoRunAfterSetup: true,
			}),
			runScript: async (input) => {
				if (input.kind === "setup") {
					return ok({ terminalId: "t1" as TerminalId, exit: Promise.resolve(0) });
				}
				return ok({ terminalId: "t2" as TerminalId, exit: new Promise(() => undefined) });
			},
		});

		const setup = await service.runSetup(ws);

		expect(setup.ok).toBe(true);
		expect(runScript).toHaveBeenCalledTimes(2);
		const last = runScript.mock.calls.at(-1)?.[0] as RunInput;
		expect(last.kind).toBe("run");
	});

	it("does not start an action after a setup script exits nonzero", async () => {
		const { service, runScript } = harness({
			config: config({ setupScript: "bun install", autoRunAfterSetup: true }),
			runScript: async (input) => {
				if (input.kind === "setup") {
					return ok({ terminalId: "t1" as TerminalId, exit: Promise.resolve(1) });
				}
				return ok({ terminalId: "t2" as TerminalId, exit: new Promise(() => undefined) });
			},
		});

		const setup: Result<SetupRunResult> = await service.runSetup(ws);

		expect(setup.ok).toBe(true);
		expect(runScript).toHaveBeenCalledTimes(1);
	});
});
