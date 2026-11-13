// @vitest-environment node
/**
 * @feature CHAT-06 Message list: a chat's history loads a few turns at a time
 * Reaches the chat's paging through the real composition root, the actions contract and a real
 * SQLite: the open reads the last five turns and lists every turn, older turns load one at a time,
 * a picked turn loads alone and leaves a gap that fills one turn at a time from either side (#652),
 * and what a loaded turn shows is what a build of every turn shows.
 * Test first: a chat of twelve turns opens on its last five and lists all twelve.
 */
import type { AgentItem, SessionEvent } from "@conducted/protocol";
import type { EventId, Result, SessionId, ToolUseId, TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	createTestContainer,
	seedRepo,
	seedRevertFromTurn,
	seedSessionEvent,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { failingOnSelect } from "../../test/failing-database.ts";
import { SESSION_EVENTS_SQL } from "../db/session-events.ts";
import {
	agentEvent,
	sampleSession,
	turnEndedEvent,
	userMessageEvent,
} from "../db/test-fixtures.ts";

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/** A turn's message, saying which turn it is. */
const message = (index: number): SessionEvent => {
	const event = userMessageEvent(`u${index}`, `t${index}`, index * 10);
	return event.type === "user_message" ? { ...event, text: `Message ${index}` } : event;
};

/** One turn: a message, a reply and its end. */
const turn = (index: number): SessionEvent[] => [
	message(index),
	agentEvent(`a${index}`, `t${index}`, index * 10 + 1, [{ kind: "text", text: `Reply ${index}` }]),
	turnEndedEvent(`e${index}`, `t${index}`, index * 10 + 2),
];

async function chatWith(
	events: readonly SessionEvent[],
	options: Parameters<typeof createTestContainer>[0] = {},
): Promise<{ test: TestContainer; id: SessionId }> {
	const test = createTestContainer(options);
	await test.container.services.settings.start();
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const chat = must(
		await test.container.services.sessions.create(workspace.id, sampleSession.config),
	);
	for (const event of events) await seedSessionEvent(test.container, chat.id, event, event.at);
	return { test, id: chat.id };
}

const turnIds = (test: TestContainer, id: SessionId): string[] =>
	test.container.services.sessions.chatView(id)?.turns.map((entry) => entry.turnId) ?? [];

const range = (from: number, to: number): number[] =>
	Array.from({ length: to - from }, (_, index) => from + index);

describe("CHAT-06 a chat's history loads a few turns at a time (#617)", () => {
	it("a chat of twelve turns opens on its last five and lists all twelve", async () => {
		const { test, id } = await chatWith(range(0, 12).flatMap(turn));
		try {
			must(await test.container.services.sessions.open(id));
			const view = test.container.services.sessions.chatView(id);

			expect(turnIds(test, id)).toEqual(range(7, 12).map((index) => `t${index}`));
			expect(view?.history).toEqual({ olderTurnId: "t6", older: "idle", gaps: [] });
			expect(view?.outline.map((entry) => entry.turnId)).toEqual(range(0, 12).map((i) => `t${i}`));
			// A turn that is not loaded shows the start of its message from the stored list.
			expect(view?.outline[0]).toEqual({
				turnId: "t0",
				text: "Message 0",
				plan: false,
				running: false,
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("loads one older turn at a time, and a picked turn alone, leaving a gap that fills from either side (#652)", async () => {
		const { test, id } = await chatWith(range(0, 12).flatMap(turn));
		try {
			const actions = test.container.actions.sessions;
			const sessions = test.container.services.sessions;
			must(await sessions.open(id));

			must(await actions.loadOlder(id));
			expect(turnIds(test, id)).toEqual(range(6, 12).map((index) => `t${index}`));
			expect(sessions.chatView(id)?.history.olderTurnId).toBe("t5");

			// The picked turn loads alone, as Conductor's revealTurn adds a range of its own.
			must(await actions.revealTurn(id, "t2" as TurnId));
			expect(turnIds(test, id)).toEqual(["t2", ...range(6, 12).map((index) => `t${index}`)]);
			expect(sessions.chatView(id)?.history).toEqual({
				olderTurnId: "t1",
				older: "idle",
				gaps: [{ beforeTurnId: "t6", state: "idle" }],
			});
			// The outline still lists every turn in order, the gap's turns from the stored list.
			expect(sessions.chatView(id)?.outline.map((entry) => entry.turnId)).toEqual(
				range(0, 12).map((index) => `t${index}`),
			);

			// The gap fills next to the earlier run, then next to the later one.
			must(await actions.fillGap(id, "t6" as TurnId, "after-earlier"));
			expect(turnIds(test, id)).toEqual(["t2", "t3", ...range(6, 12).map((index) => `t${index}`)]);
			must(await actions.fillGap(id, "t6" as TurnId, "before-later"));
			expect(turnIds(test, id)).toEqual(
				range(2, 4)
					.concat(range(5, 12))
					.map((index) => `t${index}`),
			);
			expect(sessions.chatView(id)?.history.gaps).toEqual([{ beforeTurnId: "t5", state: "idle" }]);
			// Its last turn closes it.
			must(await actions.fillGap(id, "t5" as TurnId, "before-later"));
			expect(turnIds(test, id)).toEqual(range(2, 12).map((index) => `t${index}`));
			expect(sessions.chatView(id)?.history.gaps).toEqual([]);

			// A gap that is gone, or a turn already loaded, loads nothing.
			must(await actions.fillGap(id, "t5" as TurnId, "after-earlier"));
			must(await actions.revealTurn(id, "t4" as TurnId));
			expect(turnIds(test, id)).toEqual(range(2, 12).map((index) => `t${index}`));

			must(await actions.revealTurn(id, "t0" as TurnId));
			must(await actions.fillGap(id, "t2" as TurnId, "before-later"));
			expect(turnIds(test, id)).toEqual(range(0, 12).map((index) => `t${index}`));
			expect(sessions.chatView(id)?.history).toEqual({
				olderTurnId: null,
				older: "idle",
				gaps: [],
			});
			// Nothing older is left; a further load changes nothing.
			must(await actions.loadOlder(id));
			expect(turnIds(test, id)).toHaveLength(12);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("a failed gap fill says so on its gap, and the next fill loads the turn", async () => {
		let failing = false;
		const { test, id } = await chatWith(range(0, 12).flatMap(turn), {
			wrapDatabase: (database) =>
				failingOnSelect(
					database,
					SESSION_EVENTS_SQL.listTurns,
					new Error("The disk is gone."),
					() => failing,
				),
		});
		try {
			const sessions = test.container.services.sessions;
			must(await sessions.open(id));
			must(await test.container.actions.sessions.revealTurn(id, "t2" as TurnId));
			failing = true;
			const failed = await test.container.actions.sessions.fillGap(
				id,
				"t7" as TurnId,
				"after-earlier",
			);
			expect(failed.ok).toBe(false);
			expect(sessions.chatView(id)?.history.gaps).toEqual([
				{ beforeTurnId: "t7", state: "failed" },
			]);

			failing = false;
			must(await test.container.actions.sessions.fillGap(id, "t7" as TurnId, "after-earlier"));
			expect(turnIds(test, id)).toEqual(["t2", "t3", ...range(7, 12).map((index) => `t${index}`)]);
			expect(sessions.chatView(id)?.history.gaps).toEqual([{ beforeTurnId: "t7", state: "idle" }]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("a short chat loads whole, and a turn whose every event is reverted is not counted", async () => {
		const { test, id } = await chatWith(range(0, 8).flatMap(turn));
		try {
			await seedRevertFromTurn(test.container, id, "t5" as TurnId, 100);
			must(await test.container.services.sessions.open(id));
			const view = test.container.services.sessions.chatView(id);

			// Turns 5 to 7 are reverted and hidden, so the last five shown are 0 to 4: all of them.
			expect(turnIds(test, id)).toEqual(range(0, 5).map((index) => `t${index}`));
			expect(view?.history.olderTurnId).toBeNull();
			expect(view?.outline).toHaveLength(5);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("an event of a turn that is not loaded waits in the database and comes with its turn", async () => {
		const { test, id } = await chatWith(range(0, 7).flatMap(turn));
		try {
			const sessions = test.container.services.sessions;
			must(await sessions.open(id));
			expect(turnIds(test, id)).toEqual(range(2, 7).map((index) => `t${index}`));

			// A late event for turn 0, as startup repair or a lost sidecar's close can store.
			const late = agentEvent("late", "t0", 500, [{ kind: "text", text: "Late reply" }]);
			await seedSessionEvent(test.container, id, late, late.at);
			sessions.applyStoredEvent(id, 21, late, late.at);
			expect(turnIds(test, id)).toEqual(range(2, 7).map((index) => `t${index}`));

			must(await test.container.actions.sessions.revealTurn(id, "t0" as TurnId));
			const first = sessions.chatView(id)?.turns[0];
			expect(first?.turnId).toBe("t0");
			expect(first?.blocks.map((block) => (block.kind === "text" ? block.text : ""))).toEqual([
				"Reply 0",
				"Late reply",
			]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("a loaded turn shows what a build of every turn shows, when its late work belongs to a call of a turn not loaded", async () => {
		const task = "task-1" as ToolUseId;
		const call: AgentItem = {
			kind: "tool_call",
			toolUseId: task,
			tool: "sub_agent",
			rawName: "Task",
			input: { description: "background helper" },
		};
		const lateWork: SessionEvent = {
			type: "agent",
			eventId: "helper" as EventId,
			at: 91,
			turnId: "t9" as TurnId,
			message: {
				agent: "claude",
				parentToolUseId: task,
				items: [{ kind: "text", text: "Helper finished" }],
			},
		};
		const lateResult = agentEvent("result", "t9", 92, [
			{ kind: "tool_result", toolUseId: task, output: "done", isError: false, truncated: false },
		]);
		const events = range(0, 12).flatMap((index) => {
			const events = turn(index);
			if (index === 1) events.splice(1, 0, agentEvent("call", "t1", 11, [call]));
			if (index === 9) events.splice(2, 0, lateWork, lateResult);
			return events;
		});
		const { test, id } = await chatWith(events);
		try {
			const sessions = test.container.services.sessions;
			must(await sessions.open(id));
			const complete = must(await sessions.completeTurns(id));
			const shown = sessions.chatView(id)?.turns ?? [];

			// The helper's work and the call's result are in turn 1's card; turn 9 shows neither.
			expect(shown.map((entry) => entry.turnId)).toEqual(range(7, 12).map((i) => `t${i}`));
			expect(shown).toEqual(complete.slice(7));
			const ninth = shown.find((entry) => entry.turnId === "t9");
			expect(ninth?.blocks).toEqual([{ kind: "text", text: "Reply 9" }]);

			// Once turn 1 loads alone, its card holds the work, as in the build of every turn, and the
			// gap after it holds nothing of it.
			must(await test.container.actions.sessions.revealTurn(id, "t1" as TurnId));
			const loaded = new Set(["t1", ...range(7, 12).map((i) => `t${i}`)]);
			expect(sessions.chatView(id)?.turns).toEqual(
				complete.filter((entry) => loaded.has(entry.turnId)),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("the transcript copy holds every turn, and the store keeps only the loaded ones", async () => {
		const { test, id } = await chatWith(range(0, 9).flatMap(turn));
		try {
			const sessions = test.container.services.sessions;
			must(await sessions.open(id));
			must(await test.container.actions.sessions.copyTranscript(id, "concise"));

			const copied = test.memory.controls.clipboardText ?? "";
			expect(copied).toContain("Message 0");
			expect(copied).toContain("Message 8");
			const kept = sessions.store.getState().events[id] ?? [];
			expect(new Set(kept.map((row) => row.event.turnId))).toEqual(
				new Set(range(4, 9).map((index) => `t${index}`)),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("a failed older load says so and the next one loads the turn", async () => {
		let failing = false;
		const { test, id } = await chatWith(range(0, 7).flatMap(turn), {
			wrapDatabase: (database) =>
				failingOnSelect(
					database,
					SESSION_EVENTS_SQL.listTurns,
					new Error("The disk is gone."),
					() => failing,
				),
		});
		try {
			const sessions = test.container.services.sessions;
			must(await sessions.open(id));
			failing = true;
			const failed = await test.container.actions.sessions.loadOlder(id);
			expect(failed.ok).toBe(false);
			expect(sessions.chatView(id)?.history).toEqual({
				olderTurnId: "t1",
				older: "failed",
				gaps: [],
			});

			failing = false;
			must(await test.container.actions.sessions.loadOlder(id));
			expect(turnIds(test, id)[0]).toBe("t1");
			expect(sessions.chatView(id)?.history).toEqual({
				olderTurnId: "t0",
				older: "idle",
				gaps: [],
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
