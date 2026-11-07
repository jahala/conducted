/**
 * @feature RUN-07 Terminal output for the GetTerminalOutput tool
 * Owns: tests for reading a terminal's text for an agent: the source rule, the default line
 * count, the fixed sentences, and the fallback from the live screen to the text of a finished run.
 * Test first: outputFor reads the live screen with the requested line count and says it is running.
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
	DEFAULT_TERMINAL_OUTPUT_LINES,
	NO_RUN_OUTPUT,
	NO_SAVED_OUTPUT,
	NO_SPOTLIGHT_OUTPUT,
	NO_TERMINAL_OUTPUT,
	snapshotText,
	TerminalsService,
	type TerminalsServiceDeps,
} from "./terminals.ts";

const workspaceId = "w1" as WorkspaceId;
const repoId = "r1" as RepoId;

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
	id: "t1" as TerminalId,
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

const snapshot = (data: string): string =>
	JSON.stringify({ data, cols: 80, rows: 24, alternateScreen: false, bracketedPaste: false });

function fakeHandle(patch: Partial<PtyHandle> = {}): PtyHandle {
	return {
		id: "pty-1",
		write: async () => {},
		resize: async () => {},
		kill: async () => {},
		onData: () => () => {},
		ack: async () => ok(undefined),
		onExit: () => () => {},
		screenText: async () => "",
		screenSnapshot: async () =>
			ok({ data: "", cols: 80, rows: 24, alternateScreen: false, bracketedPaste: false }),
		...patch,
	};
}

function serviceWith(input: {
	existing?: Terminal[];
	started?: Terminal;
	spawn?: (options: PtySpawn) => Promise<Result<PtyHandle>>;
	get?: (id: TerminalId) => Promise<Result<Terminal | null>>;
	listByWorkspace?: () => Promise<Result<Terminal[]>>;
	getScreenState?: (id: TerminalId) => Promise<Result<string | null>>;
}): TerminalsService {
	const existing = input.existing ?? [];
	const deps = {
		platform: {
			pty: {
				spawn: input.spawn ?? (async () => ok(fakeHandle())),
				loadHistory: async () => ok(new Uint8Array()),
			},
			fs: { exists: async () => true },
		},
		repos: {
			workspaces: { get: async () => ok(workspace) },
			repos: { get: async () => ok({ id: repoId, rootPath: "/repos/app" }) },
			terminals: {
				listByWorkspace: input.listByWorkspace ?? (async () => ok(existing)),
				listByRepo: async () => ok(existing),
				get: input.get ?? (async () => ok(input.started ?? existing[0] ?? terminal())),
				start: async () => ok(input.started ?? terminal()),
				markEnded: async () => ok(true),
				setScreenState: async () => ok(undefined),
				getScreenState: input.getScreenState ?? (async () => ok(null)),
			},
		},
		maxPerWorkspace: () => 5,
		scrollbackLimitBytes: () => 10_000_000,
		now: () => 2000,
	} as unknown as TerminalsServiceDeps;
	return new TerminalsService(deps);
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
	if (!result.ok) throw new Error("expected ok");
	return result.value;
}

describe("RUN-07 outputFor reads the live screen", () => {
	it("returns the live screen, the source label and that it still runs", async () => {
		const screenText = vi.fn(async () => "live one\nlive two");
		const service = serviceWith({
			existing: [terminal()],
			started: terminal(),
			spawn: async () => ok(fakeHandle({ screenText })),
		});
		must(await service.create(workspaceId));

		const result = await service.outputFor(workspaceId, "terminal", 10);
		expect(result).toMatchObject({
			ok: true,
			value: { output: "live one\nlive two", source: "Terminal", running: true },
		});
		expect(screenText).toHaveBeenCalledWith(10);
	});

	it("asks for 1000 lines when the request has no positive count", async () => {
		const screenText = vi.fn(async () => "text");
		const service = serviceWith({
			existing: [terminal()],
			started: terminal(),
			spawn: async () => ok(fakeHandle({ screenText })),
		});
		must(await service.create(workspaceId));

		must(await service.outputFor(workspaceId, "terminal", 0));
		expect(screenText).toHaveBeenCalledWith(DEFAULT_TERMINAL_OUTPUT_LINES);
	});

	it("keeps the failure when the live screen cannot be read", async () => {
		const service = serviceWith({
			existing: [terminal()],
			started: terminal(),
			spawn: async () =>
				ok(
					fakeHandle({
						screenText: async () => {
							throw new Error("pty gone");
						},
					}),
				),
		});
		must(await service.create(workspaceId));

		const result = await service.outputFor(workspaceId, "terminal", 10);
		expect(result).toMatchObject({ ok: false, error: { code: "terminal_output_failed" } });
	});
});

describe("RUN-07 outputFor picks the named source", () => {
	it("auto prefers Spotlight, then the run script, then the newest terminal", async () => {
		const service = serviceWith({
			existing: [
				terminal({ id: "old" as TerminalId, kind: "terminal", startedAt: 1 }),
				terminal({ id: "spot" as TerminalId, kind: "spotlight", startedAt: 2 }),
				terminal({ id: "run" as TerminalId, kind: "run", startedAt: 3 }),
			],
			getScreenState: async () => ok(snapshot("spotlight text")),
		});

		const result = await service.outputFor(workspaceId, "auto", 10);
		expect(result).toMatchObject({
			ok: true,
			value: { output: "spotlight text", source: "Spotlight", running: false },
		});
	});

	it("auto uses the run script when there is no Spotlight terminal", async () => {
		const service = serviceWith({
			existing: [
				terminal({ id: "run" as TerminalId, kind: "run", startedAt: 2 }),
				terminal({ id: "tab" as TerminalId, kind: "terminal", startedAt: 3 }),
			],
			getScreenState: async () => ok(snapshot("run text")),
		});

		const result = await service.outputFor(workspaceId, "auto", 10);
		expect(result).toMatchObject({
			ok: true,
			value: { output: "run text", source: "Action", running: false },
		});
	});

	it("auto uses the newest interactive terminal when no script terminal exists", async () => {
		const older = terminal({ id: "older" as TerminalId, startedAt: 1 });
		const newer = terminal({ id: "newer" as TerminalId, startedAt: 2 });
		const asked: TerminalId[] = [];
		const service = serviceWith({
			existing: [older, newer],
			getScreenState: async (id) => {
				asked.push(id);
				return ok(snapshot(id === newer.id ? "newer text" : "older text"));
			},
		});

		const result = await service.outputFor(workspaceId, "auto", 10);
		expect(result).toMatchObject({ ok: true, value: { output: "newer text", source: "Terminal" } });
		expect(asked).toEqual([newer.id]);
	});

	it("run_script reads the run terminal and labels it Action", async () => {
		const service = serviceWith({
			existing: [
				terminal({ id: "tab" as TerminalId, kind: "terminal", startedAt: 1 }),
				terminal({ id: "run" as TerminalId, kind: "run", startedAt: 2 }),
			],
			getScreenState: async () => ok(snapshot("action text")),
		});

		const result = await service.outputFor(workspaceId, "run_script", 10);
		expect(result).toMatchObject({
			ok: true,
			value: { output: "action text", source: "Action", running: false },
		});
	});

	it("an explicit terminal id wins over the source rule", async () => {
		const wanted = terminal({ id: "wanted" as TerminalId, startedAt: 1 });
		const service = serviceWith({
			existing: [terminal({ id: "spot" as TerminalId, kind: "spotlight", startedAt: 5 })],
			get: async (id) => ok(id === wanted.id ? wanted : null),
			getScreenState: async () => ok(snapshot("wanted text")),
		});

		const result = await service.outputFor(workspaceId, "auto", 10, wanted.id);
		expect(result).toMatchObject({
			ok: true,
			value: { output: "wanted text", source: "Terminal" },
		});
	});

	it("refuses an explicit terminal that no longer exists", async () => {
		const service = serviceWith({ get: async () => ok(null) });
		const result = await service.outputFor(workspaceId, "terminal", 10, "gone" as TerminalId);
		expect(result).toMatchObject({ ok: false, error: { code: "terminal_unknown" } });
	});

	it("hands on a failure to list the workspace's terminals", async () => {
		const failure = appError("db_failed", "disk unavailable");
		const service = serviceWith({ listByWorkspace: async () => err(failure) });
		const result = await service.outputFor(workspaceId, "terminal", 10);
		expect(result).toEqual(err(failure));
	});
});

describe("RUN-07 outputFor returns a readable sentence when a source has no terminal", () => {
	it.each([
		["spotlight", NO_SPOTLIGHT_OUTPUT, "Spotlight"],
		["run_script", NO_RUN_OUTPUT, "Action"],
		["terminal", NO_TERMINAL_OUTPUT, "Terminal"],
		["auto", NO_TERMINAL_OUTPUT, "Terminal"],
	] as const)(
		"says what is missing for %s without an error result",
		async (source, sentence, label) => {
			const service = serviceWith({ existing: [] });
			const result = await service.outputFor(workspaceId, source, 10);
			expect(result).toEqual(ok({ output: sentence, source: label, running: false }));
		},
	);
});

describe("RUN-07 outputFor falls back for an ended run", () => {
	it("reads the saved screen when the run had ended before this app session", async () => {
		const service = serviceWith({
			existing: [terminal({ endedAt: 1500, exitCode: 0 })],
			getScreenState: async () => ok(snapshot("\u001b[2J\u001b[Hone\r\ntwo\r\n")),
		});

		const result = await service.outputFor(workspaceId, "terminal", 10);
		expect(result).toMatchObject({
			ok: true,
			value: { output: "one\ntwo", source: "Terminal", running: false },
		});
	});

	it("returns only the last lines of the saved screen", async () => {
		const service = serviceWith({
			existing: [terminal({ endedAt: 1500, exitCode: 0 })],
			getScreenState: async () => ok(snapshot("one\ntwo\nthree")),
		});

		const result = await service.outputFor(workspaceId, "terminal", 2);
		expect(result).toMatchObject({ ok: true, value: { output: "two\nthree" } });
	});

	it("returns every saved line when more lines are asked than exist", async () => {
		const service = serviceWith({
			existing: [terminal({ endedAt: 1500, exitCode: 0 })],
			getScreenState: async () => ok(snapshot("one\ntwo")),
		});

		const result = await service.outputFor(workspaceId, "terminal", 5000);
		expect(result).toMatchObject({ ok: true, value: { output: "one\ntwo" } });
	});

	it("keeps the text captured when this run's terminal ended, before asking the database", async () => {
		let exit: (code: number | null) => void = () => undefined;
		const askedScreen = vi.fn(async () => ok(null));
		const service = serviceWith({
			existing: [terminal()],
			started: terminal(),
			spawn: async () =>
				ok(
					fakeHandle({
						screenText: async () => "kept in memory",
						onExit: (listener) => {
							exit = (code) => listener(code, null);
							return () => {};
						},
					}),
				),
			getScreenState: askedScreen,
		});
		must(await service.create(workspaceId));
		exit(0);

		const result = await service.outputFor(workspaceId, "terminal", 10);
		expect(result).toMatchObject({
			ok: true,
			value: { output: "kept in memory", running: false },
		});
		expect(askedScreen).not.toHaveBeenCalled();
	});

	it("says there is no saved output when an ended terminal has no kept text or screen", async () => {
		const service = serviceWith({
			existing: [terminal({ endedAt: 1500, exitCode: 0 })],
			getScreenState: async () => ok(null),
		});
		const result = await service.outputFor(workspaceId, "terminal", 10);
		expect(result).toEqual(ok({ output: NO_SAVED_OUTPUT, source: "Terminal", running: false }));
	});

	it("says there is no saved output for an ended run script, whose screen is never saved", async () => {
		const service = serviceWith({
			existing: [terminal({ id: "run" as TerminalId, kind: "run", endedAt: 1500, exitCode: 0 })],
			getScreenState: async () => ok(null),
		});
		const result = await service.outputFor(workspaceId, "run_script", 10);
		expect(result).toEqual(ok({ output: NO_SAVED_OUTPUT, source: "Action", running: false }));
	});

	it("keeps the failure when the saved screen is not a screen snapshot", async () => {
		const service = serviceWith({
			existing: [terminal({ endedAt: 1500, exitCode: 0 })],
			getScreenState: async () => ok("not json"),
		});
		const result = await service.outputFor(workspaceId, "terminal", 10);
		expect(result).toMatchObject({ ok: false, error: { code: "terminal_output_failed" } });
	});

	it("hands on a failure to read the saved screen", async () => {
		const failure = appError("db_failed", "disk unavailable");
		const service = serviceWith({
			existing: [terminal({ endedAt: 1500, exitCode: 0 })],
			getScreenState: async () => err(failure),
		});
		const result = await service.outputFor(workspaceId, "terminal", 10);
		expect(result).toEqual(err(failure));
	});
});

describe("RUN-07 snapshotText", () => {
	it("turns a saved screen into plain lines", () => {
		expect(snapshotText(snapshot("\u001b[2J\u001b[Hhello\r\nworld\r\n"))).toEqual(
			ok("hello\nworld\n"),
		);
	});

	it("refuses text that is not a snapshot", () => {
		expect(snapshotText("not json")).toMatchObject({
			ok: false,
			error: { code: "terminal_output_failed" },
		});
		expect(snapshotText(JSON.stringify({ data: 42 }))).toMatchObject({
			ok: false,
			error: { code: "terminal_output_failed" },
		});
	});
});
