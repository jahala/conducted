// @vitest-environment node
import type { DatabaseSync } from "node:sqlite";
import type {
	AgentItem,
	AppToSidecarNotification,
	SessionEvent,
	SessionEventEnvelope,
} from "@conducted/protocol";
import {
	appError,
	err,
	type InteractionId,
	ok,
	type Result,
	type SessionId,
} from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../platform/platform.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import {
	agentEvent,
	sessionConfig,
	turnEndedEvent,
	userMessageEvent,
} from "../db/test-fixtures.ts";
import { SessionsService, type SessionsServiceDeps } from "../services/sessions.ts";
import { EventIngest, type IngestListener } from "./ingest.ts";
import type { AppToSidecarNotificationParams, SidecarClient } from "./tunnel.ts";

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const sessionId = "chat-1" as SessionId;
const secondSessionId = "chat-2" as SessionId;

let generated = 0;
const deps = {
	clock: { now: () => 1000 },
	ids: { uuid: () => `generated-${++generated}` },
};
const config = JSON.stringify(sessionConfig);

let store: ReturnType<typeof openTestDatabase>;
let raw: DatabaseSync;
let wrapper: Database;

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	wrapper = store.database;
});

afterEach(() => {
	store.close();
});

const seedWorkspace = (): void => {
	raw
		.prepare(
			"INSERT INTO repos (id, name, root_path, default_branch, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
		)
		.run(bind(["repo-1", "conducted", "/code/conducted", "main", 1, 1]));
	raw
		.prepare(
			`INSERT INTO workspaces (id, repo_id, directory_name, path, branch, target_branch, state, port, last_activity_at, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		)
		.run(
			bind([
				"ws-1",
				"repo-1",
				"oslo",
				"/code/workspaces/oslo",
				"jahala/oslo",
				"origin/main",
				"ready",
				55000,
				1,
				1,
				1,
			]),
		);
};

const seedSession = (id: SessionId = sessionId): void => {
	raw
		.prepare(
			"INSERT INTO sessions (id, workspace_id, config, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
		)
		.run(bind([id, "ws-1", config, 1, 1]));
};

type PersistedAck = { sessionId: SessionId; eventId: string };

function makeSidecar(onNotify?: (ack: PersistedAck) => void): {
	sidecar: Pick<SidecarClient, "notify">;
	acks: PersistedAck[];
} {
	const acks: PersistedAck[] = [];
	const sidecar: Pick<SidecarClient, "notify"> = {
		notify: async <K extends AppToSidecarNotification>(
			method: K,
			params: AppToSidecarNotificationParams<K>,
		) => {
			if (method === "eventPersisted") {
				const ack = params as PersistedAck;
				acks.push(ack);
				onNotify?.(ack);
			}
			return ok(undefined);
		},
	};
	return { sidecar, acks };
}

interface HarnessOptions {
	viewing?: (sessionId: SessionId) => boolean;
	sidecar?: Pick<SidecarClient, "notify">;
	runInTransaction?: <T>(work: (repos: Repositories) => Promise<T>) => Promise<T>;
	onStored?: IngestListener["onStored"];
	onContextWindow?: IngestListener["onContextWindow"];
	log?: (level: "warn" | "error", message: string, data?: unknown) => void;
}

interface Harness {
	ingest: EventIngest;
	repositories: Repositories;
	stored: { sessionId: SessionId; envelope: SessionEventEnvelope; idx: number }[];
}

function makeHarness(options: HarnessOptions = {}): Harness {
	const repositories = createRepositories(wrapper, deps);
	const stored: Harness["stored"] = [];
	const listener: IngestListener = {
		onStored:
			options.onStored ?? ((id, envelope, idx) => stored.push({ sessionId: id, envelope, idx })),
		isViewing: options.viewing ?? (() => false),
		onContextWindow: options.onContextWindow ?? (() => {}),
	};
	const sidecar = options.sidecar ?? makeSidecar().sidecar;
	const runInTransaction =
		options.runInTransaction ??
		(<T>(work: (repos: Repositories) => Promise<T>) =>
			wrapper.transaction((tx) => work(createRepositories(tx, deps))));
	const ingest = new EventIngest({
		repositories: () => repositories,
		runInTransaction,
		sidecar,
		listener,
		log: options.log ?? (() => {}),
	});
	return { ingest, repositories, stored };
}

const envelope = (event: SessionEvent, sequence: number): SessionEventEnvelope => ({
	sessionId,
	sequence,
	event,
});

const usage = (used: number, window: number): AgentItem => ({
	kind: "usage",
	inputTokens: 10,
	outputTokens: 20,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	contextUsedTokens: used,
	contextWindowTokens: window,
});

describe("DATA-04 event ingest", () => {
	it("stores an envelope once and acknowledges both deliveries", async () => {
		seedWorkspace();
		seedSession();
		const { sidecar, acks } = makeSidecar();
		const harness = makeHarness({ sidecar });
		const event = userMessageEvent("e1", "t1", 5000);

		expect(must(await harness.ingest.ingest(envelope(event, 0)))).toEqual({
			stored: true,
			idx: 0,
		});
		expect(must(await harness.ingest.ingest(envelope(event, 0)))).toEqual({
			stored: false,
			idx: null,
		});

		expect(must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10))).toHaveLength(
			1,
		);
		expect(acks.map((ack) => ack.eventId)).toEqual(["e1", "e1"]);
		expect(harness.stored).toHaveLength(1);
	});

	it("acknowledges only after the event row is committed", async () => {
		seedWorkspace();
		seedSession();
		const committed: number[] = [];
		const { sidecar } = makeSidecar(() => {
			const row = raw
				.prepare("SELECT COUNT(*) AS count FROM session_events WHERE session_id = $1")
				.get({ $1: sessionId }) as { count: number };
			committed.push(row.count);
		});
		const harness = makeHarness({ sidecar });

		await harness.ingest.ingest(envelope(userMessageEvent("e1", "t1", 5000), 0));

		expect(committed).toEqual([1]);
	});

	it("withholds the acknowledgement when the write fails", async () => {
		seedWorkspace();
		seedSession();
		const { sidecar, acks } = makeSidecar();
		const harness = makeHarness({
			sidecar,
			runInTransaction: async () => {
				throw new Error("disk full");
			},
		});

		const result = await harness.ingest.ingest(envelope(userMessageEvent("e1", "t1", 5000), 0));

		expect(result.ok).toBe(false);
		expect(acks).toHaveLength(0);
		expect(harness.stored).toHaveLength(0);
	});

	it("rolls the event back when an effect fails", async () => {
		seedWorkspace();
		seedSession();
		const { sidecar, acks } = makeSidecar();
		const harness = makeHarness({
			sidecar,
			runInTransaction: <T>(work: (repos: Repositories) => Promise<T>) =>
				wrapper.transaction((tx) => {
					const repositories = createRepositories(tx, deps);
					return work({
						...repositories,
						sessions: {
							...repositories.sessions,
							recordUserMessage: async () => err(appError("db.failed", "no write")),
						},
					});
				}),
		});

		const result = await harness.ingest.ingest(envelope(userMessageEvent("e1", "t1", 5000), 0));

		expect(result.ok).toBe(false);
		expect(acks).toHaveLength(0);
		expect(must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10))).toHaveLength(
			0,
		);
	});

	it("acknowledges and drops an event for a chat that no longer exists", async () => {
		seedWorkspace();
		const { sidecar, acks } = makeSidecar();
		const harness = makeHarness({ sidecar });

		expect(
			must(await harness.ingest.ingest(envelope(userMessageEvent("e1", "t1", 5000), 0))),
		).toEqual({ stored: false, idx: null });

		expect(acks).toHaveLength(1);
		expect(harness.stored).toHaveLength(0);
		expect(must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10))).toHaveLength(
			0,
		);
	});

	it("stores events in arrival order when the sequence has a gap", async () => {
		seedWorkspace();
		seedSession();
		const harness = makeHarness();

		await harness.ingest.ingest(envelope(userMessageEvent("e1", "t1", 5000), 0));
		await harness.ingest.ingest(envelope(turnEndedEvent("e2", "t1", 6000), 2));

		const stored = must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10));
		expect(stored.map((event) => [event.idx, event.eventId])).toEqual([
			[0, "e1"],
			[1, "e2"],
		]);
	});

	it("runs one chat's events in order and lets another chat through in parallel", async () => {
		seedWorkspace();
		seedSession();
		seedSession(secondSessionId);
		const { sidecar, acks } = makeSidecar();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let first = true;
		const harness = makeHarness({
			sidecar,
			runInTransaction: async <T>(work: (repos: Repositories) => Promise<T>) => {
				if (first) {
					first = false;
					await gate;
				}
				return wrapper.transaction((tx) => work(createRepositories(tx, deps)));
			},
		});

		const firstChat = harness.ingest.ingest(envelope(userMessageEvent("a0", "t1", 5000), 0));
		const secondOfFirstChat = harness.ingest.ingest(envelope(turnEndedEvent("a1", "t1", 6000), 1));
		const otherChat = harness.ingest.ingest({
			sessionId: secondSessionId,
			sequence: 0,
			event: userMessageEvent("b0", "t2", 5000),
		});

		await must(await otherChat);
		expect(acks.map((ack) => ack.eventId)).toEqual(["b0"]);

		release();
		await Promise.all([firstChat, secondOfFirstChat]);
		await harness.ingest.idle();

		const stored = must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10));
		expect(stored.map((event) => event.eventId)).toEqual(["a0", "a1"]);
		expect(acks.map((ack) => ack.eventId)).toEqual(["b0", "a0", "a1"]);
	});

	it("updates the chat's columns from a user message, usage and an unseen agent event", async () => {
		seedWorkspace();
		seedSession();
		let viewing = false;
		const harness = makeHarness({ viewing: () => viewing });

		await harness.ingest.ingest(envelope(userMessageEvent("u1", "t1", 5000), 0));
		let session = must(await harness.repositories.sessions.get(sessionId));
		expect(session?.lastUserMessageAt).toBe(5000);
		expect(session?.unreadCount).toBe(0);

		await harness.ingest.ingest(envelope(agentEvent("a1", "t1", 6000, [usage(1200, 200000)]), 1));
		session = must(await harness.repositories.sessions.get(sessionId));
		expect(session?.contextUsedTokens).toBe(1200);
		// The window has one home, the per-model table; the chat keeps only the last used count.
		expect(must(await harness.repositories.modelContextWindows.list())).toEqual([
			{ agent: "claude", model: sessionConfig.model, windowTokens: 200000, updatedAt: 1000 },
		]);
		expect(session?.unreadCount).toBe(1);

		viewing = true;
		await harness.ingest.ingest(
			envelope(agentEvent("a2", "t1", 7000, [{ kind: "text", text: "done" }]), 2),
		);
		session = must(await harness.repositories.sessions.get(sessionId));
		expect(session?.unreadCount).toBe(1);
	});
});

describe("CHAT-14 event ingest remembers each model's context window", () => {
	it("records the window a usage item reports for the chat's agent and model", async () => {
		seedWorkspace();
		seedSession();
		const remembered: { agent: string; model: string; windowTokens: number }[] = [];
		const harness = makeHarness({
			onContextWindow: (agent, model, windowTokens) =>
				remembered.push({ agent, model, windowTokens }),
		});

		await harness.ingest.ingest(envelope(agentEvent("a1", "t1", 6000, [usage(1200, 200000)]), 0));

		expect(must(await harness.repositories.modelContextWindows.list())).toEqual([
			{ agent: "claude", model: sessionConfig.model, windowTokens: 200000, updatedAt: 1000 },
		]);
		expect(remembered).toEqual([
			{ agent: "claude", model: sessionConfig.model, windowTokens: 200000 },
		]);
	});

	it("updates the chat's used tokens without storing a window of its own", async () => {
		seedWorkspace();
		seedSession();
		const harness = makeHarness();

		await harness.ingest.ingest(envelope(agentEvent("a1", "t1", 6000, [usage(1200, 200000)]), 0));
		await harness.ingest.ingest(
			envelope(
				agentEvent("a2", "t1", 7000, [
					{ ...usage(2400, 200000), contextWindowTokens: undefined } as AgentItem,
				]),
				1,
			),
		);

		const session = must(await harness.repositories.sessions.get(sessionId));
		expect(session?.contextUsedTokens).toBe(2400);
		expect(must(await harness.repositories.modelContextWindows.list())).toEqual([
			{ agent: "claude", model: sessionConfig.model, windowTokens: 200000, updatedAt: 1000 },
		]);
	});
});

describe("DATA-04 event ingest treats a failing logger as a value", () => {
	it("acknowledges a stored event when showing it fails and the logger throws", async () => {
		seedWorkspace();
		seedSession();
		const { sidecar, acks } = makeSidecar();
		const harness = makeHarness({
			sidecar,
			onStored: () => {
				throw new Error("the chat view is gone");
			},
			log: () => {
				throw new Error("the log is unavailable");
			},
		});

		const result = await harness.ingest.ingest(envelope(userMessageEvent("e1", "t1", 5000), 0));

		expect(result.ok).toBe(true);
		expect(acks.map((ack) => ack.eventId)).toEqual(["e1"]);
		expect(must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10))).toHaveLength(
			1,
		);
	});

	it("returns an error instead of rejecting when the write fails and the logger throws", async () => {
		seedWorkspace();
		seedSession();
		const { sidecar, acks } = makeSidecar();
		const harness = makeHarness({
			sidecar,
			runInTransaction: async () => {
				throw new Error("disk full");
			},
			log: () => {
				throw new Error("the log is unavailable");
			},
		});

		const result = await harness.ingest.ingest(envelope(userMessageEvent("e1", "t1", 5000), 0));

		expect(result.ok).toBe(false);
		expect(acks).toHaveLength(0);
		expect(harness.stored).toHaveLength(0);
	});

	it("keeps the stored event when the acknowledgement fails and the logger throws", async () => {
		seedWorkspace();
		seedSession();
		const sidecar: Pick<SidecarClient, "notify"> = {
			notify: async () => {
				throw new Error("the socket closed");
			},
		};
		const harness = makeHarness({
			sidecar,
			log: () => {
				throw new Error("the log is unavailable");
			},
		});

		const result = await harness.ingest.ingest(envelope(userMessageEvent("e1", "t1", 5000), 0));

		expect(result.ok).toBe(true);
		expect(harness.stored).toHaveLength(1);
		expect(must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10))).toHaveLength(
			1,
		);
	});
});

describe("DATA-04 event ingest after a turn ended", () => {
	it("stores a late agent event for an ended turn without changing the chat", async () => {
		seedWorkspace();
		seedSession();
		const harness = makeHarness({ viewing: () => false });
		await harness.ingest.ingest(envelope(userMessageEvent("u1", "t1", 5000), 0));
		await harness.ingest.ingest(envelope(turnEndedEvent("e2", "t1", 6000), 1));

		const result = must(
			await harness.ingest.ingest(envelope(agentEvent("a3", "t1", 7000, [usage(1200, 200000)]), 2)),
		);

		expect(result).toEqual({ stored: true, idx: 2 });
		const session = must(await harness.repositories.sessions.get(sessionId));
		expect(session?.lastUserMessageAt).toBe(5000);
		expect(session?.contextUsedTokens).toBeNull();
		expect(session?.unreadCount).toBe(0);
		const stored = must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10));
		expect(stored.map((event) => event.eventId)).toEqual(["u1", "e2", "a3"]);
	});

	it("does not store a second turn_ended for an ended turn and still acknowledges it", async () => {
		seedWorkspace();
		seedSession();
		const { sidecar, acks } = makeSidecar();
		const harness = makeHarness({ sidecar });
		await harness.ingest.ingest(envelope(userMessageEvent("u1", "t1", 5000), 0));
		await harness.ingest.ingest(envelope(turnEndedEvent("repair", "t1", 6000), 1));

		const result = must(
			await harness.ingest.ingest(envelope(turnEndedEvent("real", "t1", 7000), 2)),
		);

		expect(result).toEqual({ stored: false, idx: null });
		const stored = must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10));
		expect(stored.filter((event) => event.event.type === "turn_ended")).toHaveLength(1);
		expect(stored.map((event) => event.eventId)).toEqual(["u1", "repair"]);
		expect(acks.map((ack) => ack.eventId)).toEqual(["u1", "repair", "real"]);
	});

	it("stores events replayed after repair closed the turn, with no second end", async () => {
		seedWorkspace();
		seedSession();
		const harness = makeHarness();
		await harness.ingest.ingest(envelope(userMessageEvent("u1", "t1", 5000), 0));
		await harness.ingest.ingest(envelope(turnEndedEvent("repair", "t1", 6000), 1));

		const lateAgent = must(
			await harness.ingest.ingest(
				envelope(agentEvent("a2", "t1", 7000, [{ kind: "text", text: "done" }]), 2),
			),
		);
		const lateEnd = must(
			await harness.ingest.ingest(envelope(turnEndedEvent("real", "t1", 8000), 3)),
		);

		expect(lateAgent).toEqual({ stored: true, idx: 2 });
		expect(lateEnd).toEqual({ stored: false, idx: null });
		const stored = must(await harness.repositories.sessionEvents.listFrom(sessionId, 0, 10));
		expect(stored.map((event) => [event.eventId, event.event.type])).toEqual([
			["u1", "user_message"],
			["repair", "turn_ended"],
			["a2", "agent"],
		]);
	});
});

describe("DATA-04 applyStoredEvent", () => {
	it("adds the event to a loaded chat and closes its open interaction on turn_ended", () => {
		const sessions = new SessionsService({} as SessionsServiceDeps);
		sessions.store.setState({
			events: { [sessionId]: [] },
			openInteractions: {
				[sessionId]: {
					interactionId: "i1" as InteractionId,
					interaction: {} as never,
					expiresAt: null,
					timedOut: false,
				},
			},
		});

		sessions.applyStoredEvent(sessionId, 0, turnEndedEvent("e1", "t1", 9000), 9000);

		const state = sessions.store.getState();
		expect(state.events[sessionId]).toHaveLength(1);
		expect(state.openInteractions[sessionId]).toBeUndefined();
	});
});
