import { expect, test } from "bun:test";
import { createLogger, type LogRecord, redactEnv } from "./logger.ts";

const clock = { now: () => 42 };

test("the level filter drops records below the configured level", () => {
	const records: LogRecord[] = [];
	const logger = createLogger({ sink: (r) => records.push(r), clock, level: "warn", scope: "t" });
	logger.info("hidden");
	logger.error("shown");
	expect(records).toEqual([{ at: 42, level: "error", scope: "t", message: "shown" }]);
});

test("setLevel on a parent changes its children", () => {
	const records: LogRecord[] = [];
	const logger = createLogger({ sink: (r) => records.push(r), clock, level: "error", scope: "a" });
	const child = logger.child("b");
	logger.setLevel("debug");
	child.debug("now visible");
	expect(records[0]?.scope).toBe("a:b");
});

test("a throwing sink does not break the caller", () => {
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

test("redactEnv hides secret-looking values and keeps others", () => {
	const out = redactEnv({ ANTHROPIC_API_KEY: "abcd", PATH: "/bin", GH_TOKEN: "t" });
	expect(out).toEqual({
		ANTHROPIC_API_KEY: "<redacted:4>",
		PATH: "/bin",
		GH_TOKEN: "<redacted:1>",
	});
});
