import { describe, expect, test } from "bun:test";
import type { SessionId } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import type { AgentSession, TurnInput, TurnOutcome } from "../runners/runner.ts";
import { IDLE_STOP_AFTER_MS, MAX_WARM_PROCESSES, SWEEP_INTERVAL_MS } from "./idle-policy.ts";
import { AgentProcessManager, type ProcessLease, processKey } from "./process-manager.ts";

class FakeClock {
	nowMs = 0;
	now(): number {
		return this.nowMs;
	}
	advance(ms: number): void {
		this.nowMs += ms;
	}
}

class FakeAgent implements AgentSession {
	readonly sessionId = "session-1" as SessionId;
	disposed = 0;
	warmCalls = 0;
	constructor(private readonly failDispose = false) {}

	async runTurn(_input: TurnInput): Promise<TurnOutcome> {
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
	async warm(): Promise<void> {
		this.warmCalls += 1;
	}
}

class GatedAgent extends FakeAgent {
	readonly disposeStarted: Promise<void>;
	readonly disposeGate: Promise<void>;
	private readonly markDisposeStarted: () => void;
	private readonly openDisposeGate: () => void;

	constructor() {
		super();
		let markDisposeStarted: () => void = () => {};
		this.disposeStarted = new Promise<void>((resolve) => {
			markDisposeStarted = resolve;
		});
		this.markDisposeStarted = markDisposeStarted;
		let openDisposeGate: () => void = () => {};
		this.disposeGate = new Promise<void>((resolve) => {
			openDisposeGate = resolve;
		});
		this.openDisposeGate = openDisposeGate;
	}

	override async dispose(): Promise<void> {
		this.markDisposeStarted();
		await this.disposeGate;
		await super.dispose();
	}

	releaseDispose(): void {
		this.openDisposeGate();
	}
}

function makeManager(): {
	manager: AgentProcessManager;
	clock: FakeClock;
	records: LogRecord[];
} {
	const clock = new FakeClock();
	const records: LogRecord[] = [];
	const logger = createLogger({
		sink: (record) => records.push(record),
		clock,
		level: "debug",
		scope: "test",
	});
	return { manager: new AgentProcessManager({ clock, logger }), clock, records };
}

function deferredStart(): {
	start: () => Promise<AgentSession>;
	resolve: (agent: AgentSession) => void;
	reject: (cause: unknown) => void;
} {
	let resolve: (agent: AgentSession) => void = () => {};
	let reject: (cause: unknown) => void = () => {};
	const gate = new Promise<AgentSession>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { start: () => gate, resolve, reject };
}

const releaseAll = (leases: readonly ProcessLease[]): void => {
	for (const lease of leases) lease.release();
};

describe("SIDE-07 process manager leases", () => {
	test("SIDE-07 two claimActive calls for one key run start once and return the same process", async () => {
		const { manager } = makeManager();
		const agent = new FakeAgent();
		let starts = 0;
		const gate = deferredStart();
		const start = async (): Promise<AgentSession> => {
			starts += 1;
			return gate.start();
		};

		const first = manager.claimActive("claude:s1", start);
		const second = manager.claimActive("claude:s1", start);
		gate.resolve(agent);

		const [a, b] = await Promise.all([first, second]);
		expect(starts).toBe(1);
		expect(a.agent).toBe(agent);
		expect(b.agent).toBe(agent);
		releaseAll([a, b]);
	});

	test("SIDE-07 a claim on a live process reuses it without starting another", async () => {
		const { manager } = makeManager();
		const agent = new FakeAgent();
		let starts = 0;
		const start = async (): Promise<AgentSession> => {
			starts += 1;
			return agent;
		};

		const first = await manager.claimActive("claude:s1", start);
		first.release();
		const second = await manager.claimActive("claude:s1", start);

		expect(starts).toBe(1);
		expect(second.agent).toBe(agent);
		second.release();
	});

	test("SIDE-07 a failed start is forgotten, so the next claim can start again", async () => {
		const { manager } = makeManager();
		const agent = new FakeAgent();
		let starts = 0;
		const start = async (): Promise<AgentSession> => {
			starts += 1;
			if (starts === 1) throw new Error("no program on PATH");
			return agent;
		};

		await expect(manager.claimActive("claude:s1", start)).rejects.toThrow("no program on PATH");
		const lease = await manager.claimActive("claude:s1", start);

		expect(starts).toBe(2);
		expect(lease.agent).toBe(agent);
		lease.release();
	});

	test("SIDE-07 release marks busy only when no idle transition happened meanwhile", async () => {
		const stopping = makeManager();
		const stopAgent = new FakeAgent();
		await stopping.manager.ensureWarm("claude:s1", async () => stopAgent);
		stopping.manager.markIdle("claude:s1");
		const stoppingLease = await stopping.manager.claimActive("claude:s1", async () => stopAgent);
		stopping.manager.markIdle("claude:s1");
		stoppingLease.release();
		stopping.clock.advance(IDLE_STOP_AFTER_MS);
		await stopping.manager.sweep();
		expect(stopAgent.disposed).toBe(1);

		const keeping = makeManager();
		const keepAgent = new FakeAgent();
		await keeping.manager.ensureWarm("claude:s1", async () => keepAgent);
		keeping.manager.markIdle("claude:s1");
		const keepingLease = await keeping.manager.claimActive("claude:s1", async () => keepAgent);
		keepingLease.release();
		keeping.clock.advance(IDLE_STOP_AFTER_MS);
		await keeping.manager.sweep();
		expect(keepAgent.disposed).toBe(0);
	});

	test("SIDE-07 a lease keeps the process alive past the idle timeout", async () => {
		const { manager, clock } = makeManager();
		const agent = new FakeAgent();
		await manager.ensureWarm("claude:s1", async () => agent);
		manager.markIdle("claude:s1");
		const lease = await manager.claimActive("claude:s1", async () => agent);

		clock.advance(IDLE_STOP_AFTER_MS);
		await manager.sweep();
		expect(agent.disposed).toBe(0);

		lease.release();
		manager.markIdle("claude:s1");
		clock.advance(IDLE_STOP_AFTER_MS);
		await manager.sweep();
		expect(agent.disposed).toBe(1);
	});

	test("SIDE-07 a claim that lands while an idle sweep awaits a dispose is not stopped", async () => {
		const { manager, clock } = makeManager();
		const stopping = new GatedAgent();
		const claimed = new FakeAgent();
		await manager.ensureWarm("claude:stopping", async () => stopping);
		await manager.ensureWarm("claude:claimed", async () => claimed);
		clock.advance(IDLE_STOP_AFTER_MS);

		const sweeping = manager.sweep();
		await stopping.disposeStarted;
		const lease = await manager.claimActive("claude:claimed", async () => claimed);
		stopping.releaseDispose();
		await sweeping;

		expect(stopping.disposed).toBe(1);
		expect(claimed.disposed).toBe(0);
		expect(lease.agent).toBe(claimed);
		lease.release();
	});
});

describe("SIDE-07 process manager warm pool", () => {
	test("SIDE-07 warmAgent starts a process before the first message and the claim reuses it", async () => {
		const { manager } = makeManager();
		const agent = new FakeAgent();
		let starts = 0;
		const start = async (): Promise<AgentSession> => {
			starts += 1;
			return agent;
		};

		await manager.ensureWarm("claude:s1", start);
		expect(starts).toBe(1);
		expect(agent.warmCalls).toBe(1);

		const lease = await manager.claimActive("claude:s1", start);
		expect(starts).toBe(1);
		expect(lease.agent).toBe(agent);
		lease.release();
	});

	test("SIDE-07 two ensureWarm calls share one start and one warm call", async () => {
		const { manager } = makeManager();
		const agent = new FakeAgent();
		let starts = 0;
		const gate = deferredStart();
		const start = async (): Promise<AgentSession> => {
			starts += 1;
			return gate.start();
		};

		const first = manager.ensureWarm("claude:s1", start);
		const second = manager.ensureWarm("claude:s1", start);
		gate.resolve(agent);
		await Promise.all([first, second]);

		expect(starts).toBe(1);
		expect(agent.warmCalls).toBe(1);
	});

	test("SIDE-07 ensureWarm never downgrades an active entry to warm", async () => {
		const { manager, clock } = makeManager();
		const active = new FakeAgent();
		const warmA = new FakeAgent();
		const warmB = new FakeAgent();
		const warmC = new FakeAgent();

		await manager.ensureWarm("claude:active", async () => active);
		manager.markIdle("claude:active");
		const lease = await manager.claimActive("claude:active", async () => active);
		manager.markIdle("claude:active");
		lease.release();

		clock.advance(1);
		await manager.ensureWarm("claude:a", async () => warmA);
		clock.advance(1);
		await manager.ensureWarm("claude:b", async () => warmB);
		clock.advance(1);
		await manager.ensureWarm("claude:c", async () => warmC);
		await manager.ensureWarm("claude:active", async () => active);
		await manager.sweep();

		expect(active.disposed).toBe(0);
		expect(warmA.disposed).toBe(1);
	});

	test("SIDE-07 the warm cap keeps two warm processes and evicts the least recently idle", async () => {
		const { manager, clock } = makeManager();
		const warmA = new FakeAgent();
		const warmB = new FakeAgent();
		const warmC = new FakeAgent();

		await manager.ensureWarm("claude:a", async () => warmA);
		clock.advance(1);
		await manager.ensureWarm("claude:b", async () => warmB);
		clock.advance(1);
		await manager.ensureWarm("claude:c", async () => warmC);

		expect(MAX_WARM_PROCESSES).toBe(2);
		await manager.sweep();

		expect(warmA.disposed).toBe(1);
		expect(warmB.disposed).toBe(0);
		expect(warmC.disposed).toBe(0);
	});

	test("SIDE-07 a claim during the warm-cap sweep keeps the process it claimed", async () => {
		const { manager, clock } = makeManager();
		const oldest = new GatedAgent();
		const claimed = new FakeAgent();
		const warmC = new FakeAgent();
		const warmD = new FakeAgent();
		await manager.ensureWarm("claude:a", async () => oldest);
		clock.advance(1);
		await manager.ensureWarm("claude:b", async () => claimed);
		clock.advance(1);
		await manager.ensureWarm("claude:c", async () => warmC);
		clock.advance(1);
		await manager.ensureWarm("claude:d", async () => warmD);

		const sweeping = manager.sweep();
		await oldest.disposeStarted;
		const lease = await manager.claimActive("claude:b", async () => claimed);
		oldest.releaseDispose();
		await sweeping;

		expect(oldest.disposed).toBe(1);
		expect(claimed.disposed).toBe(0);
		expect(lease.agent).toBe(claimed);
		lease.release();
	});
});

describe("SIDE-07 process manager idle stop", () => {
	test("SIDE-07 an idle process stops after 30 minutes and the sweep runs every 2 seconds", async () => {
		expect(IDLE_STOP_AFTER_MS).toBe(30 * 60 * 1000);
		expect(SWEEP_INTERVAL_MS).toBe(2_000);

		const { manager, clock } = makeManager();
		const agent = new FakeAgent();
		await manager.ensureWarm("claude:s1", async () => agent);

		clock.advance(IDLE_STOP_AFTER_MS - 1);
		await manager.sweep();
		expect(agent.disposed).toBe(0);

		clock.advance(1);
		await manager.sweep();
		expect(agent.disposed).toBe(1);
	});

	test("SIDE-07 a process with background tasks survives the idle sweep until the tasks end", async () => {
		const { manager, clock } = makeManager();
		const agent = new FakeAgent();
		await manager.ensureWarm("claude:s1", async () => agent);
		manager.setBackgroundTasks("claude:s1", true);

		clock.advance(IDLE_STOP_AFTER_MS);
		await manager.sweep();
		expect(agent.disposed).toBe(0);

		manager.setBackgroundTasks("claude:s1", false);
		await manager.sweep();
		expect(agent.disposed).toBe(1);
	});

	test("SIDE-07 busy and idle marks follow the live state", async () => {
		const { manager, clock } = makeManager();
		const agent = new FakeAgent();
		await manager.ensureWarm("claude:s1", async () => agent);

		manager.markBusy("claude:s1");
		clock.advance(IDLE_STOP_AFTER_MS);
		await manager.sweep();
		expect(agent.disposed).toBe(0);

		manager.markIdle("claude:s1");
		clock.advance(IDLE_STOP_AFTER_MS);
		await manager.sweep();
		expect(agent.disposed).toBe(1);
	});
});

describe("SIDE-07 process manager disconnect and shutdown", () => {
	test("SIDE-07 disconnect stops the process and forgets the session, so the next claim is fresh", async () => {
		const { manager } = makeManager();
		const firstAgent = new FakeAgent();
		const secondAgent = new FakeAgent();
		let starts = 0;
		const start = async (): Promise<AgentSession> => {
			starts += 1;
			return starts === 1 ? firstAgent : secondAgent;
		};

		const lease = await manager.claimActive("claude:s1", start);
		lease.release();
		await manager.disconnect("claude:s1");
		expect(firstAgent.disposed).toBe(1);

		const fresh = await manager.claimActive("claude:s1", start);
		expect(starts).toBe(2);
		expect(fresh.agent).toBe(secondAgent);
		fresh.release();
	});

	test("SIDE-07 disconnect while a start is pending disposes the started process at once", async () => {
		const { manager } = makeManager();
		const agent = new FakeAgent();
		const gate = deferredStart();
		const claimed = manager.claimActive("claude:s1", gate.start);
		const disconnecting = manager.disconnect("claude:s1");
		gate.resolve(agent);

		await disconnecting;
		await expect(claimed).rejects.toThrow("disconnected while starting");
		expect(agent.disposed).toBe(1);
	});

	test("SIDE-07 stopAll disposes every process and keeps going when one dispose fails", async () => {
		const { manager, records } = makeManager();
		const failing = new FakeAgent(true);
		const healthy = new FakeAgent();
		await manager.ensureWarm("claude:failing", async () => failing);
		await manager.ensureWarm("claude:healthy", async () => healthy);

		await manager.stopAll();

		expect(failing.disposed).toBe(1);
		expect(healthy.disposed).toBe(1);
		expect(
			records.some(
				(record) =>
					record.level === "warn" &&
					record.message === "Could not stop an agent process" &&
					record.data?.error === "dispose failed",
			),
		).toBe(true);
	});
});

describe("SIDE-07 process manager keys and concurrency", () => {
	test("SIDE-07 the key includes the ACP adapter when there is one", () => {
		expect(processKey("claude", undefined, "s1")).toBe("claude:s1");
		expect(processKey("acp", "opencode", "s1")).toBe("acp:opencode:s1");
	});

	test("SIDE-07 changing the agent type keeps a separate process for each key", async () => {
		const { manager } = makeManager();
		const claude = new FakeAgent();
		const codex = new FakeAgent();
		const starts: string[] = [];
		const start = (name: string) => async (): Promise<AgentSession> => {
			starts.push(name);
			return name === "claude" ? claude : codex;
		};

		const first = await manager.claimActive(processKey("claude", undefined, "s1"), start("claude"));
		const second = await manager.claimActive(processKey("codex", undefined, "s1"), start("codex"));

		expect(starts).toEqual(["claude", "codex"]);
		expect(first.agent).toBe(claude);
		expect(second.agent).toBe(codex);
		first.release();
		second.release();
	});

	test("SIDE-07 many chats work at once with no concurrency limit", async () => {
		const { manager } = makeManager();
		const agents = Array.from({ length: 20 }, () => new FakeAgent());
		let starts = 0;
		const leases = await Promise.all(
			agents.map((agent, index) =>
				manager.claimActive(`claude:s${index}`, async () => {
					starts += 1;
					return agent;
				}),
			),
		);

		expect(starts).toBe(20);
		expect(leases.map((lease) => lease.agent)).toEqual(agents);
		releaseAll(leases);
	});
});
