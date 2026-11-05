import { describe, expect, test } from "bun:test";
import { createLogger } from "./logging/logger.ts";
import { runShutdownSteps, type TimeoutHandle } from "./shutdown.ts";

const logger = createLogger({
	sink: () => {},
	clock: { now: () => 0 },
	level: "error",
	scope: "t",
});

const never = (): TimeoutHandle => ({
	done: new Promise<"timeout">(() => {}),
	cancel: () => {},
});

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
			{
				logger,
				// Only the 5 ms limit expires; the 1000 ms limit never does.
				timeout: (ms) =>
					ms === 5 ? { done: Promise.resolve("timeout" as const), cancel: () => {} } : never(),
			},
		);
		expect(report.failed.map((f) => f.name)).toEqual(["slow"]);
		expect(report.completed).toEqual(["after"]);
	});

	test("SIDE-19 each step's time limit is cancelled when the step finishes first", async () => {
		const cancelled: number[] = [];
		const report = await runShutdownSteps(
			[
				{ name: "stop agents", limitMs: 10_000, run: async () => {} },
				{ name: "flush events", limitMs: 10_000, run: async () => {} },
				{ name: "close socket", limitMs: 5_000, run: async () => {} },
			],
			{
				logger,
				timeout: (ms) => ({
					done: new Promise<"timeout">(() => {}),
					cancel: () => {
						cancelled.push(ms);
					},
				}),
			},
		);
		expect(report.completed).toEqual(["stop agents", "flush events", "close socket"]);
		expect(cancelled).toEqual([10_000, 10_000, 5_000]);
	});
});
