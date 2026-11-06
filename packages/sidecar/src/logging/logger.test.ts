import { describe, expect, test } from "bun:test";
import {
	createLogger,
	createRepeatFolder,
	type LogRecord,
	type RepeatScheduler,
	redactEnv,
	rerouteConsole,
} from "./logger.ts";

const clock = { now: () => 42 };

describe("SIDE-18 Logger", () => {
	test("SIDE-18 with level warn, info reaches no sink and error reaches it once", () => {
		const records: LogRecord[] = [];
		const logger = createLogger({
			sink: (r) => records.push(r),
			clock,
			level: "warn",
			scope: "t",
		});
		logger.info("hidden");
		logger.error("shown");
		expect(records).toEqual([{ at: 42, level: "error", scope: "t", message: "shown" }]);
	});

	test("SIDE-18 setLevel on a parent changes its children", () => {
		const records: LogRecord[] = [];
		const logger = createLogger({
			sink: (r) => records.push(r),
			clock,
			level: "error",
			scope: "a",
		});
		const child = logger.child("b");
		logger.setLevel("debug");
		child.debug("now visible");
		expect(records[0]?.scope).toBe("a:b");
	});

	test("SIDE-18 a throwing sink does not break the caller", () => {
		const logger = createLogger({
			sink: () => {
				throw new Error("disk full");
			},
			clock,
			level: "info",
			scope: "t",
		});
		expect(() => logger.info("x")).not.toThrow();
	});

	test("SIDE-18 redactEnv hides secret-looking values and keeps others", () => {
		const out = redactEnv({ ANTHROPIC_API_KEY: "abcd", PATH: "/bin", GH_TOKEN: "t" });
		expect(out).toEqual({
			ANTHROPIC_API_KEY: "<redacted:4>",
			PATH: "/bin",
			GH_TOKEN: "<redacted:1>",
		});
	});
});

interface ManualTime {
	clock: { now: () => number };
	scheduler: RepeatScheduler;
	advance(ms: number): void;
	pending(): number;
}

function manualTime(): ManualTime {
	let time = 0;
	const tasks: { due: number; fn: () => void; cancelled: boolean }[] = [];
	return {
		clock: { now: () => time },
		scheduler: {
			after(ms, fn) {
				const task = { due: time + ms, fn, cancelled: false };
				tasks.push(task);
				return () => {
					task.cancelled = true;
				};
			},
		},
		advance(ms) {
			time += ms;
			for (const task of [...tasks]) {
				if (task.cancelled || task.due > time) continue;
				task.cancelled = true;
				task.fn();
			}
		},
		pending() {
			return tasks.filter((task) => !task.cancelled).length;
		},
	};
}

function errorRecord(message: string, scope = "sidecar"): LogRecord {
	return { at: 0, level: "error", scope, message };
}

describe("SIDE-18 folded repeats", () => {
	test("SIDE-18 the first error is written at once and repeats after 5 s of quiet", () => {
		const time = manualTime();
		const out: LogRecord[] = [];
		const fold = createRepeatFolder((record) => out.push(record), {
			clock: time.clock,
			scheduler: time.scheduler,
		});

		fold.sink(errorRecord("boom"));
		fold.sink(errorRecord("boom"));
		fold.sink(errorRecord("boom"));

		expect(out.map((record) => record.message)).toEqual(["boom"]);
		time.advance(4_999);
		expect(out).toHaveLength(1);
		time.advance(1);
		expect(out.map((record) => record.message)).toEqual(["boom", "boom (repeated 2 times)"]);
		expect(out[1]?.data).toEqual({ repeats: 2 });
		expect(time.pending()).toBe(0);
	});

	test("SIDE-18 a line still repeating is written at 60 s at most", () => {
		const time = manualTime();
		const out: LogRecord[] = [];
		const fold = createRepeatFolder((record) => out.push(record), {
			clock: time.clock,
			scheduler: time.scheduler,
		});

		fold.sink(errorRecord("busy"));
		for (let second = 1; second < 60; second += 1) {
			time.advance(1_000);
			fold.sink(errorRecord("busy"));
		}
		expect(out).toHaveLength(1);

		time.advance(1_000);
		expect(out.map((record) => record.message)).toEqual(["busy", "busy (repeated 59 times)"]);
	});

	test("SIDE-18 the 1000th repeat writes the line at once", () => {
		const time = manualTime();
		const out: LogRecord[] = [];
		const fold = createRepeatFolder((record) => out.push(record), {
			clock: time.clock,
			scheduler: time.scheduler,
		});

		fold.sink(errorRecord("flood"));
		for (let repeat = 0; repeat < 999; repeat += 1) fold.sink(errorRecord("flood"));
		expect(out).toHaveLength(1);

		fold.sink(errorRecord("flood"));
		expect(out.map((record) => record.message)).toEqual(["flood", "flood (repeated 1000 times)"]);
	});

	test("SIDE-18 at most the configured number of messages is tracked", () => {
		const time = manualTime();
		const out: LogRecord[] = [];
		const fold = createRepeatFolder((record) => out.push(record), {
			clock: time.clock,
			scheduler: time.scheduler,
			maxGroups: 2,
		});

		fold.sink(errorRecord("A"));
		fold.sink(errorRecord("A"));
		fold.sink(errorRecord("B"));
		fold.sink(errorRecord("C"));

		expect(out.map((record) => record.message)).toEqual(["A", "B", "A (repeated 1 time)", "C"]);
	});

	test("SIDE-18 records that are not errors pass straight through", () => {
		const time = manualTime();
		const out: LogRecord[] = [];
		const fold = createRepeatFolder((record) => out.push(record), {
			clock: time.clock,
			scheduler: time.scheduler,
		});

		fold.sink({ at: 0, level: "info", scope: "sidecar", message: "hello" });
		fold.sink({ at: 0, level: "info", scope: "sidecar", message: "hello" });

		expect(out).toHaveLength(2);
		expect(time.pending()).toBe(0);
	});

	test("SIDE-18 dispose writes pending repeats and stops folding", () => {
		const time = manualTime();
		const out: LogRecord[] = [];
		const fold = createRepeatFolder((record) => out.push(record), {
			clock: time.clock,
			scheduler: time.scheduler,
		});

		fold.sink(errorRecord("late"));
		fold.sink(errorRecord("late"));
		fold.dispose();

		expect(out.map((record) => record.message)).toEqual(["late", "late (repeated 1 time)"]);
		expect(time.pending()).toBe(0);
		fold.sink(errorRecord("after"));
		expect(out.at(-1)?.message).toBe("after");
	});
});

describe("SIDE-18 console reroute", () => {
	test("SIDE-18 console calls reach the logger until the reroute is undone", () => {
		const records: LogRecord[] = [];
		const calls: string[] = [];
		const target = {
			log: (...args: unknown[]) => calls.push(`log:${args.join(" ")}`),
			info: (...args: unknown[]) => calls.push(`info:${args.join(" ")}`),
			warn: (...args: unknown[]) => calls.push(`warn:${args.join(" ")}`),
			error: (...args: unknown[]) => calls.push(`error:${args.join(" ")}`),
			debug: (...args: unknown[]) => calls.push(`debug:${args.join(" ")}`),
		};
		const logger = createLogger({
			sink: (record) => records.push(record),
			clock,
			level: "debug",
			scope: "app",
		});
		const restore = rerouteConsole(logger.child("console"), target);

		target.warn("careful", { attempts: 2 });
		target.error("broken");

		expect(calls).toEqual([]);
		expect(records.map((record) => [record.scope, record.level, record.message])).toEqual([
			["app:console", "warn", 'careful {"attempts":2}'],
			["app:console", "error", "broken"],
		]);

		restore();
		target.warn("after");
		expect(calls).toEqual(["warn:after"]);
	});
});
