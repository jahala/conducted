/**
 * @feature SIDE-07 Process manager: leases, idle stop, warm pool
 * Owns: the contract test of FakeProcesses. Each scenario runs on AgentProcessManager and on
 * FakeProcesses with a clock the test moves, and both must stop the same agents at the same steps.
 * The scenarios cover the idle stop and what a released lease does to it.
 * Test first: "a released lease keeps the process busy until markIdle".
 */
import { describe, expect, test } from "bun:test";
import type { Clock, SessionId } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import { IDLE_STOP_AFTER_MS, MAX_WARM_PROCESSES } from "../process/idle-policy.ts";
import { AgentProcessManager, type ProcessManager } from "../process/process-manager.ts";
import type { AgentSession, TurnOutcome } from "../runners/runner.ts";
import { FakeProcesses } from "./fake-processes.ts";

class TestClock implements Clock {
	nowMs = 0;
	now(): number {
		return this.nowMs;
	}
	advance(ms: number): void {
		this.nowMs += ms;
	}
}

class TrackedAgent implements AgentSession {
	readonly sessionId = "session-1" as SessionId;
	disposed = 0;

	constructor(private readonly failDispose = false) {}

	async runTurn(): Promise<TurnOutcome> {
		return { kind: "success" };
	}
	async steer(): Promise<{ consumed: Promise<void> }> {
		return { consumed: Promise.resolve() };
	}
	async cancel(): Promise<void> {}
	async applyConfig(): Promise<"applied"> {
		return "applied";
	}
	async contextUsage(): Promise<null> {
		return null;
	}
	async dispose(): Promise<void> {
		this.disposed += 1;
		if (this.failDispose) throw new Error("dispose failed");
	}
}

interface World {
	clock: TestClock;
	/** Starts an agent for `start`; the agent is remembered by name. */
	agent(name: string, options?: { failDispose?: boolean }): () => Promise<AgentSession>;
	starts: string[];
	/** How many times each named agent was disposed. */
	disposals(): Record<string, number>;
}

function world(): World {
	const clock = new TestClock();
	const agents = new Map<string, TrackedAgent>();
	const starts: string[] = [];
	return {
		clock,
		starts,
		agent: (name, options) => async () => {
			starts.push(name);
			const agent = new TrackedAgent(options?.failDispose === true);
			agents.set(name, agent);
			return agent;
		},
		disposals: () => Object.fromEntries([...agents].map(([name, agent]) => [name, agent.disposed])),
	};
}

type Make = (clock: Clock) => ProcessManager;

const implementations: { name: string; make: Make }[] = [
	{
		name: "AgentProcessManager",
		make: (clock) =>
			new AgentProcessManager({
				clock,
				logger: createLogger({ sink: () => {}, clock, level: "error", scope: "contract" }),
			}),
	},
	{ name: "FakeProcesses", make: (clock) => new FakeProcesses(clock) },
];

type Scenario = {
	name: string;
	run(manager: ProcessManager, w: World): Promise<unknown>;
	expected: unknown;
};

const justOver = IDLE_STOP_AFTER_MS + 1;

const scenarios: Scenario[] = [
	{
		name: "two claims on one key share one start and one process",
		run: async (manager, w) => {
			const [first, second] = await Promise.all([
				manager.claimActive("k", w.agent("a")),
				manager.claimActive("k", w.agent("a")),
			]);
			return { starts: w.starts, same: first.agent === second.agent };
		},
		expected: { starts: ["a"], same: true },
	},
	{
		name: "a released lease keeps the process busy until markIdle",
		run: async (manager, w) => {
			const lease = await manager.claimActive("k", w.agent("a"));
			lease.release();
			w.clock.advance(justOver);
			await manager.sweep();
			return w.disposals();
		},
		expected: { a: 0 },
	},
	{
		name: "markIdle after the release starts the idle clock, and the stop comes at the limit",
		run: async (manager, w) => {
			const lease = await manager.claimActive("k", w.agent("a"));
			lease.release();
			manager.markIdle("k");
			w.clock.advance(IDLE_STOP_AFTER_MS - 1);
			await manager.sweep();
			const before = w.disposals();
			w.clock.advance(1);
			await manager.sweep();
			return { before, after: w.disposals() };
		},
		expected: { before: { a: 0 }, after: { a: 1 } },
	},
	{
		name: "a process with a lease is not stopped, and one that went idle during the lease stays idle after it",
		run: async (manager, w) => {
			const lease = await manager.claimActive("k", w.agent("a"));
			manager.markIdle("k");
			w.clock.advance(justOver);
			await manager.sweep();
			const leased = w.disposals();
			lease.release();
			await manager.sweep();
			return { leased, released: w.disposals() };
		},
		expected: { leased: { a: 0 }, released: { a: 1 } },
	},
	{
		name: "a new claim after an idle turn makes the process busy again",
		run: async (manager, w) => {
			const first = await manager.claimActive("k", w.agent("a"));
			first.release();
			manager.markIdle("k");
			const second = await manager.claimActive("k", w.agent("a"));
			second.release();
			w.clock.advance(justOver);
			await manager.sweep();
			return w.disposals();
		},
		expected: { a: 0 },
	},
	{
		name: "a release called twice counts once",
		run: async (manager, w) => {
			const first = await manager.claimActive("k", w.agent("a"));
			const second = await manager.claimActive("k", w.agent("a"));
			manager.markIdle("k");
			first.release();
			first.release();
			w.clock.advance(justOver);
			await manager.sweep();
			const oneLeaseLeft = w.disposals();
			second.release();
			await manager.sweep();
			return { oneLeaseLeft, noneLeft: w.disposals() };
		},
		expected: { oneLeaseLeft: { a: 0 }, noneLeft: { a: 1 } },
	},
	{
		name: "markBusy after markIdle spares the process",
		run: async (manager, w) => {
			const lease = await manager.claimActive("k", w.agent("a"));
			lease.release();
			manager.markIdle("k");
			w.clock.advance(justOver);
			manager.markBusy("k");
			await manager.sweep();
			return w.disposals();
		},
		expected: { a: 0 },
	},
	{
		name: "background tasks spare an idle process until they end",
		run: async (manager, w) => {
			const lease = await manager.claimActive("k", w.agent("a"));
			lease.release();
			manager.markIdle("k");
			manager.setBackgroundTasks("k", true);
			w.clock.advance(justOver);
			await manager.sweep();
			const withTasks = w.disposals();
			manager.setBackgroundTasks("k", false);
			await manager.sweep();
			return { withTasks, withoutTasks: w.disposals() };
		},
		expected: { withTasks: { a: 0 }, withoutTasks: { a: 1 } },
	},
	{
		name: "Remote Control spares an idle process until it is turned off",
		run: async (manager, w) => {
			const lease = await manager.claimActive("k", w.agent("a"));
			lease.release();
			manager.markIdle("k");
			manager.setRemoteControl("k", true);
			w.clock.advance(justOver);
			await manager.sweep();
			const shared = w.disposals();
			manager.setRemoteControl("k", false);
			await manager.sweep();
			return { shared, notShared: w.disposals() };
		},
		expected: { shared: { a: 0 }, notShared: { a: 1 } },
	},
	{
		name: "disconnect stops the process once, and the next claim starts a new one",
		run: async (manager, w) => {
			const first = await manager.claimActive("k", w.agent("a"));
			first.release();
			await manager.disconnect("k");
			const second = await manager.claimActive("k", w.agent("b"));
			return { starts: w.starts, disposals: w.disposals(), fresh: second.agent !== first.agent };
		},
		expected: { starts: ["a", "b"], disposals: { a: 1, b: 0 }, fresh: true },
	},
	{
		name: "a disconnect while the start is pending stops the process as soon as it exists",
		run: async (manager, w) => {
			let open: () => void = () => {};
			const gate = new Promise<void>((resolve) => {
				open = resolve;
			});
			const gated = async () => {
				await gate;
				return w.agent("a")();
			};
			const claim = manager.claimActive("k", gated).then(
				() => "claimed",
				() => "refused",
			);
			// The disconnect waits for the start, so the gate opens before it is awaited.
			const disconnected = manager.disconnect("k");
			open();
			await disconnected;
			return { claim: await claim, disposals: w.disposals() };
		},
		expected: { claim: "refused", disposals: { a: 1 } },
	},
	{
		name: "holds answers for the live agent, and no longer once the idle stop ended it",
		run: async (manager, w) => {
			const lease = await manager.claimActive("k", w.agent("a"));
			const agent = lease.agent;
			lease.release();
			manager.markIdle("k");
			const live = manager.holds("k", agent);
			const otherKey = manager.holds("other", agent);
			w.clock.advance(justOver);
			await manager.sweep();
			const stopped = manager.holds("k", agent);
			const next = await manager.claimActive("k", w.agent("b"));
			return {
				live,
				otherKey,
				stopped,
				oldAfterRestart: manager.holds("k", agent),
				next: manager.holds("k", next.agent),
			};
		},
		expected: { live: true, otherKey: false, stopped: false, oldAfterRestart: false, next: true },
	},
	{
		name: "stopAll stops every process, and a dispose that throws does not stop the others",
		run: async (manager, w) => {
			(await manager.claimActive("one", w.agent("a", { failDispose: true }))).release();
			(await manager.claimActive("two", w.agent("b"))).release();
			await manager.stopAll();
			return w.disposals();
		},
		expected: { a: 1, b: 1 },
	},
	{
		name: "warm processes over the cap are stopped, the one idle longest first",
		run: async (manager, w) => {
			for (let index = 0; index <= MAX_WARM_PROCESSES; index += 1) {
				await manager.ensureWarm(`k${index}`, w.agent(`a${index}`));
				w.clock.advance(1);
			}
			await manager.sweep();
			return w.disposals();
		},
		expected: { a0: 1, a1: 0, a2: 0 },
	},
];

describe("SIDE-07 FakeProcesses against AgentProcessManager", () => {
	for (const item of implementations) {
		for (const scenario of scenarios) {
			test(`${item.name}: ${scenario.name}`, async () => {
				const w = world();
				const manager = item.make(w.clock);

				const observed = await scenario.run(manager, w);

				expect(observed).toEqual(scenario.expected);
			});
		}
	}
});
