import { describe, expect, test } from "bun:test";
import type { LiveState, SidecarToAppNotification, SidecarToAppRequest } from "@conducted/protocol";
import { idleLiveState } from "@conducted/protocol";
import type { AppError, InteractionId, MessageId, Result, SessionId } from "@conducted/shared";
import { ok } from "@conducted/shared";
import type {
	SidecarToApp,
	SidecarToAppNotificationParams,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "../rpc/types.ts";
import {
	addPendingSteer,
	beginTurn,
	closeInteraction,
	endTurn,
	LiveStateStore,
	markFastModeUnavailable,
	openInteraction,
	removePendingSteer,
	setBackgroundTasks,
	setWaitingSince,
} from "./live-state.ts";

const sid = (value: string) => value as SessionId;
const m = (value: string) => value as MessageId;

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

class FakeApp implements SidecarToApp {
	connected = true;
	readonly notifications: { method: SidecarToAppNotification; params: unknown }[] = [];

	async request<K extends SidecarToAppRequest>(
		_method: K,
		_params: SidecarToAppRequestParams<K>,
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>> {
		return ok({} as SidecarToAppRequestResult<K>);
	}

	notify<K extends SidecarToAppNotification>(
		method: K,
		params: SidecarToAppNotificationParams<K>,
	): boolean {
		if (!this.connected) return false;
		this.notifications.push({ method, params });
		return true;
	}

	onAttach(_listener: () => void): () => void {
		return () => {};
	}

	onDetach(_listener: () => void): () => void {
		return () => {};
	}
}

function harness(flushed: (sessionId: SessionId) => Promise<void> = async () => {}) {
	const app = new FakeApp();
	const store = new LiveStateStore({ app, flushed });
	return { app, store };
}

function publishedStates(app: FakeApp): LiveState[] {
	return app.notifications
		.filter((notification) => notification.method === "liveState")
		.map(
			(notification) =>
				(notification.params as { sessionId: SessionId; liveState: LiveState }).liveState,
		);
}

describe("SIDE-05 live-state reducers", () => {
	test("SIDE-05 beginTurn clears the previous error and pending steers", () => {
		const before = { ...idleLiveState, error: "old", pendingSteerIds: [m("a")] };
		const after = beginTurn(before);
		expect(after.status).toBe("working");
		expect(after.error).toBeUndefined();
		expect(after.pendingSteerIds).toEqual([]);
	});

	test("SIDE-05 beginTurn clears a leftover wait and retry from the previous turn", () => {
		const before: LiveState = {
			...idleLiveState,
			waitingSince: 10,
			retry: { attempt: 1, maxAttempts: 3, error: "rate limited" },
		};
		const after = beginTurn(before);
		expect(after.waitingSince).toBeUndefined();
		expect(after.retry).toBeUndefined();
		expect(after.status).toBe("working");
	});

	test("SIDE-05 endTurn goes idle, keeps an error when given, and drops an open interaction", () => {
		const interaction = openInteraction(
			beginTurn(idleLiveState),
			"i1" as InteractionId,
			{ kind: "plan_approval", plan: "p" },
			1,
		);
		const ended = endTurn({ ...interaction, waitingSince: 5 }, "agent crashed");
		expect(ended.status).toBe("idle");
		expect(ended.error).toBe("agent crashed");
		expect(ended.openInteraction).toBeUndefined();
		expect(ended.waitingSince).toBeUndefined();
	});

	test("SIDE-05 a steer is added once and removed when consumed", () => {
		let state = addPendingSteer(idleLiveState, m("s1"));
		state = addPendingSteer(state, m("s1"));
		expect(state.pendingSteerIds).toEqual([m("s1")]);
		expect(removePendingSteer(state, m("s1")).pendingSteerIds).toEqual([]);
	});

	test("SIDE-05 closeInteraction ignores a stale interaction id", () => {
		const open = openInteraction(
			idleLiveState,
			"i2" as InteractionId,
			{ kind: "plan_approval", plan: "p" },
			1,
		);
		expect(closeInteraction(open, "other" as InteractionId)).toBe(open);
		expect(closeInteraction(open, "i2" as InteractionId).openInteraction).toBeUndefined();
	});

	test("SIDE-05 a blocking wait sets waitingSince and clears it again", () => {
		const waiting = setWaitingSince(beginTurn(idleLiveState), 1234);
		expect(waiting.waitingSince).toBe(1234);
		expect(setWaitingSince(waiting, 1234)).toBe(waiting);
		expect(setWaitingSince(waiting, undefined).waitingSince).toBeUndefined();
	});

	test("SIDE-05 fast mode unavailable is only a flag on the live state", () => {
		const once = markFastModeUnavailable(beginTurn(idleLiveState));
		expect(once.status).toBe("working");
		expect(once.fastModeAvailable).toBe(false);
		expect(markFastModeUnavailable(once)).toBe(once);
	});
});

describe("SIDE-05 live-state store", () => {
	test("SIDE-05 a changed state is published after the flush, and an unchanged state is not", async () => {
		const gate = deferred<void>();
		const { app, store } = harness(() => gate.promise);

		const update = store.update(sid("session-1"), beginTurn);
		await settle();
		expect(store.get(sid("session-1")).status).toBe("working");
		expect(publishedStates(app)).toHaveLength(0);

		gate.resolve();
		await update;
		expect(publishedStates(app)).toHaveLength(1);
		expect(publishedStates(app)[0]?.status).toBe("working");

		await store.update(sid("session-1"), (state) => state);
		await store.update(sid("session-1"), (state) => addPendingSteer(state, m("a")));
		await store.update(sid("session-1"), (state) => addPendingSteer(state, m("a")));
		expect(publishedStates(app)).toHaveLength(2);
	});

	test("SIDE-05 idle is published only after the turn's last event was flushed", async () => {
		const gate = deferred<void>();
		const { app, store } = harness(() => gate.promise);

		const idle = store.update(sid("session-1"), (state) => endTurn(beginTurn(state)));
		await settle();
		expect(publishedStates(app)).toHaveLength(0);

		gate.resolve();
		await idle;
		expect(publishedStates(app).map((state) => state.status)).toEqual(["idle"]);
	});

	test("SIDE-05 updates for one chat are published in order behind a slow flush", async () => {
		const gates = [deferred<void>(), deferred<void>()];
		let calls = 0;
		const { app, store } = harness(() => {
			const gate = gates[calls];
			calls += 1;
			return gate?.promise ?? Promise.resolve();
		});

		const first = store.update(sid("session-1"), beginTurn);
		const second = store.update(sid("session-1"), (state) => endTurn(state));
		await settle();
		expect(calls).toBe(1);

		gates[0]?.resolve();
		await first;
		await settle();
		expect(calls).toBe(2);
		expect(publishedStates(app).map((state) => state.status)).toEqual(["working"]);

		gates[1]?.resolve();
		await second;
		expect(publishedStates(app).map((state) => state.status)).toEqual(["working", "idle"]);
	});

	test("SIDE-05 background tasks are published, and an identical list is not", async () => {
		const { app, store } = harness();
		const tasks = [{ id: "task-1", kind: "shell" as const, description: "run the tests" }];

		await store.update(sid("session-1"), (state) => setBackgroundTasks(state, tasks));
		await store.update(sid("session-1"), (state) =>
			setBackgroundTasks(state, [
				{ ...tasks[0], id: "task-1", kind: "shell", description: "run the tests" },
			]),
		);

		expect(publishedStates(app)).toHaveLength(1);
		expect(publishedStates(app)[0]?.backgroundTasks).toEqual(tasks);
	});

	test("SIDE-05 a live-state notification carries the state and no sequence index", async () => {
		const { app, store } = harness();

		await store.update(sid("session-1"), beginTurn);

		const notification = app.notifications.find((item) => item.method === "liveState");
		expect(notification).toBeDefined();
		expect(Object.keys(notification?.params as object).sort()).toEqual(["liveState", "sessionId"]);
		const params = notification?.params as { liveState: LiveState } | undefined;
		expect(params?.liveState.status).toBe("working");
	});

	test("SIDE-05 a failed query arrives as the live state's error", async () => {
		const { app, store } = harness();

		await store.update(sid("session-1"), beginTurn);
		await store.update(sid("session-1"), (state) => endTurn(state, "the agent crashed"));

		expect(app.notifications.map((notification) => notification.method)).toEqual([
			"liveState",
			"liveState",
		]);
		expect(publishedStates(app)[1]).toMatchObject({
			status: "idle",
			error: "the agent crashed",
		});
	});

	test("SIDE-05 fast mode unavailable reaches the app as a live-state field", async () => {
		const { app, store } = harness();

		await store.update(sid("session-1"), beginTurn);
		await store.update(sid("session-1"), markFastModeUnavailable);
		await store.update(sid("session-1"), markFastModeUnavailable);

		expect(publishedStates(app)).toHaveLength(2);
		expect(publishedStates(app)[1]?.fastModeAvailable).toBe(false);
	});

	test("SIDE-05 drop forgets a chat and a late update does not bring it back", async () => {
		const gate = deferred<void>();
		const { app, store } = harness(() => gate.promise);

		const update = store.update(sid("session-1"), beginTurn);
		await settle();
		store.drop(sid("session-1"));
		gate.resolve();
		await update;

		expect(store.get(sid("session-1"))).toEqual(idleLiveState);
		expect(publishedStates(app)).toHaveLength(0);
	});
});
