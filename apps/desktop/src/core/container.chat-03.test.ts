// @vitest-environment node
/**
 * @feature CHAT-03 Steer a running turn
 * Owns: the composition-root test that a queued message sent now as a steer reaches SessionsService.
 * Behaviour: services-map.md 2.3.4 (steer row first), docs/architecture.md "Done means reachable".
 * Test first: the queue action wired in the container sends the row with delivery steer, under
 * the row's own id, so a crash between the delivery and the row's removal never sends it twice.
 */
import { idleLiveState, type SessionEvent } from "@conducted/protocol";
import { type EventId, type MessageId, ok, type Result, type TurnId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../test/container.ts";
import { runStartupRepair } from "./db/repair.ts";
import { createRepositories } from "./db/repositories.ts";
import { sampleSession } from "./db/test-fixtures.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

describe("CHAT-03 steering through the container", () => {
	it("sends a queued message with delivery steer through the action the app mounts", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			must(
				await test.container.services.sessions.applyLiveState(session.id, {
					...idleLiveState,
					status: "working",
				}),
			);
			let next = 0;
			const repositories = createRepositories(test.database, {
				clock: { now: () => 1000 },
				ids: { uuid: () => `seed-${++next}` },
			});
			const row = must(
				await repositories.queuedMessages.enqueue({
					id: "queued-1" as MessageId,
					sessionId: session.id,
					text: "Steer this now",
					attachmentPaths: [],
					delivery: "queue",
				}),
			);
			const send = vi
				.spyOn(test.container.services.sessions, "send")
				.mockResolvedValue(ok(undefined));

			const result = await test.container.actions.sessions.queue.sendNowAsSteer(row.id);

			expect(result).toEqual(ok(undefined));
			expect(send).toHaveBeenCalledWith(session.id, "Steer this now", [], "steer", row.id);
			expect(must(await repositories.queuedMessages.get(row.id))).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("does not send a delivered steer again when the app stopped before its row was removed", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			must(
				await test.container.services.sessions.applyLiveState(session.id, {
					...idleLiveState,
					status: "working",
				}),
			);
			let next = 0;
			const repositories = createRepositories(test.database, {
				clock: { now: () => 1000 },
				ids: { uuid: () => `seed-${++next}` },
			});
			const row = must(
				await repositories.queuedMessages.enqueue({
					id: "queued-crash" as MessageId,
					sessionId: session.id,
					text: "Steer this before the crash",
					attachmentPaths: [],
					delivery: "queue",
				}),
			);
			const delivery: { finish?: () => void } = {};
			// seam: CHAT-03 the container has no agent launch until SIDE-21, so this stands in for the
			// sidecar, which stores the user message under the message id it was sent.
			vi.spyOn(test.container.services.sessions, "send").mockImplementation(
				async (sessionId, text, _paths, _delivery, messageId) => {
					const stored: SessionEvent = {
						type: "user_message",
						eventId: "crash-event" as EventId,
						at: 2000,
						messageId: messageId ?? ("fresh-message-id" as MessageId),
						turnId: "crash-turn" as TurnId,
						text,
						attachmentPaths: [],
						delivery: "steer",
						config: sampleSession.config,
					};
					must(await repositories.sessionEvents.append(sessionId, stored, 2000));
					// The app stops here: the delivery never returns, so the row is never removed.
					return new Promise<Result<void>>((resolve) => {
						delivery.finish = () => resolve(ok(undefined));
					});
				},
			);

			const pending = test.container.actions.sessions.queue.sendNowAsSteer(row.id);
			await vi.waitFor(() => {
				expect(delivery.finish).toBeDefined();
			});
			expect(must(await repositories.queuedMessages.get(row.id))?.state).toBe("sending");

			must(
				await runStartupRepair({
					db: test.database,
					fs: test.memory.platform.fs,
					clock: { now: () => 3000 },
					ids: { uuid: () => `repair-${++next}` },
				}),
			);

			// Repair saw the stored user message for this row and dropped the row instead of putting
			// it back to waiting, where the queue would have sent the paid message a second time.
			expect(must(await repositories.queuedMessages.get(row.id))).toBeNull();
			delivery.finish?.();
			await pending;
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
