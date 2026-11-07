/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * Owns: tests for the terminal half of a run action: the login shell command, the run kind, the
 * environment, the exit promise, and the stop watchdog.
 * Test first: a run script starts the user's login shell with the script and keeps its output off disk.
 */
import { ok, type RepoId, type TerminalId, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { PtyHandle, PtySpawn } from "../../platform/platform.ts";
import type { Terminal, Workspace } from "../model.ts";
import {
	STOP_NOT_CONFIRMED_MESSAGE,
	TerminalsService,
	type TerminalsServiceDeps,
} from "./terminals.ts";

const workspaceId = "w1" as WorkspaceId;
const repoId = "r1" as RepoId;
const terminalId = "t1" as TerminalId;

const workspace: Workspace = {
	id: workspaceId,
	repoId,
	directoryName: "oslo",
	path: "/ws/oslo",
	branch: "feature/oslo",
	branchIsPlaceholder: false,
	host: { kind: "local" },
	displayName: null,
	targetBranch: "origin/main",
	state: "ready",
	kanbanStatus: "in_progress",
	port: 55_010,
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

const runTerminal: Terminal = {
	id: terminalId,
	workspaceId,
	repoId,
	kind: "run",
	title: "Dev server",
	cwd: "/ws/oslo",
	hostKind: "local",
	startCommand: null,
	startedAt: 1000,
	endedAt: null,
	exitCode: null,
};

function harness() {
	let exitListener: (code: number | null) => void = () => undefined;
	let timer: (() => void) | null = null;
	const spawns: PtySpawn[] = [];
	const markEnded = vi.fn(async () => ok(true));
	const setScreenState = vi.fn(async () => ok(undefined));
	const handle: PtyHandle = {
		id: "pty-1",
		write: async () => {},
		resize: async () => {},
		kill: async () => {},
		onData: () => () => {},
		ack: async () => ok(undefined),
		onExit: (listener) => {
			exitListener = (code) => listener(code, null);
			return () => {};
		},
		screenText: async () => "",
		screenSnapshot: async () =>
			ok({ data: "", cols: 80, rows: 24, alternateScreen: false, bracketedPaste: false }),
	};
	const deps = {
		platform: {
			pty: {
				spawn: async (options: PtySpawn) => {
					spawns.push(options);
					return ok(handle);
				},
				loadHistory: async () => ok(new Uint8Array()),
			},
			shell: { loginEnv: async () => ({ shell: "/bin/zsh", path: "/usr/bin", zdotdir: null }) },
			fs: { exists: async () => true },
		},
		repos: {
			workspaces: { get: async () => ok(workspace) },
			repos: { get: async () => ok({ id: repoId, rootPath: "/repo" }) },
			terminals: {
				start: async () => ok(runTerminal),
				get: async () => ok(runTerminal),
				markEnded,
				setScreenState,
			},
		},
		maxPerWorkspace: () => 5,
		scrollbackLimitBytes: () => 10_000_000,
		now: () => 2000,
		setTimer: (callback: () => void) => {
			timer = callback;
			return () => {
				timer = null;
			};
		},
	} as unknown as TerminalsServiceDeps;
	return {
		service: new TerminalsService(deps),
		spawns,
		markEnded,
		setScreenState,
		exit: (code: number | null) => exitListener(code),
		hasTimer: () => timer !== null,
		fireTimer: () => timer?.(),
	};
}

const input = {
	workspaceId,
	kind: "run" as const,
	title: "Dev server",
	command: "bun dev",
	cwd: "/ws/oslo",
	env: { CONDUCTED_PORT: "55010", TERM: "xterm-256color" },
};

describe("RUN-01 terminals service run scripts", () => {
	it("runs the script in the user's login shell with the run environment", async () => {
		const { service, spawns } = harness();

		const started = await service.runScript(input);

		expect(started.ok).toBe(true);
		expect(spawns[0]).toMatchObject({
			cwd: "/ws/oslo",
			command: { program: "/bin/zsh", args: ["-l", "-c", "bun dev"] },
			env: input.env,
		});
		expect(service.store.getState().byWorkspace[workspaceId]).toEqual([runTerminal]);
	});

	it("resolves the script's exit promise", async () => {
		const { service, exit } = harness();

		const started = await service.runScript(input);
		if (!started.ok) throw new Error(started.error.message);
		exit(7);

		await expect(started.value.exit).resolves.toBe(7);
	});

	it("does not save the screen of a run script", async () => {
		const { service, exit, markEnded, setScreenState } = harness();

		await service.runScript(input);
		exit(0);

		await vi.waitFor(() => expect(markEnded).toHaveBeenCalledWith(terminalId, 2000, 0));
		expect(setScreenState).not.toHaveBeenCalled();
	});

	it("reports a stop that the process did not confirm", async () => {
		const { service, hasTimer, fireTimer } = harness();
		await service.runScript(input);

		const stopping = service.stop(terminalId);
		await vi.waitFor(() => expect(hasTimer()).toBe(true));
		fireTimer();
		const stopped = await stopping;

		expect(stopped).toMatchObject({
			ok: false,
			error: { code: "run_stop_unconfirmed", message: STOP_NOT_CONFIRMED_MESSAGE },
		});
	});

	it("returns when the process exits during a stop", async () => {
		const { service, exit, hasTimer } = harness();
		await service.runScript(input);

		const stopping = service.stop(terminalId);
		await vi.waitFor(() => expect(hasTimer()).toBe(true));
		exit(0);
		const stopped = await stopping;

		expect(stopped.ok).toBe(true);
	});
});
