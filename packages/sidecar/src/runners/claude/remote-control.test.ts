/**
 * Tests for RC-02: the Claude side of Remote Control. The first test is the contract test D074
 * asks for: it builds the pinned SDK's real query object (for a program that does not exist, so
 * nothing starts and nothing reaches claude.ai) and fails when `enableRemoteControl` is gone.
 */
import { describe, expect, test } from "bun:test";
import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import {
	bridgeStatusOf,
	remoteControlBlocker,
	remoteUserMessageUuids,
	setRemoteControl,
} from "./remote-control.ts";

/** A query object with only the Remote Control method, answering as a test says. */
function queryAnswering(answer: (enabled: boolean) => Promise<unknown>): {
	query: Query;
	calls: boolean[];
} {
	const calls: boolean[] = [];
	const query = {
		enableRemoteControl: (enabled: boolean) => {
			calls.push(enabled);
			return answer(enabled);
		},
	} as unknown as Query;
	return { query, calls };
}

describe("RC-02 the SDK's Remote Control method (contract, D074)", () => {
	test("the pinned SDK's query object has enableRemoteControl", async () => {
		const abort = new AbortController();
		async function* noInput(): AsyncGenerator<SDKUserMessage> {}
		const real = sdkQuery({
			prompt: noInput(),
			options: {
				pathToClaudeCodeExecutable: `${process.env.TMPDIR ?? "/tmp"}/no-such-claude-program`,
				abortController: abort,
				cwd: process.env.TMPDIR ?? "/tmp",
			},
		});
		const method = (real as unknown as { enableRemoteControl?: unknown }).enableRemoteControl;
		abort.abort();
		// The aborted query ends its stream with an error; drain it so nothing is left running.
		await (async () => {
			for await (const _ of real) {
				// No message can arrive from a program that never started.
			}
		})().catch(() => {});
		expect(typeof method).toBe("function");
	});

	test("an answer with the session link and bridge id is accepted", async () => {
		const { query, calls } = queryAnswering(async () => ({
			session_url: "https://claude.ai/code/session_1",
			bridge_session_id: "session_1",
			bridge_epoch: 1,
		}));
		const result = await setRemoteControl(query, true);
		expect(calls).toEqual([true]);
		expect(result).toEqual({ ok: true, value: { sessionUrl: "https://claude.ai/code/session_1" } });
	});

	test("an answer without session_url is an error", async () => {
		const { query } = queryAnswering(async () => ({ bridge_session_id: "session_1" }));
		const result = await setRemoteControl(query, true);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("remote_control_answer_changed");
	});

	test("an answer without bridge_session_id is an error", async () => {
		const { query } = queryAnswering(async () => ({
			session_url: "https://claude.ai/code/session_1",
		}));
		const result = await setRemoteControl(query, true);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("remote_control_answer_changed");
	});

	test("a query object without the method is an error, never a silent off", async () => {
		const result = await setRemoteControl({} as unknown as Query, true);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("remote_control_unsupported");
	});

	test("a refusal from Claude keeps Claude's words", async () => {
		const { query } = queryAnswering(async () => {
			throw new Error("Remote Control requires a claude.ai subscription");
		});
		const result = await setRemoteControl(query, true);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("claude.ai subscription");
	});

	test("turning it off needs no link in the answer", async () => {
		const { query, calls } = queryAnswering(async () => undefined);
		expect(await setRemoteControl(query, false)).toEqual({ ok: true, value: {} });
		expect(calls).toEqual([false]);
	});
});

function bridgeState(state: string, detail?: string): SDKMessage {
	return {
		type: "system",
		subtype: "bridge_state",
		state,
		...(detail === undefined ? {} : { detail }),
		bridge_epoch: 1,
		uuid: "bridge-uuid",
		session_id: "s1",
	} as unknown as SDKMessage;
}

describe("RC-02 the bridge's state messages", () => {
	test("ready, connected, reconnecting and disconnected pass through", () => {
		for (const state of ["ready", "connected", "reconnecting", "disconnected"] as const) {
			expect(bridgeStatusOf(bridgeState(state))).toEqual({ state });
		}
	});

	test("a failure keeps Claude's detail", () => {
		expect(bridgeStatusOf(bridgeState("failed", "token expired"))).toEqual({
			state: "failed",
			detail: "token expired",
		});
	});

	test("a policy that turns it off is a failure", () => {
		expect(bridgeStatusOf(bridgeState("policy_disabled", "Disabled by your organization"))).toEqual(
			{ state: "failed", detail: "Disabled by your organization" },
		);
	});

	test("an unknown state and other messages are not bridge states", () => {
		expect(bridgeStatusOf(bridgeState("something_new"))).toBeNull();
		expect(bridgeStatusOf({ type: "system", subtype: "init" } as unknown as SDKMessage)).toBeNull();
	});
});

describe("RC-02 who may use Remote Control", () => {
	test("a chat with the standard sign-in may", () => {
		expect(remoteControlBlocker({ PATH: "/usr/bin" })).toBeNull();
		expect(remoteControlBlocker({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" })).toBeNull();
	});

	test("an API key or an auth token may not, and the reason says so", () => {
		expect(remoteControlBlocker({ ANTHROPIC_API_KEY: "key" })).toContain("API key");
		expect(remoteControlBlocker({ ANTHROPIC_AUTH_TOKEN: "token" })).toContain("API key");
	});

	test("an empty key variable does not count as a key", () => {
		expect(remoteControlBlocker({ ANTHROPIC_API_KEY: "" })).toBeNull();
	});

	test("a base URL away from Anthropic may not", () => {
		expect(remoteControlBlocker({ ANTHROPIC_BASE_URL: "https://gateway.example.com" })).toContain(
			"ANTHROPIC_BASE_URL",
		);
		expect(remoteControlBlocker({ ANTHROPIC_BASE_URL: "not a url" })).toContain(
			"ANTHROPIC_BASE_URL",
		);
	});

	test("Bedrock and Vertex may not", () => {
		expect(remoteControlBlocker({ CLAUDE_CODE_USE_BEDROCK: "1" })).toContain("Bedrock");
		expect(remoteControlBlocker({ CLAUDE_CODE_USE_VERTEX: "true" })).toContain("Vertex");
		expect(remoteControlBlocker({ CLAUDE_CODE_USE_BEDROCK: "0" })).toBeNull();
	});
});

describe("RC-03 the user messages a frame answers", () => {
	test("an assistant frame names the message it answers", () => {
		const frame = {
			type: "assistant",
			parent_tool_use_id: null,
			user_message_uuid: "u2",
			user_message_uuids: ["u1", "u2"],
		} as unknown as SDKMessage;
		expect(remoteUserMessageUuids(frame)).toEqual(["u1", "u2"]);
	});

	test("a sub-agent frame and a frame without a uuid name none", () => {
		expect(
			remoteUserMessageUuids({
				type: "assistant",
				parent_tool_use_id: "tool-1",
				user_message_uuid: "u1",
			} as unknown as SDKMessage),
		).toEqual([]);
		expect(
			remoteUserMessageUuids({
				type: "assistant",
				parent_tool_use_id: null,
			} as unknown as SDKMessage),
		).toEqual([]);
	});

	test("a result names every message of its turn", () => {
		expect(
			remoteUserMessageUuids({
				type: "result",
				user_message_uuid: "u3",
			} as unknown as SDKMessage),
		).toEqual(["u3"]);
	});
});
