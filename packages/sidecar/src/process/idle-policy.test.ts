import { expect, test } from "bun:test";
import {
	IDLE_STOP_AFTER_MS,
	type ProcessEntryView,
	selectIdleToStop,
	selectWarmToEvict,
} from "./idle-policy.ts";

const entry = (over: Partial<ProcessEntryView> & { key: string }): ProcessEntryView => ({
	retention: "active",
	activeLeases: 0,
	busy: false,
	hasBackgroundTasks: false,
	lastIdleAt: null,
	...over,
});

test("the warm cap evicts the least recently idle entry", () => {
	const entries = [
		entry({ key: "a", retention: "warm", lastIdleAt: 3 }),
		entry({ key: "b", retention: "warm", lastIdleAt: 1 }),
		entry({ key: "c", retention: "warm", lastIdleAt: 2 }),
	];
	expect(selectWarmToEvict(entries, 2)).toEqual(["b"]);
});

test("leased and active entries do not count toward the warm cap", () => {
	const entries = [
		entry({ key: "a", retention: "warm", lastIdleAt: 1, activeLeases: 1 }),
		entry({ key: "b", retention: "active", lastIdleAt: 1 }),
		entry({ key: "c", retention: "warm", lastIdleAt: 1 }),
	];
	expect(selectWarmToEvict(entries, 2)).toEqual([]);
});

test("a busy entry or one with background tasks is never evicted", () => {
	const entries = [
		entry({ key: "busy", retention: "warm", lastIdleAt: 1, busy: true }),
		entry({ key: "tasks", retention: "warm", lastIdleAt: 2, hasBackgroundTasks: true }),
		entry({ key: "a", retention: "warm", lastIdleAt: 3 }),
		entry({ key: "b", retention: "warm", lastIdleAt: 4 }),
		entry({ key: "c", retention: "warm", lastIdleAt: 5 }),
	];
	expect(selectWarmToEvict(entries, 2)).toEqual(["a"]);
});

test("the idle rule skips leased, busy, background-task and never-idle entries", () => {
	const now = 10 * IDLE_STOP_AFTER_MS;
	const old = now - IDLE_STOP_AFTER_MS;
	const entries = [
		entry({ key: "stop", lastIdleAt: old }),
		entry({ key: "leased", lastIdleAt: old, activeLeases: 1 }),
		entry({ key: "busy", lastIdleAt: old, busy: true }),
		entry({ key: "tasks", lastIdleAt: old, hasBackgroundTasks: true }),
		entry({ key: "never", lastIdleAt: null }),
		entry({ key: "recent", lastIdleAt: now - 1000 }),
	];
	expect(selectIdleToStop(entries, now)).toEqual(["stop"]);
});
