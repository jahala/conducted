// @vitest-environment node
/**
 * @feature CHAT-16 Fork a chat from a turn
 * Reaches the fork through the real composition root and the actions contract: the new chat is in
 * the chat list, its copied events open in the chat view, and its checkpoint refs are copied under
 * its own ids, so deleting the origin chat leaves them.
 * Test first: actions.sessions.forkFrom over createTestContainer returns a chat whose stored log
 * ends at the chosen turn.
 */
import { type CheckpointId, type EventId, ok, type Result, type TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { createRepositories } from "../db/repositories.ts";
import {
	agentEvent,
	sampleSession,
	turnEndedEvent,
	userMessageEvent,
} from "../db/test-fixtures.ts";
import { checkpointRef, turnCheckpointId } from "../git/refs.ts";

const checkpointEvent = (
	id: string,
	turn: string,
	at: number,
	phase: "start" | "end",
	checkpointId: string,
) => ({
	type: "checkpoint" as const,
	eventId: id as EventId,
	at,
	turnId: turn as TurnId,
	phase,
	checkpointId: checkpointId as CheckpointId,
});

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

describe("CHAT-16 fork through the composition root", () => {
	it("creates the fork from a turn and opens its copied log", async () => {
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
			const originId = created.value.id;

			const repositories = createRepositories(test.database, {
				clock: { now: () => 0 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			const events = [
				userMessageEvent("u1", "t1", 10),
				checkpointEvent("c1", "t1", 11, "start", "start-1"),
				agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
				checkpointEvent("c2", "t1", 13, "end", "end-1"),
				turnEndedEvent("e1", "t1", 14),
				userMessageEvent("u2", "t2", 20),
				checkpointEvent("c3", "t2", 21, "start", "start-2"),
				turnEndedEvent("e2", "t2", 22),
			];
			for (const event of events) {
				const appended = await repositories.sessionEvents.append(originId, event, event.at);
				expect(appended.ok).toBe(true);
			}

			const forked = await test.container.actions.sessions.forkFrom(originId, "t1" as TurnId);

			expect(forked.ok).toBe(true);
			if (!forked.ok) return;
			expect(forked.value.id).not.toBe(originId);
			expect(forked.value.workspaceId).toBe(workspace.id);
			expect(test.container.services.sessions.store.getState().byWorkspace[workspace.id]).toContain(
				forked.value.id,
			);

			const copied = await repositories.sessionEvents.listFrom(forked.value.id, 0, 100);
			expect(copied.ok).toBe(true);
			if (!copied.ok) return;
			expect(copied.value.map((row) => row.event.eventId)).toEqual(["u1", "c1", "a1", "c2", "e1"]);

			const opened = await test.container.services.sessions.open(forked.value.id);
			expect(opened).toEqual({ ok: true, value: undefined });
			const view = test.container.services.sessions.chatView(forked.value.id);
			expect(view?.turns).toHaveLength(1);
			expect(view?.turns[0]?.endCheckpointId).toBe(turnCheckpointId(forked.value.id, "t1", "end"));
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("copies the kept turns' checkpoint refs under the fork's ids, which the origin's prune leaves alone", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const repo = await seedRepo(test.container, { rootPath: "/code/projects/fork-refs" });
			must(await test.container.platform.fs.mkdirp(repo.rootPath));
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const origin = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			const originStart = turnCheckpointId(origin.id, "t1", "start");
			const originEnd = turnCheckpointId(origin.id, "t1", "end");
			const laterStart = turnCheckpointId(origin.id, "t2", "start");
			const repositories = createRepositories(test.database, {
				clock: { now: () => 0 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			for (const event of [
				userMessageEvent("u1", "t1", 10),
				checkpointEvent("c1", "t1", 11, "start", originStart),
				agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
				checkpointEvent("c2", "t1", 13, "end", originEnd),
				turnEndedEvent("e1", "t1", 14),
				userMessageEvent("u2", "t2", 20),
				checkpointEvent("c3", "t2", 21, "start", laterStart),
			]) {
				must(await repositories.sessionEvents.append(origin.id, event, event.at));
			}
			// The repository holds the origin's refs; a ref that is created is added to it.
			const refs = new Set([originStart, originEnd, laterStart].map(checkpointRef));
			const updates: string[] = [];
			test.memory.controls.scriptShell((command) => {
				const args = command.program === "git" ? command.args.slice(2) : command.args;
				if (args[0] === "for-each-ref") {
					const prefix = args.at(-1) ?? "";
					const listed = [...refs].filter((ref) => ref.startsWith(prefix));
					return ok({ stdout: listed.map((ref) => `${ref}\n`).join(""), stderr: "", exitCode: 0 });
				}
				if (args[0] === "update-ref" && args[1] === "--stdin") {
					for (const line of (command.stdin ?? "").split("\n")) {
						if (line.length === 0) continue;
						updates.push(line);
						const [, created] = line.split(" ");
						if (created !== undefined) refs.add(created);
					}
					return ok({ stdout: "", stderr: "", exitCode: 0 });
				}
				if (args[0] === "update-ref" && args[1] === "-d") {
					refs.delete(args[2] ?? "");
					return ok({ stdout: "", stderr: "", exitCode: 0 });
				}
				return null;
			});

			const forked = must(
				await test.container.actions.sessions.forkFrom(origin.id, "t1" as TurnId),
			);

			const forkStart = turnCheckpointId(forked.id, "t1", "start");
			const forkEnd = turnCheckpointId(forked.id, "t1", "end");
			expect(updates).toEqual([
				`create ${checkpointRef(forkStart)} ${checkpointRef(originStart)}`,
				`create ${checkpointRef(forkEnd)} ${checkpointRef(originEnd)}`,
			]);

			must(await test.container.services.sessions.delete(origin.id));

			expect([...refs].sort()).toEqual([checkpointRef(forkEnd), checkpointRef(forkStart)].sort());
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
