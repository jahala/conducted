// @vitest-environment node
/**
 * @feature CHAT-18 Resume after restart and reconnect
 * Behaviour: sessions.md section 8 (a new connection can attach to a living sidecar; a lost chat
 * is closed as interrupted; replayed events are deduplicated by event id).
 * Test first: a sidecar restart on the real transport runs resume, and the lost working chat's
 * turn is stored as interrupted.
 */
import { idleLiveState, type LiveState, type SessionEventEnvelope } from "@conducted/protocol";
import { ok, type SessionId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleSession, userMessageEvent } from "../db/test-fixtures.ts";
import { SessionResume } from "./resume.ts";

// The lifetime job's startup step is unrelated to resume, so it reports a skipped run.
vi.mock("../db/lifetime.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../db/lifetime.ts")>();
	return {
		...actual,
		runDataLifetimeJob: async () => ({
			ok: true,
			value: { kind: "skipped", lastRunAt: 0 },
		}),
	};
});

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const working: LiveState = { ...idleLiveState, status: "working" };

let open: TestContainer | null = null;
const containerClock = { now: () => 1_000 };
const containerIds = (() => {
	let next = 0;
	return { uuid: () => `container-${++next}` };
})();

afterEach(async () => {
	if (open !== null) {
		await open.container.stop();
		open.close();
		open = null;
	}
	vi.restoreAllMocks();
});

/** Starts the real container but for the services unrelated to the sidecar connection. */
const startContainer = async (): Promise<TestContainer> => {
	const test = createTestContainer({ clock: containerClock, ids: containerIds });
	open = test;
	const quiet = [
		test.container.services.settings,
		test.container.services.repo,
		test.container.services.workspace,
		test.container.services.sections,
		test.container.services.favoriteModels,
		test.container.services.terminals,
		test.container.services.sessions,
		test.container.services.system,
	];
	for (const service of quiet) {
		vi.spyOn(service, "start").mockImplementation(async () => ok(undefined) as never);
	}
	vi.spyOn(test.container.services.github, "checkAccess").mockResolvedValue(
		ok({ status: "unknown" }),
	);
	// RUN-01 has not built the stop yet; the container's stop is not what this test checks.
	vi.spyOn(test.container.services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
	const result = await test.container.start();
	expect(result.ok).toBe(true);
	return test;
};

let seedId = 0;

const repositoriesFor = (test: TestContainer): Repositories =>
	createRepositories(test.database, {
		clock: { now: () => 1_000 },
		ids: { uuid: () => `seed-${++seedId}` },
	});

const seedChat = async (
	test: TestContainer,
): Promise<{ id: SessionId; repositories: Repositories }> => {
	const repositories = repositoriesFor(test);
	const workspace = await seedWorkspace(test.container);
	const session = must(
		await repositories.sessions.create({
			workspaceId: workspace.id,
			title: "Lost chat",
			config: sampleSession.config,
		}),
	);
	return { id: session.id, repositories };
};

const sidecarMessages = (
	test: TestContainer,
): { id?: number; method?: string; params?: { sessionId?: string } }[] =>
	test.memory.controls.sidecarSent.flatMap((line) => {
		try {
			return [JSON.parse(line) as { id?: number; method?: string }];
		} catch {
			return [];
		}
	});

const respondToStatus = (test: TestContainer, known: boolean): void => {
	const request = sidecarMessages(test).find(
		(message) => message.method === "getSessionStatus" && message.id !== undefined,
	);
	if (request?.id === undefined) return;
	test.memory.controls.emitSidecarLine(
		JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { known } }),
	);
};

describe("CHAT-18 container reconnect", () => {
	it("runs resume after a sidecar restart and closes a lost working chat as interrupted", async () => {
		const runs: number[] = [];
		const original = SessionResume.prototype.resume;
		vi.spyOn(SessionResume.prototype, "resume").mockImplementation(function (this: SessionResume) {
			runs.push(1);
			return original.call(this);
		});
		const test = await startContainer();
		const { id, repositories } = await seedChat(test);
		must(await repositories.sessionEvents.append(id, userMessageEvent("e1", "t1", 900), 900));
		await test.container.services.sessions.applyLiveState(id, working);

		expect(runs).toHaveLength(1);
		test.memory.controls.emitSidecarRestart();
		await vi.waitFor(() => {
			expect(sidecarMessages(test).some((message) => message.method === "getSessionStatus")).toBe(
				true,
			);
		});
		respondToStatus(test, false);

		await vi.waitFor(async () => {
			const turns = must(await repositories.sessionEvents.listByTurn(id, "t1" as never));
			expect(turns.some((stored) => stored.event.type === "turn_ended")).toBe(true);
		});
		const turns = must(await repositories.sessionEvents.listByTurn(id, "t1" as never));
		expect(turns.find((stored) => stored.event.type === "turn_ended")?.event).toMatchObject({
			type: "turn_ended",
			outcome: "interrupted",
		});
		expect(test.container.services.sessions.store.getState().liveStates[id]).toEqual(idleLiveState);
		expect(runs).toHaveLength(2);
	});

	it("stores the agent session id a notification carries through the real handlers", async () => {
		const test = await startContainer();
		const { id, repositories } = await seedChat(test);

		test.memory.controls.emitSidecarLine(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "agentSessionId",
				params: { sessionId: id, agentSessionId: "agent-real" },
			}),
		);

		await vi.waitFor(async () => {
			const stored = must(await repositories.sessions.get(id));
			expect(stored?.agentSessionId).toBe("agent-real");
		});
	});

	it("stores a replayed event once across a reconnect and answers persisted both times", async () => {
		const test = await startContainer();
		const { id, repositories } = await seedChat(test);
		const envelope: SessionEventEnvelope = {
			sessionId: id as never,
			sequence: 0,
			event: {
				type: "turn_ended",
				eventId: "replayed-1" as never,
				at: 900,
				turnId: "t1" as never,
				outcome: "interrupted",
			},
		};
		const deliver = (jsonRpcId: number): void => {
			test.memory.controls.emitSidecarLine(
				JSON.stringify({ jsonrpc: "2.0", id: jsonRpcId, method: "deliverEvent", params: envelope }),
			);
		};

		deliver(1);
		await vi.waitFor(() => {
			expect(sidecarMessages(test).some((message) => message.id === 1)).toBe(true);
		});

		test.memory.controls.emitSidecarRestart();
		deliver(2);
		await vi.waitFor(() => {
			expect(sidecarMessages(test).some((message) => message.id === 2)).toBe(true);
		});

		const stored = must(await repositories.sessionEvents.listFrom(id, 0, 100));
		expect(stored).toHaveLength(1);
		const answers = sidecarMessages(test).filter((message) => message.id === 1 || message.id === 2);
		expect(answers).toHaveLength(2);
	});
});
