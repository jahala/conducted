import { describe, expect, test } from "bun:test";
import type { SessionConfig } from "@conducted/protocol";
import {
	type ConductorEventRow,
	conductorVisibleSequence,
	mapConductorEvents,
	visibleSequence,
} from "./conductor-events.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "opus",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const row = (
	event_type: string | null,
	content: unknown,
	extra: Partial<ConductorEventRow> = {},
) => ({
	event_id: `e-${Math.random().toString(36).slice(2)}`,
	event_type,
	content: typeof content === "string" ? content : JSON.stringify(content),
	received_at: "2026-01-02 03:04:05",
	reverted_at: null,
	...extra,
});

const assistant = (text: string) => ({
	type: "agent",
	turnId: "t-1",
	rawPayload: {
		type: "assistant",
		uuid: "u-1",
		session_id: "claude-1",
		parent_tool_use_id: null,
		message: { role: "assistant", content: [{ type: "text", text }] },
	},
});

describe("APP-18 Conductor's chat events as ours", () => {
	test("a Claude assistant payload maps to one agent event whose items are its text", () => {
		const mapped = mapConductorEvents([row("agent", assistant("Hello there"))], {
			agent: "claude",
			config: CONFIG,
		});
		expect(mapped.events).toHaveLength(1);
		const event = mapped.events[0];
		expect(event?.type).toBe("agent");
		if (event?.type !== "agent") return;
		expect(event.turnId as string).toBe("t-1");
		expect(event.message.items).toEqual([{ kind: "text", text: "Hello there" }]);
		expect(event.at).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
		expect(mapped.counts.agent).toEqual({ events: 1, mapped: 1, unmapped: 0 });
	});

	test("a sent user message maps, and a queued one is understood but shows nothing", () => {
		const mapped = mapConductorEvents(
			[
				row("userMessage", { id: "m-1", text: "Fix it", state: "queued" }),
				row("userMessage", { id: "m-1", text: "Fix it", state: "sent", turnId: "t-9" }),
				row("agent", { ...assistant("Done"), turnId: undefined }),
			],
			{ agent: "claude", config: CONFIG },
		);
		expect(mapped.counts.userMessage).toEqual({ events: 2, mapped: 2, unmapped: 0 });
		expect(mapped.events.map((event) => event.type)).toEqual(["user_message", "agent"]);
		expect(mapped.events[1]?.type === "agent" && (mapped.events[1].turnId as string)).toBe("t-9");
		expect(visibleSequence(mapped.events)).toEqual(["U", "A"]);
	});

	test("counts what it cannot map and never throws", () => {
		const mapped = mapConductorEvents(
			[
				row("agent", "{not json"),
				row("agent", { type: "agent", rawPayload: "text" }),
				row("checkpointCreated", { type: "checkpointCreated", phase: "start" }),
				row("somethingNew", { a: 1 }),
				row(null, null),
				row("agent", assistant("gone"), { reverted_at: "2026-01-03 00:00:00" }),
			],
			{ agent: "claude", config: CONFIG },
		);
		expect(mapped.events).toEqual([]);
		expect(mapped.counts.agent).toEqual({ events: 2, mapped: 0, unmapped: 2 });
		expect(mapped.counts.checkpointCreated).toEqual({ events: 1, mapped: 0, unmapped: 1 });
		expect(mapped.counts.other).toEqual({ events: 2, mapped: 0, unmapped: 2 });
		expect(mapped.reverted).toBe(1);
	});

	test("an agent payload of an agent without a translator counts as unmapped", () => {
		const mapped = mapConductorEvents([row("agent", assistant("Hi"))], {
			agent: "codex",
			config: { ...CONFIG, agent: "codex" },
		});
		expect(mapped.counts.agent).toEqual({ events: 1, mapped: 0, unmapped: 1 });
	});

	test("reads Conductor's visible messages from its projection", () => {
		expect(
			conductorVisibleSequence([
				{ role: "user", sent_at: "x", cancelled_at: null },
				{ role: "assistant", sent_at: null, cancelled_at: null },
				{ role: "user", sent_at: null, cancelled_at: null },
				{ role: "user", sent_at: "x", cancelled_at: "y" },
				{ role: "system", sent_at: "x", cancelled_at: null },
			]),
		).toEqual(["U", "A"]);
	});
});
