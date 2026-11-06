/**
 * Tests for RC-02: the Remote Control status a chat reports, as a notification and in its status.
 */
import { expect, test } from "bun:test";
import { appToSidecarRequests, sidecarToAppNotifications } from "./rpc.ts";

test("the Remote Control state notification carries the link and the state", () => {
	const parsed = sidecarToAppNotifications.remoteControlState.parse({
		sessionId: "s1",
		status: { state: "connected", sessionUrl: "https://claude.ai/code/session_1" },
	});
	expect(parsed.status.state).toBe("connected");
	expect(parsed.status.sessionUrl).toBe("https://claude.ai/code/session_1");
	expect(
		sidecarToAppNotifications.remoteControlState.safeParse({
			sessionId: "s1",
			status: { state: "somewhere" },
		}).success,
	).toBe(false);
});

test("an unavailable status says why", () => {
	const parsed = sidecarToAppNotifications.remoteControlState.parse({
		sessionId: "s1",
		status: { state: "unavailable", detail: "This chat runs on an API key." },
	});
	expect(parsed.status.detail).toBe("This chat runs on an API key.");
});

test("a chat's status includes its Remote Control status when the sidecar knows it", () => {
	const result = appToSidecarRequests.getSessionStatus.result.parse({
		known: true,
		remoteControl: { state: "ready", sessionUrl: "https://claude.ai/code/session_1" },
	});
	expect(result.remoteControl?.state).toBe("ready");
});
