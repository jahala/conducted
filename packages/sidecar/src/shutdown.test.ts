import { describe, expect, test } from "bun:test";
import { createLogger } from "./logging/logger.ts";
import { runShutdownSteps } from "./shutdown.ts";

const logger = createLogger({
	sink: () => {},
	clock: { now: () => 0 },
	level: "error",
	scope: "t",
});
const never = () => new Promise<"timeout">(() => {});

describe("SIDE-19 graceful shutdown", () => {
	test("SIDE-19 a failing step is reported and the others still run", async () => {
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

	test("SIDE-19 a step that exceeds its limit is abandoned and reported", async () => {
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

	test("SIDE-19 every step gets its own time limit, including the 1 s outbox close", async () => {
		const limits: number[] = [];
		const report = await runShutdownSteps(
			[
				{ name: "stop agents", limitMs: 10_000, run: async () => {} },
				{ name: "flush events", limitMs: 10_000, run: async () => {} },
				{ name: "close outbox", limitMs: 1_000, run: async () => {} },
				{ name: "close socket", limitMs: 5_000, run: async () => {} },
			],
			{
				logger,
				timeout: (ms) => {
					limits.push(ms);
					return never();
				},
			},
		);
		expect(limits).toEqual([10_000, 10_000, 1_000, 5_000]);
		expect(report.failed).toEqual([]);
		expect(report.completed).toEqual([
			"stop agents",
			"flush events",
			"close outbox",
			"close socket",
		]);
	});
});
