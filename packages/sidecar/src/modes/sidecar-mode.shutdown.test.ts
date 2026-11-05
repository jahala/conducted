import { describe, expect, test } from "bun:test";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import { runShutdownSteps, type TimeoutHandle } from "../shutdown.ts";
import {
	createShutdownSteps,
	installSignalHandlers,
	ShutdownCoordinator,
	type ShutdownEffects,
	type ShutdownSignal,
	type SignalPort,
} from "./sidecar-mode.ts";

const never = (): TimeoutHandle => ({
	done: new Promise<"timeout">(() => {}),
	cancel: () => {},
});

function recordingLogger(): { logger: ReturnType<typeof createLogger>; records: LogRecord[] } {
	const records: LogRecord[] = [];
	return {
		logger: createLogger({
			sink: (record) => records.push(record),
			clock: { now: () => 0 },
			level: "debug",
			scope: "test",
		}),
		records,
	};
}

function recordingEffects(order: string[]): ShutdownEffects {
	return {
		stopAgents: async (reason) => {
			order.push(`stop agents:${reason}`);
		},
		flushEvents: async () => {
			order.push("flush events");
		},
		closeSocket: async () => {
			order.push("close socket");
		},
		closeAppToolsBridge: async () => {
			order.push("close app tools bridge");
		},
	};
}

class FakeSignals implements SignalPort {
	private readonly listeners = new Map<ShutdownSignal, Set<() => void>>([
		["SIGINT", new Set()],
		["SIGTERM", new Set()],
	]);

	on(signal: ShutdownSignal, listener: () => void): void {
		this.listeners.get(signal)?.add(listener);
	}

	off(signal: ShutdownSignal, listener: () => void): void {
		this.listeners.get(signal)?.delete(listener);
	}

	fire(signal: ShutdownSignal): void {
		for (const listener of [...(this.listeners.get(signal) ?? [])]) listener();
	}

	count(signal: ShutdownSignal): number {
		return this.listeners.get(signal)?.size ?? 0;
	}
}

describe("SIDE-19 production shutdown steps", () => {
	test("SIDE-19 the steps run in order with their real time limits", async () => {
		const order: string[] = [];
		const { logger } = recordingLogger();
		const steps = createShutdownSteps("parent_gone", recordingEffects(order));

		expect(steps.map((step) => [step.name, step.limitMs])).toEqual([
			["stop agents", 10_000],
			["flush events", 10_000],
			["close socket", 5_000],
			["close app tools bridge", 5_000],
		]);

		const report = await runShutdownSteps(steps, { logger, timeout: never });
		expect(order).toEqual([
			"stop agents:parent_gone",
			"flush events",
			"close socket",
			"close app tools bridge",
		]);
		expect(report.completed).toEqual([
			"stop agents",
			"flush events",
			"close socket",
			"close app tools bridge",
		]);
		expect(report.failed).toEqual([]);
	});
});

describe("SIDE-19 shutdown coordinator", () => {
	test("SIDE-19 a second shutdown request is ignored and the process finishes with code 0", async () => {
		const order: string[] = [];
		const { logger } = recordingLogger();
		let beforeShutdown = 0;
		const finished: number[] = [];
		const coordinator = new ShutdownCoordinator({
			logger,
			effects: recordingEffects(order),
			runShutdown: (steps) => runShutdownSteps(steps, { logger, timeout: never }),
			beforeShutdown: () => {
				beforeShutdown += 1;
			},
			finish: (code) => {
				finished.push(code);
			},
		});

		await Promise.all([coordinator.shutdown("parent_gone"), coordinator.shutdown("signal")]);

		expect(beforeShutdown).toBe(1);
		expect(order).toEqual([
			"stop agents:parent_gone",
			"flush events",
			"close socket",
			"close app tools bridge",
		]);
		expect(finished).toEqual([0]);
		expect(coordinator.isFinished).toBe(true);
	});
});

describe("SIDE-19 signal handlers", () => {
	test("SIDE-19 SIGINT and SIGTERM log under SIGNAL and start the shutdown", () => {
		const signals = new FakeSignals();
		const { logger, records } = recordingLogger();
		const seen: ShutdownSignal[] = [];

		const remove = installSignalHandlers(logger, signals, (signal) => seen.push(signal));
		expect(signals.count("SIGINT")).toBe(1);
		expect(signals.count("SIGTERM")).toBe(1);

		signals.fire("SIGTERM");
		signals.fire("SIGINT");

		expect(seen).toEqual(["SIGTERM", "SIGINT"]);
		expect(
			records.filter((record) => record.scope === "test:SIGNAL").map((record) => record.message),
		).toEqual(["SIGTERM received; shutting down", "SIGINT received; shutting down"]);

		remove();
		expect(signals.count("SIGINT")).toBe(0);
		expect(signals.count("SIGTERM")).toBe(0);
	});
});
