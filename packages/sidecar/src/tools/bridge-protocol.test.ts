import { describe, expect, test } from "bun:test";
import { isHello, parseBridgeRequest, zBridgeResponse } from "./bridge-protocol.ts";

describe("SIDE-13 bridge protocol", () => {
	test("SIDE-13 rejects a tool call without a token", () => {
		const result = parseBridgeRequest(
			JSON.stringify({ sessionId: "s1", toolName: "GetWorkspaceDiff", args: {} }),
		);
		expect(result.ok).toBe(false);
	});

	test("SIDE-13 accepts a hello and a tool call, and refuses an unknown tool", () => {
		const hello = parseBridgeRequest(
			JSON.stringify({ authToken: "t", sessionId: "s1", hello: { pid: 12 } }),
		);
		expect(hello.ok && isHello(hello.value)).toBe(true);
		const call = parseBridgeRequest(
			JSON.stringify({ authToken: "t", sessionId: "s1", toolName: "GetWorkspaceDiff", args: {} }),
		);
		expect(call.ok && !isHello(call.value)).toBe(true);
		const unknown = parseBridgeRequest(
			JSON.stringify({ authToken: "t", sessionId: "s1", toolName: "RunLocalCommand", args: {} }),
		);
		expect(unknown.ok).toBe(false);
	});

	test("SIDE-13 a line that is not JSON gives an error value", () => {
		const result = parseBridgeRequest("{nope");
		expect(!result.ok && result.error.code).toBe("bridge_invalid_json");
	});

	test("SIDE-13 a response is either a tool answer or an error note", () => {
		expect(zBridgeResponse.safeParse({ ok: true, text: "done", isError: false }).success).toBe(
			true,
		);
		expect(zBridgeResponse.safeParse({ ok: false, error: "Unauthorized" }).success).toBe(true);
		expect(zBridgeResponse.safeParse({ ok: true, text: "done" }).success).toBe(false);
	});
});
