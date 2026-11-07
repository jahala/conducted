/**
 * The normaliser of the sidecar differential run: the same agent output, wrapped the way each
 * sidecar wraps it, gives the same trace items.
 */
import { describe, expect, test } from "bun:test";
import {
	describeClaude,
	describeCodex,
	listedNames,
	normaliseAgentLog,
	normaliseRun,
	scrub,
} from "./normalise.ts";

const assistant = {
	type: "assistant",
	message: {
		content: [
			{ type: "text", text: "Listing the files." },
			{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
		],
	},
};

describe("describeClaude", () => {
	test("an assistant message lists its blocks; a result its subtype and error flag", () => {
		expect(describeClaude(assistant)).toEqual([
			"agent assistant text: Listing the files.",
			"agent tool_use Bash",
		]);
		expect(describeClaude({ type: "result", subtype: "success", is_error: true })).toEqual([
			"agent result/success error=true",
		]);
	});
});

describe("describeCodex", () => {
	test("Conductor's thread event and our app-server item describe the same completed item", () => {
		const item = { type: "agentMessage", id: "m1", text: "Hello." };
		expect(describeCodex({ event: { type: "item.completed", item }, thread_id: "x" })).toEqual(
			describeCodex(item),
		);
	});

	test("Conductor's turn.completed and our token usage notification are both the turn's usage", () => {
		expect(describeCodex({ event: { type: "turn.completed", usage: {} } })).toEqual(
			describeCodex({ threadId: "x", turnId: "t", tokenUsage: {} }),
		);
	});

	test("an item still in progress is a started item", () => {
		expect(describeCodex({ type: "commandExecution", id: "c1", status: "inProgress" })).toEqual([
			"agent codex item.started commandexecution",
		]);
	});
});

describe("normaliseRun", () => {
	test("Conductor and our wrappers of the same turn give the same items, a repeated status once", () => {
		const conductor = normaliseRun({
			side: "conductor",
			sent: [{ jsonrpc: "2.0", id: 1, method: "query", params: {} }],
			received: [
				{ at: 1, message: { method: "sessionStatusNotification", params: { status: "working" } } },
				{
					at: 2,
					message: {
						method: "sessionStateNotification",
						params: { updatedLiveState: { status: "working" } },
					},
				},
				{ at: 3, message: { id: 1, result: null } },
				{
					at: 4,
					message: {
						method: "sessionEventNotification",
						params: { event: { type: "agent", rawPayload: assistant } },
					},
				},
				{ at: 5, message: { method: "harnessVersionsNotification", params: {} } },
			],
		});
		const ours = normaliseRun({
			side: "ours",
			sent: [{ jsonrpc: "2.0", id: 1, method: "sendMessage", params: {} }],
			received: [
				{ at: 1, message: { method: "liveState", params: { liveState: { status: "working" } } } },
				{ at: 3, message: { id: 1, result: { deliveredAs: "new_turn" } } },
				{
					at: 4,
					message: {
						method: "sessionEvent",
						params: {
							event: { type: "agent", message: { agent: "claude", items: [], raw: assistant } },
						},
					},
				},
				{ at: 5, message: { method: "agentInstallsChanged", params: {} } },
			],
		});
		expect(conductor.ordered).toEqual(ours.ordered);
		expect(conductor.ordered).toEqual([
			"status working",
			"answer send ok",
			"agent assistant text: Listing the files.",
			"agent tool_use Bash",
		]);
		expect(conductor.background).toEqual(["harnessVersionsNotification"]);
		expect(ours.answers).toEqual({ send: "{deliveredAs}" });
	});
});

describe("listedNames and scrub", () => {
	test("slash commands and models are listed by name or id, sorted", () => {
		expect(listedNames({ agent: { slashCommands: [{ name: "b" }, { name: "a" }] } })).toEqual([
			"a",
			"b",
		]);
		expect(listedNames({ models: [{ id: "gpt-5.5" }] })).toEqual(["gpt-5.5"]);
	});

	test("seal paths and uuids are replaced", () => {
		expect(scrub("/private/tmp/sdiff-c-AbC123/repo 5d1ff000-0000-4000-8000-000000000001")).toBe(
			"<seal>/repo <uuid>",
		);
	});
});

describe("normaliseAgentLog", () => {
	test("probes are sorted ahead of the chat process, whose flags and input follow in order", () => {
		const items = normaliseAgentLog([
			{
				agent: "claude",
				pid: 2,
				dir: "start",
				args: ["--output-format", "stream-json", "--session-id=x"],
			},
			{ agent: "claude", pid: 1, dir: "start", args: ["--version"] },
			{
				agent: "claude",
				pid: 2,
				dir: "in",
				line: JSON.stringify({ type: "control_request", request: { subtype: "initialize" } }),
			},
			{
				agent: "claude",
				pid: 2,
				dir: "in",
				line: JSON.stringify({ type: "user", message: { content: "[[sdiff:plain]] hi" } }),
			},
			{ agent: "claude", pid: 2, dir: "out", line: "{}" },
		]);
		expect(items).toEqual([
			"probe claude --version",
			"claude chat 1 start",
			"claude chat 1 flag --output-format",
			"claude chat 1 flag --session-id=x",
			"claude chat 1 in control_request initialize",
			"claude chat 1 in user message (plain)",
		]);
	});
});
