/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Tests the turn signal a relayed line carries, and the Durable Object's real storage and alarm:
 * a working turn sets a keep-alive alarm, an idle one clears it, and lines that say nothing about
 * a turn change nothing.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { textOf, turnChangeOf, turnSignalOf } from "./relay.ts";

const request = (method: string, params: unknown): string =>
	JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

const live = (status: "working" | "idle"): string =>
	JSON.stringify({
		jsonrpc: "2.0",
		method: "liveState",
		params: { sessionId: "s1", liveState: { status } },
	});

describe("CLOUD-03 reading turn state from the relay", () => {
	it("reads a send and the sidecar's live state", () => {
		expect(turnSignalOf(request("sendMessage", {}))).toBe("working");
		expect(turnSignalOf(live("working"))).toBe("working");
		expect(turnSignalOf(live("idle"))).toBe("idle");
	});

	it("ignores lines that say nothing about a turn", () => {
		expect(turnSignalOf("not json")).toBeNull();
		expect(turnSignalOf("null")).toBeNull();
		expect(turnSignalOf(request("getSessionStatus", {}))).toBeNull();
		expect(turnSignalOf(JSON.stringify({ method: "liveState", params: {} }))).toBeNull();
		expect(
			turnSignalOf(JSON.stringify({ method: "liveState", params: { liveState: { status: "x" } } })),
		).toBeNull();
	});

	it("reads the chat each turn signal belongs to", () => {
		expect(turnChangeOf(live("working"))).toEqual({ sessionId: "s1", status: "working" });
		expect(turnChangeOf(request("sendMessage", { sessionId: "s2" }))).toEqual({
			sessionId: "s2",
			status: "working",
		});
		expect(turnChangeOf(request("sendMessage", {}))).toEqual({
			sessionId: null,
			status: "working",
		});
		expect(turnChangeOf("not json")).toBeNull();
	});

	it("reads binary frames as text and refuses bytes that are not UTF-8", () => {
		expect(textOf(new TextEncoder().encode("hello").buffer as ArrayBuffer)).toBe("hello");
		expect(textOf(new Uint8Array([0xff, 0xfe]).buffer as ArrayBuffer)).toBeNull();
	});
});

describe("CLOUD-03 the workspace's keep-alive alarm", () => {
	it("sets an alarm while a turn runs and clears it when the turn ends", async () => {
		const workspace = env.WORKSPACE.getByName("alarm-test");
		const started = await workspace.noteTurn(request("sendMessage", {}));
		expect(started.turnActive).toBe(true);
		expect(started.alarmAt).not.toBeNull();

		const working = await workspace.noteTurn(live("working"));
		expect(working.turnActive).toBe(true);
		expect(working.alarmAt).not.toBeNull();

		const ended = await workspace.noteTurn(live("idle"));
		expect(ended).toEqual({ turnActive: false, alarmAt: null });

		const state = await workspace.state();
		expect(state.turnActive).toBe(false);
		expect(state.alarmAt).toBeNull();
		expect(state.running).toBe(false);
	});

	it("reads every line of one relayed frame for turn state", async () => {
		const workspace = env.WORKSPACE.getByName("frame-test");
		await workspace.noteTurn(request("sendMessage", {}));
		const frame = `${request("getSessionStatus", {})}\n${live("idle")}`;
		expect(await workspace.noteTurn(frame)).toEqual({ turnActive: false, alarmAt: null });
		const coalesced = `${live("working")}\n${live("idle")}`;
		expect(await workspace.noteTurn(coalesced)).toEqual({ turnActive: false, alarmAt: null });
	});

	it("leaves the alarm alone for a frame with no turn signal", async () => {
		const workspace = env.WORKSPACE.getByName("alarm-ignore");
		await workspace.noteTurn(request("sendMessage", {}));
		const before = await workspace.state();
		const after = await workspace.noteTurn("not json");
		expect(after.turnActive).toBe(true);
		expect(after.alarmAt).toBe(before.alarmAt);
	});
});
