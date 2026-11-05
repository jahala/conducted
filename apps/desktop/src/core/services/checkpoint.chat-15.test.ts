// @vitest-environment node
/**
 * @feature CHAT-15 Revert to a turn
 * Tests the revert service: a missing start checkpoint changes nothing, the start checkpoint is
 * restored with the checkpointer before events are marked, the files option can be off, a failed
 * restore keeps the chat unchanged, and a real container marks stored events without deleting them.
 * Test first: reverting to a turn without a start checkpoint returns an Err and changes nothing.
 */
import { appError, err, ok, type SessionId, type TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { FakeGitRunner, gitUnscripted } from "../../test/fake-git-runner.ts";
import { createRepositories } from "../db/repositories.ts";
import {
	agentEvent,
	sampleSession,
	turnEndedEvent,
	userMessageEvent,
} from "../db/test-fixtures.ts";
import type { GitCommand } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import { CheckpointService, type CheckpointServiceDeps } from "./checkpoint.ts";

const SCRIPT = "/bin/checkpointer.sh";
const session = "s1" as SessionId;
const turn = "t1" as TurnId;

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

interface Harness {
	service: CheckpointService;
	commands: GitCommand[];
	marked: { sessionId: SessionId; turnId: TurnId; at: number }[];
	views: { sessionId: SessionId; turnId: TurnId; at: number }[];
	worktreeLocks: string[];
}

function harness(options: {
	refPresent: boolean;
	restore?: ShellOutput;
	restoreError?: boolean;
	alsoResetFiles?: boolean;
	markError?: boolean;
	markRevertedFromTurn?: CheckpointServiceDeps["events"]["markRevertedFromTurn"];
}): Harness {
	const marked: Harness["marked"] = [];
	const views: Harness["views"] = [];
	const git: GitRunner = new FakeGitRunner((command) => {
		if (command.args[0] === "show-ref") {
			return ok(output("", "", options.refPresent ? 0 : 1));
		}
		if (command.program === SCRIPT && command.args[0] === "restore") {
			if (options.restoreError === true) {
				return err(appError("shell_failed", "The checkpointer could not start."));
			}
			return ok(options.restore ?? output());
		}
		return gitUnscripted(command);
	});
	const fake = git as FakeGitRunner;
	const service = new CheckpointService({
		git,
		checkpointerPath: SCRIPT,
		workspacePathOf: async () => ok("/repo/worktree"),
		events: {
			markRevertedFromTurn:
				options.markRevertedFromTurn ??
				(async (sessionId, turnId, at) => {
					marked.push({ sessionId, turnId, at });
					return options.markError === true
						? { ok: false as const, error: { code: "db", message: "The database is busy." } }
						: ok(1);
				}),
		},
		markViewReverted: (sessionId, turnId, at) => views.push({ sessionId, turnId, at }),
		setting: <T>(key: string) =>
			(key === "reset_chat_also_reset_files" ? (options.alsoResetFiles ?? false) : false) as T,
		now: () => 700,
		sleep: async () => {},
	});
	return { service, commands: fake.commands, marked, views, worktreeLocks: fake.worktreeLocks };
}

const restoreCommands = (commands: GitCommand[]): GitCommand[] =>
	commands.filter((command) => command.program === SCRIPT && command.args[0] === "restore");

describe("CHAT-15 revert to a turn", () => {
	it("refuses a turn with no start checkpoint and changes nothing", async () => {
		const h = harness({ refPresent: false, alsoResetFiles: true });

		const result = await h.service.revertTo(session, turn);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("checkpoint_missing");
			expect(result.error.message).toBe("This turn has no checkpoint to revert to.");
		}
		expect(restoreCommands(h.commands)).toHaveLength(0);
		expect(h.marked).toHaveLength(0);
		expect(h.views).toHaveLength(0);
	});

	it("restores the start checkpoint, then marks later events as reverted", async () => {
		const h = harness({ refPresent: true, alsoResetFiles: true });

		const result = await h.service.revertTo(session, turn);

		expect(result).toEqual(ok(undefined));
		const restored = restoreCommands(h.commands);
		expect(restored).toHaveLength(1);
		expect(restored[0]?.args).toEqual(["restore", "session-s1-turn-t1-start"]);
		expect(h.worktreeLocks).toContain("/repo/worktree");
		expect(h.marked).toEqual([{ sessionId: session, turnId: turn, at: 700 }]);
		expect(h.views).toEqual([{ sessionId: session, turnId: turn, at: 700 }]);
	});

	it("only rewinds the chat when the files option is off", async () => {
		const h = harness({ refPresent: true, alsoResetFiles: false });

		const result = await h.service.revertTo(session, turn);

		expect(result).toEqual(ok(undefined));
		expect(restoreCommands(h.commands)).toHaveLength(0);
		expect(h.marked).toHaveLength(1);
	});

	it("does not mark events when the restore fails or writes to stderr", async () => {
		for (const restore of [output("", "", 1), output("", "warning on stderr", 0)]) {
			const h = harness({ refPresent: true, alsoResetFiles: true, restore });

			const result = await h.service.revertTo(session, turn);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.message).toBe("No changes or conversation history have been reverted.");
			}
			expect(h.marked).toHaveLength(0);
			expect(h.views).toHaveLength(0);
		}
	});

	it("says the same thing when the checkpointer cannot start", async () => {
		const h = harness({ refPresent: true, alsoResetFiles: true, restoreError: true });

		const result = await h.service.revertTo(session, turn);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toBe("No changes or conversation history have been reverted.");
		}
		expect(h.marked).toHaveLength(0);
		expect(h.views).toHaveLength(0);
	});

	it("hands on a failure to mark the events", async () => {
		const h = harness({ refPresent: true, alsoResetFiles: false, markError: true });

		const result = await h.service.revertTo(session, turn);

		expect(result.ok).toBe(false);
		expect(h.views).toHaveLength(0);
	});

	it("marks every event from the turn onward in a real container, and keeps the rows", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const created = await test.container.services.sessions.create(
				workspace.id,
				sampleSession.config,
			);
			expect(created.ok).toBe(true);
			if (!created.ok) return;
			const sessionId = created.value.id;

			const repositories = createRepositories(test.database, {
				clock: { now: () => 0 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			const events = [
				userMessageEvent("e0", "t0", 5),
				agentEvent("e1", "t0", 6, [{ kind: "text", text: "Earlier answer" }]),
				turnEndedEvent("e2", "t0", 7),
				userMessageEvent("e3", "t1", 10),
				agentEvent("e4", "t1", 11, [{ kind: "text", text: "First answer" }]),
				turnEndedEvent("e5", "t1", 12),
				userMessageEvent("e6", "t2", 20),
				agentEvent("e7", "t2", 21, [{ kind: "text", text: "Second answer" }]),
				turnEndedEvent("e8", "t2", 22),
			];
			for (const event of events) {
				const appended = await repositories.sessionEvents.append(sessionId, event, event.at);
				expect(appended.ok).toBe(true);
			}
			const opened = await test.container.services.sessions.open(sessionId);
			expect(opened.ok).toBe(true);
			expect(test.container.services.sessions.chatView(sessionId)?.turns).toHaveLength(3);

			const saved = await test.container.services.settings.set("reset_chat_also_reset_files", true);
			expect(saved.ok).toBe(true);
			test.memory.controls.scriptShell((command) => {
				if (command.args.includes("show-ref")) return ok(output("", "", 0));
				if (command.args[0] === "restore") return ok(output());
				return null;
			});

			const reverted = await test.container.services.checkpoint.revertTo(sessionId, "t1" as TurnId);
			expect(reverted).toEqual(ok(undefined));

			const rows = await repositories.sessionEvents.listFrom(sessionId, 0, 100);
			expect(rows.ok).toBe(true);
			if (!rows.ok) return;
			expect(rows.value).toHaveLength(events.length);
			for (const row of rows.value.slice(0, 3)) expect(row.revertedAt).toBeNull();
			for (const row of rows.value.slice(3)) expect(row.revertedAt).not.toBeNull();

			const stored = test.container.services.sessions.store.getState().events[sessionId] ?? [];
			expect(stored).toHaveLength(events.length);
			for (const row of stored.slice(0, 3)) expect(row.revertedAt).toBeNull();
			for (const row of stored.slice(3)) expect(row.revertedAt).not.toBeNull();
			expect(test.container.services.sessions.chatView(sessionId)?.turns).toHaveLength(1);
			expect(test.memory.controls.shellCalls.some((command) => command.args[0] === "restore")).toBe(
				true,
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
