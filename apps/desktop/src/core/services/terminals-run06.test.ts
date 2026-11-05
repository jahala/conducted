/**
 * @feature RUN-06 Terminals service: create, close, restart and repo terminal
 * Owns: tests for creating a workspace terminal, its limit and restart divider, with the
 * repositories and PTY passed in as ports.
 * Test first: create records a Terminal N row and types the starting command into the new shell.
 */
import { ok, type RepoId, type Result, type TerminalId, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
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

function fakeHandle(writes: string[]): PtyHandle {
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
	};
}

function serviceWith(input: {
	existing?: Terminal[];
	started?: Terminal;
	spawn?: (options: PtySpawn) => Promise<Result<PtyHandle>>;
	writes?: string[];
	max?: number;
}): TerminalsService {
	const writes = input.writes ?? [];
	const deps = {
		platform: {
			pty: {
				spawn: input.spawn ?? (async () => ok(fakeHandle(writes))),
				loadHistory: async () => ok(new Uint8Array()),
			},
		},
		repos: {
			workspaces: { get: async () => ok(workspace) },
			repos: {
				get: async () => ok({ id: repoId, rootPath: "/repos/app" }),
			},
			terminals: {
				listByWorkspace: async () => ok(input.existing ?? []),
				listByRepo: async () => ok(input.existing ?? []),
				get: async () => ok(input.started ?? terminal()),
				start: async () => ok(input.started ?? terminal()),
				markEnded: async () => ok(true),
				setScreenState: async () => ok(undefined),
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

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
	if (!result.ok) throw new Error("expected ok");
	return result.value;
}
