// @vitest-environment node
/**
 * @feature CHAT-02 Send a message
 * A message sent to a chat that no longer exists is refused in Conductor's words.
 * Test first: sending to a chat that was deleted says Session not found.
 */
import type { SessionId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";

let test: TestContainer | undefined;

afterEach(async () => {
	await test?.container.stop();
	test?.close();
	test = undefined;
});

describe("CHAT-02 a message to a chat that no longer exists", () => {
	it("sending to a chat that was deleted says Session not found (renderApp @9299633)", async () => {
		test = createTestContainer();
		await seedWorkspace(test.container);
		const sent = await test.container.actions.sessions.send(
			"gone" as SessionId,
			"Are you there?",
			[],
			"auto",
		);
		expect(sent.ok).toBe(false);
		if (sent.ok) return;
		expect(sent.error.message).toBe("Session not found");
	});
});
