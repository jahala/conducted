// @vitest-environment node
/**
 * @feature CHAT-21 Fork a chat to a new workspace
 * Tests the fork service: a turn's end checkpoint gives the new workspace its branch head and is
 * restored into the new worktree, a turn without an end checkpoint falls back to its start, a
 * chat is copied into the new workspace, and a failed step removes the new workspace again.
 * Test first: forking at a turn creates a workspace at that turn's checkpoint head and copies the
 * chat into it.
 */
import type { SessionEvent } from "@conducted/protocol";
import {
	type AppError,
	appError,
	err,
	ok,
	type SessionId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import {
	agentEvent,
	appendChatEvents,
	checkpointEvent,
	turnEndedEvent,
	userMessageEvent,
} from "../../test/chat-events.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { FakeGitRunner, gitUnscripted } from "../../test/fake-git-runner.ts";
import type { NewWorkspaceInput } from "../api.ts";
import { createRepositories } from "../db/repositories.ts";
import { sampleSession } from "../db/test-fixtures.ts";
import type { GitCommand } from "../git/commands.ts";
import type { Workspace } from "../model.ts";
import { CheckpointService, type CheckpointServiceDeps } from "./checkpoint.ts";

const SCRIPT = "/bin/checkpointer.sh";
const HEAD = "checkpoint-head-sha";
const TURN = "t1" as TurnId;

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

interface Harness {
	test: TestContainer;
	service: CheckpointService;
	sessionId: SessionId;
	workspace: Workspace;
	target: Workspace;
	forkedId: SessionId;
	createCalls: { input: NewWorkspaceInput; baseSha: string }[];
	forkCalls: { sessionId: SessionId; turnId: TurnId; workspaceId: WorkspaceId }[];
	removed: WorkspaceId[];
	commands: GitCommand[];
}

interface HarnessOptions {
	events: readonly SessionEvent[];
	refPresent?: boolean;
	head?: string | null;
	restore?: ShellOutput;
	createFails?: AppError;
	forkFails?: AppError;
}

let current: TestContainer | null = null;

afterEach(async () => {
	await current?.container.stop();
	current?.close();
	current = null;
});

async function harness(options: HarnessOptions): Promise<Harness> {
	const test = createTestContainer();
	current = test;
	const started = await test.container.services.settings.start();
	if (!started.ok) throw new Error(JSON.stringify(started.error));
	const repo = await seedRepo(test.container, { rootPath: "/code/projects/fork" });
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		path: "/code/workspaces/origin",
		targetBranch: "main",
	});
	const created = await test.container.services.sessions.create(workspace.id, sampleSession.config);
	if (!created.ok) throw new Error(JSON.stringify(created.error));
	const sessionId = created.value.id;
	await appendChatEvents(test.container, sessionId, options.events);

	const targetId = crypto.randomUUID() as WorkspaceId;
	const forkId = crypto.randomUUID() as SessionId;
	const target: Workspace = {
		...workspace,
		id: targetId,
		path: "/code/workspaces/fork",
		branch: "test-place",
		activeSessionId: null,
	};
	const forked = { ...sampleSession, id: forkId, workspaceId: targetId };
	const createCalls: Harness["createCalls"] = [];
	const forkCalls: Harness["forkCalls"] = [];
	const removed: WorkspaceId[] = [];

	const git = new FakeGitRunner((command) => {
		if (command.program === SCRIPT) {
			if (command.args[0] === "restore") return ok(options.restore ?? output());
			return gitUnscripted(command);
		}
		if (command.args[0] === "show-ref") {
			return ok(output("", "", options.refPresent === false ? 1 : 0));
		}
		if (command.args[0] === "cat-file") {
			const head = options.head === undefined ? HEAD : options.head;
			const value = head === null ? "0000000000000000000000000000000000000000" : head;
			return ok(output(`checkpoint:x\nhead ${value}\nindex-tree tree\nworktree-tree tree\n`));
		}
		return gitUnscripted(command);
	});

	const deps: CheckpointServiceDeps = {
		git,
		checkpointerPath: SCRIPT,
		workspacePathOf: async () => ok(workspace.path),
		events: { markRevertedFromTurn: async () => ok(0) },
		markViewReverted: () => {},
		setting: <T>() => false as T,
		repositories: () =>
			createRepositories(test.database, {
				clock: { now: () => 0 },
				ids: { uuid: () => crypto.randomUUID() },
			}),
		createWorkspaceFromCommit: async (input, baseSha) => {
			createCalls.push({ input, baseSha });
			return options.createFails === undefined ? ok(target) : err(options.createFails);
		},
		forkSessionInto: async (originId, turnId, workspaceId) => {
			forkCalls.push({ sessionId: originId, turnId, workspaceId });
			return options.forkFails === undefined ? ok(forked) : err(options.forkFails);
		},
		removeWorkspace: async (id) => {
			removed.push(id);
			return ok(undefined);
		},
		now: () => 1_000,
	};

	return {
		test,
		service: new CheckpointService(deps),
		sessionId,
		workspace,
		target,
		forkedId: forkId,
		createCalls,
		forkCalls,
		removed,
		commands: git.commands,
	};
}

const checkpointedTurn = (): SessionEvent[] => [
	userMessageEvent("u1", "t1", 10),
	checkpointEvent("c1", "t1", 11, "start", "start-1"),
	agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
	checkpointEvent("c2", "t1", 13, "end", "end-1"),
	turnEndedEvent("e1", "t1", 14),
];

describe("CHAT-21 fork a chat to a new workspace", () => {
	it("creates the workspace at the turn's end checkpoint and copies the chat into it", async () => {
		const h = await harness({ events: checkpointedTurn() });

		const result = await h.service.forkToWorkspace(h.sessionId, TURN);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.id).toBe(h.target.id);
		expect(result.value.activeSessionId).toBe(h.forkedId);
		expect(h.createCalls).toEqual([
			{
				input: expect.objectContaining({
					repoId: h.workspace.repoId,
					from: { kind: "branch", name: "main" },
					prompt: "",
					attachmentPaths: [],
					sectionId: null,
				}),
				baseSha: HEAD,
			},
		]);
		expect(h.forkCalls).toEqual([
			{ sessionId: h.sessionId, turnId: TURN, workspaceId: h.target.id },
		]);
		const restored = h.commands.filter(
			(command) => command.program === SCRIPT && command.args[0] === "restore",
		);
		expect(restored.map((command) => command.args)).toEqual([["restore", "end-1"]]);
		expect(h.removed).toEqual([]);
	});

	it("uses the start checkpoint when the turn has no end checkpoint", async () => {
		const h = await harness({
			events: [
				userMessageEvent("u1", "t1", 10),
				checkpointEvent("c1", "t1", 11, "start", "start-1"),
				agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
				turnEndedEvent("e1", "t1", 13),
			],
		});

		const result = await h.service.forkToWorkspace(h.sessionId, TURN);

		expect(result.ok).toBe(true);
		const restored = h.commands.filter(
			(command) => command.program === SCRIPT && command.args[0] === "restore",
		);
		expect(restored.map((command) => command.args)).toEqual([["restore", "start-1"]]);
	});

	it("refuses a turn with no checkpoint and creates nothing", async () => {
		const h = await harness({
			events: [
				userMessageEvent("u1", "t1", 10),
				agentEvent("a1", "t1", 11, [{ kind: "text", text: "First answer" }]),
				turnEndedEvent("e1", "t1", 12),
			],
		});

		const result = await h.service.forkToWorkspace(h.sessionId, TURN);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("chat_fork_no_checkpoint");
			expect(result.error.message).toBe("Checkpoint not found for this turn.");
		}
		expect(h.createCalls).toEqual([]);
		expect(h.forkCalls).toEqual([]);
	});

	it("refuses a turn that is not in the chat", async () => {
		const h = await harness({ events: checkpointedTurn() });

		const result = await h.service.forkToWorkspace(h.sessionId, "t9" as TurnId);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("chat_fork_turn_unknown");
		expect(h.createCalls).toEqual([]);
	});

	it("refuses a checkpoint whose ref is already gone", async () => {
		const h = await harness({ events: checkpointedTurn(), refPresent: false });

		const result = await h.service.forkToWorkspace(h.sessionId, TURN);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("chat_fork_no_checkpoint");
		expect(h.createCalls).toEqual([]);
	});

	it("refuses a checkpoint with no commit to branch from", async () => {
		const h = await harness({ events: checkpointedTurn(), head: null });

		const result = await h.service.forkToWorkspace(h.sessionId, TURN);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("chat_fork_no_head");
		expect(h.createCalls).toEqual([]);
	});

	it("removes the new workspace when the checkpoint cannot be restored", async () => {
		const h = await harness({
			events: checkpointedTurn(),
			restore: output("", "", 1),
		});

		const result = await h.service.forkToWorkspace(h.sessionId, TURN);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("chat_fork_restore_failed");
		expect(h.removed).toEqual([h.target.id]);
		expect(h.forkCalls).toEqual([]);
	});

	it("removes the new workspace when the chat cannot be copied", async () => {
		const failure = appError("db", "The chat could not be copied.");
		const h = await harness({ events: checkpointedTurn(), forkFails: failure });

		const result = await h.service.forkToWorkspace(h.sessionId, TURN);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toEqual(failure);
		expect(h.removed).toEqual([h.target.id]);
	});
});
