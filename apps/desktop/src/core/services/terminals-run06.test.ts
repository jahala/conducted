/**
 * @feature RUN-06 Terminals service: create, close, restart and repo terminal
 * Owns: tests for creating a workspace terminal, its limit and restart divider, with the
 * repositories and PTY passed in as ports.
 * Test first: create records a Terminal N row and types the starting command into the new shell.
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
import type { PtyHandle, PtySpawn } from "../../platform/platform.ts";
import type { Terminal, Workspace } from "../model.ts";
import {
	nextTerminalTitle,
	RESTART_DIVIDER,
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
	displayName: null,
	targetBranch: "origin/main",
	state: "ready",
	kanbanStatus: "in_progress",
	port: 55_010,
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

const terminal = (patch: Partial<Terminal> = {}): Terminal => ({
	id: terminalId,
	workspaceId,
	repoId,
	kind: "terminal",
	title: "Terminal 1",
	cwd: "/ws/oslo",
	startCommand: null,
	startedAt: 1000,
	endedAt: null,
	exitCode: null,
	...patch,
});

function fakeHandle(writes: string[], patch: Partial<PtyHandle> = {}): PtyHandle {
	return {
		id: "pty-1",
		write: async (data) => {
			writes.push(data);
		},
		resize: async () => {},
		kill: async () => {},
		onData: () => () => {},
		ack: () => {},
		onExit: () => () => {},
		screenText: async () => "",
		screenSnapshot: async () =>
			ok({ data: "", cols: 80, rows: 24, alternateScreen: false, bracketedPaste: false }),
		...patch,
	};
}

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function serviceWith(input: {
	existing?: Terminal[];
	started?: Terminal;
	spawn?: (options: PtySpawn) => Promise<Result<PtyHandle>>;
	writes?: string[];
	max?: number;
	folderExists?: boolean;
	listByWorkspace?: () => Promise<Result<Terminal[]>>;
	start?: () => Promise<Result<Terminal>>;
	markEnded?: (
		id: TerminalId,
		endedAt: number,
		exitCode: number | null,
	) => Promise<Result<boolean>>;
	setScreenState?: () => Promise<Result<void>>;
}): TerminalsService {
	const writes = input.writes ?? [];
	const deps = {
		platform: {
			pty: {
				spawn: input.spawn ?? (async () => ok(fakeHandle(writes))),
				loadHistory: async () => ok(new Uint8Array()),
			},
			fs: { exists: async () => input.folderExists ?? true },
		},
		repos: {
			workspaces: { get: async () => ok(workspace) },
			repos: {
				get: async () => ok({ id: repoId, rootPath: "/repos/app" }),
			},
			terminals: {
				listByWorkspace: input.listByWorkspace ?? (async () => ok(input.existing ?? [])),
				listByRepo: async () => ok(input.existing ?? []),
				get: async () => ok(input.started ?? terminal()),
				start: input.start ?? (async () => ok(input.started ?? terminal())),
				markEnded: input.markEnded ?? (async () => ok(true)),
				setScreenState: input.setScreenState ?? (async () => ok(undefined)),
			},
		},
		maxPerWorkspace: () => input.max ?? 5,
		now: () => 2000,
	} as unknown as TerminalsServiceDeps;
	return new TerminalsService(deps);
}

describe("RUN-06 terminals service", () => {
	it("picks the lowest free Terminal N title", () => {
		expect(nextTerminalTitle([])).toBe("Terminal 1");
		expect(nextTerminalTitle([terminal({ id: "a" as never, title: "Terminal 2" })])).toBe(
			"Terminal 1",
		);
		expect(
			nextTerminalTitle([
				terminal({ id: "a" as never, title: "Terminal 1" }),
				terminal({ id: "b" as never, title: "Terminal 3" }),
			]),
		).toBe("Terminal 2");
	});

	it("records a terminal and types the starting command into the new shell", async () => {
		const writes: string[] = [];
		const spawns: PtySpawn[] = [];
		const service = serviceWith({
			started: terminal({ startCommand: "bun dev" }),
			writes,
			spawn: async (options) => {
				spawns.push(options);
				return ok(fakeHandle(writes));
			},
		});

		const created = await service.create(workspace.id, { command: "bun dev" });
		expect(created.ok).toBe(true);
		expect(spawns[0]).toMatchObject({ cwd: "/ws/oslo", cols: 80, rows: 24 });
		expect(service.store.getState().byWorkspace[workspace.id]).toEqual([
			terminal({ startCommand: "bun dev" }),
		]);
		expect(writes).toContain("bun dev\r");
	});

	it("refuses a workspace that is not ready", async () => {
		const deps = {
			platform: {},
			repos: {
				workspaces: { get: async () => ok({ ...workspace, state: "initializing" }) },
			},
			maxPerWorkspace: () => 5,
			now: () => 2000,
		} as unknown as TerminalsServiceDeps;
		const result = await new TerminalsService(deps).create(workspace.id);
		expect(result).toMatchObject({
			ok: false,
			error: { message: "Workspace is not ready for local terminals." },
		});
	});

	it("says the maximum when the workspace is at its terminal limit", async () => {
		const service = serviceWith({
			existing: [terminal({ id: "a" as never }), terminal({ id: "b" as never })],
			max: 2,
		});
		const result = await service.create(workspace.id);
		expect(result).toMatchObject({
			ok: false,
			error: { message: "Maximum 2 terminals allowed" },
		});
	});

	it("draws the divider when a finished shell starts again", async () => {
		const ended = terminal({ endedAt: 1500, exitCode: 0 });
		const writes: string[] = [];
		const service = serviceWith({ started: ended, writes });
		const connection = await (async () => {
			must(await service.ensureConnection(terminalId));
			const next = service.store.getState().connections[terminalId];
			if (next?.state !== "ready") throw new Error("no connection");
			return next.data;
		})();
		const chunks: Uint8Array[] = [];
		connection.onData((chunk) => chunks.push(chunk));

		const result = await service.restart(terminalId);
		expect(result.ok).toBe(true);
		const text = new TextDecoder().decode(chunks[0]);
		expect(text).toContain(RESTART_DIVIDER);
		expect(connection.ended).toBeNull();
	});
});

describe("RUN-06 terminals service hardening", () => {
	it("refuses to start a terminal in a folder that is gone, with no row and no shell", async () => {
		const spawns: PtySpawn[] = [];
		let rows = 0;
		const service = serviceWith({
			folderExists: false,
			start: async () => {
				rows += 1;
				return ok(terminal());
			},
			spawn: async (options) => {
				spawns.push(options);
				return ok(fakeHandle([]));
			},
		});
		const result = await service.create(workspace.id);
		expect(result).toMatchObject({ ok: false, error: { code: "terminal_folder_missing" } });
		expect(rows).toBe(0);
		expect(spawns).toHaveLength(0);
	});

	it("holds the terminal limit when two terminals are created at once", async () => {
		const rows: Terminal[] = [];
		let next = 0;
		const service = serviceWith({
			max: 1,
			listByWorkspace: async () => ok([...rows]),
			start: async () => {
				next += 1;
				const row = terminal({ id: `t${next}` as TerminalId, title: `Terminal ${next}` });
				rows.push(row);
				return ok(row);
			},
		});
		const [first, second] = await Promise.all([
			service.create(workspace.id),
			service.create(workspace.id),
		]);
		expect([first.ok, second.ok].sort()).toEqual([false, true]);
		expect(rows).toHaveLength(1);
	});

	it("starts one shell when a finished terminal is restarted twice at once", async () => {
		const spawns: PtySpawn[] = [];
		const service = serviceWith({
			started: terminal({ endedAt: 1500, exitCode: 0 }),
			spawn: async (options) => {
				spawns.push(options);
				return ok(fakeHandle([]));
			},
		});
		const [first, second] = await Promise.all([
			service.restart(terminalId),
			service.restart(terminalId),
		]);
		expect(first.ok && second.ok).toBe(true);
		expect(spawns).toHaveLength(1);
	});

	it("keeps the newest list when two loads of one workspace answer out of order", async () => {
		const older = deferred<Result<Terminal[]>>();
		const newer = deferred<Result<Terminal[]>>();
		const answers = [older, newer];
		const service = serviceWith({
			listByWorkspace: () => (answers.shift() as typeof older).promise,
		});
		const first = service.loadWorkspace(workspace.id);
		const second = service.loadWorkspace(workspace.id);
		newer.resolve(ok([terminal({ title: "Terminal 2" })]));
		await second;
		older.resolve(ok([]));
		await first;
		expect(service.store.getState().byWorkspace[workspace.id]?.map((t) => t.title)).toEqual([
			"Terminal 2",
		]);
	});

	it("keeps a new terminal when a load that began earlier answers after it", async () => {
		const slow = deferred<Result<Terminal[]>>();
		const answers: (() => Promise<Result<Terminal[]>>)[] = [() => slow.promise, async () => ok([])];
		const service = serviceWith({ listByWorkspace: () => (answers.shift() as () => never)() });
		const load = service.loadWorkspace(workspace.id);
		const created = await service.create(workspace.id);
		expect(created.ok).toBe(true);
		slow.resolve(ok([]));
		await load;
		expect(service.store.getState().byWorkspace[workspace.id]).toEqual([terminal()]);
	});

	it("keeps the failure when a finished terminal's end time cannot be saved", async () => {
		let exit: (code: number | null) => void = () => undefined;
		const service = serviceWith({
			spawn: async () =>
				ok(
					fakeHandle([], {
						onExit: (listener) => {
							exit = listener;
							return () => {};
						},
					}),
				),
			markEnded: async () => err(appError("db_failed", "disk full")),
		});
		must(await service.create(workspace.id));
		exit(0);
		await vi.waitFor(() => {
			expect(service.store.getState().errors[`t:${terminalId}`]?.code).toBe("db_failed");
		});
	});

	it("keeps the failure when a finished terminal's screen cannot be saved", async () => {
		let exit: (code: number | null) => void = () => undefined;
		const service = serviceWith({
			spawn: async () =>
				ok(
					fakeHandle([], {
						onExit: (listener) => {
							exit = listener;
							return () => {};
						},
					}),
				),
			setScreenState: async () => err(appError("db_failed", "screen not saved")),
		});
		must(await service.create(workspace.id));
		exit(0);
		await vi.waitFor(() => {
			expect(service.store.getState().errors[`t:${terminalId}`]?.message).toBe("screen not saved");
		});
	});

	it("keeps the failure when the starting command cannot be typed", async () => {
		const service = serviceWith({
			started: terminal({ startCommand: "bun dev" }),
			spawn: async () =>
				ok(
					fakeHandle([], {
						write: async () => {
							throw new Error("pty closed");
						},
					}),
				),
		});
		const created = await service.create(workspace.id, { command: "bun dev" });
		expect(created.ok).toBe(true);
		expect(service.store.getState().errors[`t:${terminalId}`]?.code).toBe("terminal_write_failed");
	});

	it("marks the row ended and says so when the shell cannot start", async () => {
		const ended: TerminalId[] = [];
		const service = serviceWith({
			spawn: async () => err(appError("pty_failed", "no pty")),
			markEnded: async (id) => {
				ended.push(id);
				return err(appError("db_failed", "disk full"));
			},
		});
		const result = await service.create(workspace.id);
		expect(result).toMatchObject({ ok: false, error: { code: "pty_failed" } });
		expect(ended).toEqual([terminalId]);
		expect(service.store.getState().errors[`t:${terminalId}`]?.code).toBe("db_failed");
	});

	it("reports a process that would not die on quit, and still ends every row", async () => {
		const ended: TerminalId[] = [];
		const service = serviceWith({
			spawn: async () =>
				ok(
					fakeHandle([], {
						kill: async () => {
							throw new Error("kill refused");
						},
					}),
				),
			markEnded: async (id) => {
				ended.push(id);
				return ok(true);
			},
		});
		must(await service.create(workspace.id));
		const result = await service.killAll();
		expect(result).toMatchObject({ ok: false, error: { code: "terminal_kill_failed" } });
		expect(ended).toEqual([terminalId]);
		expect(service.store.getState().byWorkspace[workspace.id]?.[0]?.endedAt).toBe(2000);
	});
});

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
	if (!result.ok) throw new Error("expected ok");
	return result.value;
}
