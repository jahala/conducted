import { expect, test } from "bun:test";
import { createLogger } from "./logging/logger.ts";
import { runShutdownSteps } from "./shutdown.ts";

const logger = createLogger({
	sink: () => {},
	clock: { now: () => 0 },
	level: "error",
	scope: "t",
});
const never = () => new Promise<"timeout">(() => {});

test("a failing step is reported and the others still run", async () => {
	const ran: string[] = [];
	const report = await runShutdownSteps(
		[
			{ name: "a", limitMs: 10, run: async () => void ran.push("a") },
			{
				name: "b",
				limitMs: 10,
				run: async () => {
					throw new Error("disk gone");
				},
			},
			{ name: "c", limitMs: 10, run: async () => void ran.push("c") },
		],
		{ logger, timeout: never },
	);
	expect(ran).toEqual(["a", "c"]);
	expect(report.completed).toEqual(["a", "c"]);
	expect(report.failed).toEqual([{ name: "b", reason: "disk gone" }]);
});

test("a step that exceeds its limit is abandoned and reported", async () => {
	const report = await runShutdownSteps(
		[
			{ name: "slow", limitMs: 5, run: () => new Promise<void>(() => {}) },
			{ name: "after", limitMs: 1000, run: async () => {} },
		],
		// Only the 5 ms limit expires; the 1000 ms limit never does.
		{ logger, timeout: (ms) => (ms === 5 ? Promise.resolve("timeout" as const) : never()) },
	);
	expect(report.failed.map((f) => f.name)).toEqual(["slow"]);
	expect(report.completed).toEqual(["after"]);
});
