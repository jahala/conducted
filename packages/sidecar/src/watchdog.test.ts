import { describe, expect, test } from "bun:test";
import { createLogger, type LogRecord } from "./logging/logger.ts";
import type { ProcessManager } from "./process/process-manager.ts";
import { type IntervalScheduler, ParentWatchdog } from "./watchdog.ts";

class FakeScheduler implements IntervalScheduler {
	readonly intervals: { ms: number; fn: () => void; active: boolean }[] = [];
	cancellations = 0;

	every(ms: number, fn: () => void): () => void {
		const entry = { ms, fn, active: true };
		this.intervals.push(entry);
		return () => {
			entry.active = false;
			this.cancellations += 1;
		};
	}

	fire(): void {
		for (const entry of [...this.intervals]) {
			if (entry.active) entry.fn();
		}
	}

	active(): { ms: number; fn: () => void; active: boolean }[] {
		return this.intervals.filter((entry) => entry.active);
	}
}

interface WatchdogOptions {
	initialParentPid?: number;
	currentParentPid?: () => number;
	sweep?: () => Promise<void>;
	onParentGone?: () => void;
}

function makeWatchdog(options: WatchdogOptions = {}): {
	watchdog: ParentWatchdog;
	scheduler: FakeScheduler;
	records: LogRecord[];
} {
	const scheduler = new FakeScheduler();
	const records: LogRecord[] = [];
	const logger = createLogger({
		sink: (record) => records.push(record),
		clock: { now: () => 0 },
		level: "debug",
		scope: "sidecar",
	});
	const processes = {
		sweep: options.sweep ?? (async () => {}),
	} as unknown as ProcessManager;
	const watchdog = new ParentWatchdog({
		scheduler,
		initialParentPid: options.initialParentPid ?? 100,
		currentParentPid: options.currentParentPid ?? (() => 100),
		processes,
		onParentGone: options.onParentGone ?? (() => {}),
		logger,
	});
	return { watchdog, scheduler, records };
}

describe("SIDE-19 parent watchdog", () => {
	test("SIDE-19 starts the parent check and the sweep on separate 2-second timers, and stop cancels both", () => {
		const { watchdog, scheduler } = makeWatchdog();
		watchdog.start();
		watchdog.start();
		expect(scheduler.active().map((entry) => entry.ms)).toEqual([2000, 2000]);
		watchdog.stop();
		expect(scheduler.active()).toEqual([]);
		expect(scheduler.cancellations).toBe(2);
	});

	test("SIDE-19 a changed parent pid shuts down once and sweeps nothing", () => {
		let parentPid = 100;
		let gone = 0;
		let sweeps = 0;
		const { watchdog, records } = makeWatchdog({
			initialParentPid: 100,
			currentParentPid: () => parentPid,
			sweep: async () => {
				sweeps += 1;
			},
			onParentGone: () => {
				gone += 1;
			},
		});

		parentPid = 1;
		watchdog.checkParent();
		watchdog.checkParent();

		expect(gone).toBe(1);
		expect(sweeps).toBe(0);
		expect(
			records.some(
				(record) => record.scope.endsWith("WATCHDOG") && record.message.includes("parent"),
			),
		).toBe(true);
	});

	test("SIDE-19 the idle sweep runs on every sweep while the parent stays", async () => {
		let sweeps = 0;
		let gone = 0;
		const { watchdog } = makeWatchdog({
			currentParentPid: () => 100,
			sweep: async () => {
				sweeps += 1;
			},
			onParentGone: () => {
				gone += 1;
			},
		});

		await watchdog.sweep();
		await watchdog.sweep();

		expect(sweeps).toBe(2);
		expect(gone).toBe(0);
	});

	test("SIDE-19 a sweep that throws is logged and the next sweep still runs", async () => {
		let calls = 0;
		const { watchdog, records } = makeWatchdog({
			sweep: async () => {
				calls += 1;
				if (calls === 1) throw new Error("disk gone");
			},
		});

		await watchdog.sweep();
		await watchdog.sweep();

		expect(calls).toBe(2);
		expect(
			records.some(
				(record) =>
					record.level === "warn" &&
					record.scope.endsWith("WATCHDOG") &&
					record.data?.reason === "disk gone",
			),
		).toBe(true);
	});

	test("SIDE-19 a sweep that starts while another still runs is skipped", async () => {
		let calls = 0;
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { watchdog } = makeWatchdog({
			sweep: async () => {
				calls += 1;
				if (calls === 1) await gate;
			},
		});

		const first = watchdog.sweep();
		await Promise.resolve();
		const second = watchdog.sweep();
		expect(calls).toBe(1);

		release();
		await Promise.all([first, second]);
		await watchdog.sweep();
		expect(calls).toBe(2);
	});

	test("SIDE-19 a hung sweep never stops the parent check", () => {
		let parentPid = 100;
		let gone = 0;
		const { watchdog, scheduler } = makeWatchdog({
			currentParentPid: () => parentPid,
			sweep: () => new Promise<void>(() => {}),
			onParentGone: () => {
				gone += 1;
			},
		});

		watchdog.start();
		scheduler.fire();
		parentPid = 1;
		scheduler.fire();

		expect(gone).toBe(1);
	});

	test("SIDE-19 no check or sweep runs after stop", async () => {
		let sweeps = 0;
		let checks = 0;
		const { watchdog, scheduler } = makeWatchdog({
			currentParentPid: () => {
				checks += 1;
				return 100;
			},
			sweep: async () => {
				sweeps += 1;
			},
		});

		watchdog.start();
		await watchdog.sweep();
		watchdog.checkParent();
		watchdog.stop();
		scheduler.fire();
		await Promise.resolve();

		expect(sweeps).toBe(1);
		expect(checks).toBe(1);
	});
});
