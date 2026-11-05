// @vitest-environment node
/**
 * @feature CHAT-03 Steer a running turn
 * Owns: the composition-root test that a queued message sent now as a steer reaches SessionsService.
 * Behaviour: services-map.md 2.3.4 (steer row first), docs/architecture.md "Done means reachable".
 * Test first: the queue action wired in the container sends the row with delivery steer.
 */
import { idleLiveState } from "@conducted/protocol";
import { type MessageId, ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../test/container.ts";
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
			expect(send).toHaveBeenCalledWith(session.id, "Steer this now", [], "steer");
			expect(must(await repositories.queuedMessages.get(row.id))).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
