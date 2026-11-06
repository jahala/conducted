// @vitest-environment node
/**
 * @feature CHAT-04 Follow-up queue
 * Owns: the persistent queue's reads and writes, its release rules and its pause after a failed turn.
 * Behaviour: services-map.md 2.3.3, 2.3.4 and 2.4.4, sessions-and-chats.md "While the agent is working".
 * Test first: nextToSend returns the steer row before an earlier queue row; loading twice keeps only
 * the newest answer; a failed send marks its row failed and the next row is tried.
 */
import type { LiveState } from "@conducted/protocol";
import { appError, err, type MessageId, ok, type Result, type SessionId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { openTestDatabase, type TestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "../db/repos.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleRepo, sampleSession, sampleWorkspace, workspaceId } from "../db/test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "../db/workspaces.ts";
import type { QueuedMessage } from "../model.ts";
import { FollowUpQueue, nextToSend } from "./follow-up-queue.ts";

let store: TestDatabase;
let repositories: Repositories;
let sessionId: SessionId;
let queue: FollowUpQueue;
let live: LiveState | undefined;
let now: number;
let queueIds: number;
let deliver: ReturnType<typeof makeDeliver>;
let log: ReturnType<typeof makeLog>;

const makeDeliver = () =>
	vi.fn(async (_row: QueuedMessage): Promise<Result<void>> => ok(undefined));

const makeLog = () =>
	vi.fn((_level: "warn" | "info", _message: string): void => {
		// The shared log receives what nobody waits for.
	});

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const idle = (over: Partial<LiveState> = {}): LiveState => ({
	status: "idle",
	pendingSteerIds: [],
	backgroundTasks: [],
	fastModeAvailable: true,
	...over,
});

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

const queued = (over: Omit<Partial<QueuedMessage>, "id"> & { id: string }): QueuedMessage => ({
	sessionId,
	text: `Text ${over.id}`,
	attachmentPaths: [],
	delivery: "queue",
	position: 1,
	state: "waiting",
	lastError: null,
	...over,
	id: over.id as MessageId,
});

const enqueue = async (delivery: "queue" | "steer" = "queue"): Promise<QueuedMessage> =>
	must(
		await queue.enqueue({ sessionId, text: `Queued ${delivery}`, attachmentPaths: [], delivery }),
	);

beforeEach(async () => {
	store = openTestDatabase();
	now = 1000;
	queueIds = 0;
	let repoIds = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => now },
		ids: { uuid: () => `repo-${++repoIds}` },
	});
	store.raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	store.raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
	const session = must(
		await repositories.sessions.create({
			workspaceId,
			title: null,
			config: sampleSession.config,
		}),
	);
	sessionId = session.id;
	live = undefined;
	deliver = makeDeliver();
	log = makeLog();
	queue = new FollowUpQueue({
		repos: repositories,
		deliver,
		liveStateOf: () => live,
		newId: () => `queue-${++queueIds}`,
		now: () => now,
		log,
	});
});

afterEach(() => {
	store.close();
	vi.restoreAllMocks();
});

describe("CHAT-04 the next row", () => {
	it("returns the steer row before an earlier queue row", () => {
		const rows = [
			queued({ id: "a", position: 1 }),
			queued({ id: "b", position: 2, delivery: "steer" }),
		];
		expect(nextToSend(rows, false)?.id).toBe("b");
	});
});

describe("CHAT-04 loading and writing the queue", () => {
	it("loads a chat's rows in order with its pause flag", async () => {
		const first = await enqueue();
		const second = await enqueue("steer");
		must(await repositories.sessions.pauseQueue(sessionId, 2000));

		const result = await queue.load(sessionId);

		expect(result).toEqual(ok(undefined));
		expect(queue.store.getState().bySession[sessionId]?.map((row) => row.id)).toEqual([
			first.id,
			second.id,
		]);
		expect(queue.store.getState().pausedSessionIds[sessionId]).toBe(true);
	});

	it("keeps only the newest answer when two loads overlap", async () => {
		const older = queued({ id: "older", text: "Older" });
		const newer = queued({ id: "newer", text: "Newer" });
		const first = deferred<Result<QueuedMessage[]>>();
		const second = deferred<Result<QueuedMessage[]>>();
		let calls = 0;
		vi.spyOn(repositories.queuedMessages, "listBySession").mockImplementation(() => {
			calls += 1;
			return calls === 1 ? first.promise : second.promise;
		});

		const slow = queue.load(sessionId);
		const fast = queue.load(sessionId);
		first.resolve(ok([older]));
		await Promise.resolve();
		second.resolve(ok([newer]));
		await Promise.all([slow, fast]);

		expect(queue.store.getState().bySession[sessionId]?.map((row) => row.id)).toEqual(["newer"]);
	});

	it("adds a new follow-up at the end of the queue", async () => {
		const first = await enqueue();
		const second = await enqueue("steer");

		expect(second.id).toBe("queue-2");
		expect(second).toMatchObject({ delivery: "steer", state: "waiting" });
		expect(queue.store.getState().bySession[sessionId]?.map((row) => row.id)).toEqual([
			first.id,
			second.id,
		]);
		expect(must(await repositories.queuedMessages.listBySession(sessionId))).toHaveLength(2);
	});

	it("edits a waiting row's text and refuses one that is sending", async () => {
		const row = await enqueue();

		expect(await queue.edit(row.id, "New words")).toEqual(ok(undefined));
		expect(must(await repositories.queuedMessages.get(row.id))?.text).toBe("New words");
		expect(queue.store.getState().bySession[sessionId]?.[0]?.text).toBe("New words");

		must(await repositories.queuedMessages.setState(row.id, "waiting", "sending", null));
		expect(await queue.edit(row.id, "Too late")).toMatchObject({
			ok: false,
			error: { code: "queue_not_waiting" },
		});
	});

	it("removes a queued row and keeps it when the delete fails", async () => {
		const row = await enqueue();

		expect(await queue.remove(row.id)).toEqual(ok(undefined));
		expect(queue.store.getState().bySession[sessionId]).toEqual([]);
		expect(must(await repositories.queuedMessages.get(row.id))).toBeNull();

		const kept = await enqueue();
		vi.spyOn(repositories.queuedMessages, "cancel").mockResolvedValue(
			err(appError("db", "The database is locked.")),
		);
		expect(await queue.remove(kept.id)).toMatchObject({ ok: false, error: { code: "db" } });
		expect(queue.store.getState().bySession[sessionId]?.map((entry) => entry.id)).toEqual([
			kept.id,
		]);
	});

	it("reorders waiting rows and keeps the shown order when the write fails", async () => {
		const first = await enqueue();
		const second = await enqueue();

		expect(await queue.reorder(sessionId, [second.id, first.id])).toEqual(ok(undefined));
		expect(queue.store.getState().bySession[sessionId]?.map((row) => row.id)).toEqual([
			second.id,
			first.id,
		]);
		expect(
			must(await repositories.queuedMessages.listBySession(sessionId)).map((row) => row.id),
		).toEqual([second.id, first.id]);

		vi.spyOn(repositories.queuedMessages, "reorder").mockResolvedValue(
			err(appError("db", "The database is locked.")),
		);
		expect(await queue.reorder(sessionId, [first.id, second.id])).toMatchObject({
			ok: false,
			error: { code: "db" },
		});
		expect(queue.store.getState().bySession[sessionId]?.map((row) => row.id)).toEqual([
			second.id,
			first.id,
		]);
	});
});

describe("CHAT-04 pause and release", () => {
	it("persists the pause flag and sends nothing for a paused queue", async () => {
		const row = await enqueue();
		live = idle();

		expect(await queue.setPaused(sessionId, true)).toEqual(ok(undefined));
		expect(must(await repositories.sessions.get(sessionId))?.queuePausedAt).toBe(now);
		expect(await queue.release(sessionId)).toEqual(ok(undefined));
		expect(deliver).not.toHaveBeenCalled();
		expect(must(await repositories.queuedMessages.get(row.id))?.state).toBe("waiting");
	});

	it("resumes a paused queue and sends its first row", async () => {
		const row = await enqueue();
		live = idle();
		must(await queue.setPaused(sessionId, true));

		expect(await queue.setPaused(sessionId, false)).toEqual(ok(undefined));

		expect(must(await repositories.sessions.get(sessionId))?.queuePausedAt).toBeNull();
		expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: row.id, state: "sending" }));
		expect(must(await repositories.queuedMessages.get(row.id))).toBeNull();
	});

	it("sends a steer row before an earlier queue row", async () => {
		const queuedRow = await enqueue("queue");
		const steerRow = await enqueue("steer");
		live = idle();

		expect(await queue.release(sessionId)).toEqual(ok(undefined));

		expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: steerRow.id }));
		expect(must(await repositories.queuedMessages.get(steerRow.id))).toBeNull();
		expect(must(await repositories.queuedMessages.get(queuedRow.id))?.state).toBe("waiting");
	});

	it("marks a failed row failed and tries the next waiting row", async () => {
		const first = await enqueue();
		const second = await enqueue();
		live = idle();
		deliver
			.mockResolvedValueOnce(err(appError("sidecar_down", "The sidecar is not running.")))
			.mockResolvedValueOnce(ok(undefined));

		expect(await queue.release(sessionId)).toEqual(ok(undefined));

		expect(deliver).toHaveBeenCalledTimes(2);
		expect(must(await repositories.queuedMessages.get(first.id))).toMatchObject({
			state: "failed",
			lastError: "The sidecar is not running.",
		});
		expect(must(await repositories.queuedMessages.get(second.id))).toBeNull();
		expect(log).toHaveBeenCalledWith(
			"warn",
			"Failed to send a queued message: The sidecar is not running.",
		);
	});

	it("does not send while the chat is working or has background tasks", async () => {
		await enqueue();
		live = idle({ status: "working" });
		expect(await queue.release(sessionId)).toEqual(ok(undefined));
		live = idle({ backgroundTasks: [{ id: "1", kind: "shell", description: "Build" }] });
		expect(await queue.release(sessionId)).toEqual(ok(undefined));
		expect(deliver).not.toHaveBeenCalled();
	});

	it("retries a failed row and sends it when the chat is idle", async () => {
		const row = await enqueue();
		live = idle();
		must(await repositories.queuedMessages.setState(row.id, "waiting", "failed", "offline"));
		must(await queue.load(sessionId));

		expect(await queue.retry(row.id)).toEqual(ok(undefined));

		expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: row.id }));
		expect(must(await repositories.queuedMessages.get(row.id))).toBeNull();
	});
});

describe("CHAT-04 observing live state", () => {
	it("releases a row when a chat becomes idle", async () => {
		const row = await enqueue();
		live = idle({ status: "working" });
		queue.observeLiveState(sessionId);
		expect(deliver).not.toHaveBeenCalled();

		live = idle();
		queue.observeLiveState(sessionId);

		await vi.waitFor(() =>
			expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: row.id })),
		);
	});

	it("pauses the queue after a failed turn and logs a pause that fails", async () => {
		live = idle({ error: "The agent stopped unexpectedly." });
		queue.observeLiveState(sessionId);

		await vi.waitFor(() => expect(queue.store.getState().pausedSessionIds[sessionId]).toBe(true));
		expect(must(await repositories.sessions.get(sessionId))?.queuePausedAt).toBe(now);

		vi.spyOn(repositories.sessions, "pauseQueue").mockResolvedValue(
			err(appError("db", "The database is locked.")),
		);
		live = idle({ error: "A second failure." });
		queue.observeLiveState(sessionId);

		await vi.waitFor(() =>
			expect(log).toHaveBeenCalledWith(
				"warn",
				"Failed to pause queue after failed turn: The database is locked.",
			),
		);
	});
});

describe("CHAT-04 reaches the composition root", () => {
	it("releases a queued message when the container sees the chat become idle", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(
				await test.container.services.sessions.create(workspace.id, sampleSession.config),
			);
			const row = must(
				await test.container.services.followUpQueue.enqueue({
					sessionId: session.id,
					text: "Ship it",
					attachmentPaths: [],
					delivery: "queue",
				}),
			);
			const send = vi
				.spyOn(test.container.services.sessions, "send")
				.mockResolvedValue(ok(undefined));

			must(
				await test.container.services.sessions.applyLiveState(
					session.id,
					idle({ status: "working" }),
				),
			);
			must(await test.container.services.sessions.applyLiveState(session.id, idle()));

			await vi.waitFor(() =>
				expect(send).toHaveBeenCalledWith(session.id, "Ship it", [], "queue", row.id),
			);
			await vi.waitFor(() =>
				expect(
					test.container.services.followUpQueue.store.getState().bySession[session.id] ?? [],
				).toEqual([]),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
