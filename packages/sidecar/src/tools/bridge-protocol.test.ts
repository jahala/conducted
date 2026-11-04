import { expect, test } from "bun:test";
import { isHello, parseBridgeRequest } from "./bridge-protocol.ts";

test("a tool call without a token is refused", () => {
	const result = parseBridgeRequest(
		JSON.stringify({ sessionId: "s1", toolName: "GetWorkspaceDiff", args: {} }),
	);
	expect(result.ok).toBe(false);
});

test("a hello and a tool call both parse, and an unknown tool does not", () => {
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

test("a line that is not JSON gives an error value", () => {
	const result = parseBridgeRequest("{nope");
	expect(!result.ok && result.error.code).toBe("bridge_invalid_json");
});
