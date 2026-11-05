/**
 * @feature SIDE-07 Process manager: leases, idle stop, warm pool
 * Owns: the one stand-in for the process manager (ProcessManager) that session tests use. It keeps
 * one agent per key, shares a start between callers, counts leases, and applies the same idle and
 * warm-cap rules, so a test sees what the real manager does with a lease that is released.
 * Behaviour: process/process-manager.ts. The idle rule and the warm cap are the real functions of
 * process/idle-policy.ts. fake-processes.test.ts runs one script on this class and on
 * AgentProcessManager and compares which agents each one stops.
 * Must handle: single flight on one key, release() that leaves a process busy unless it went idle
 * after the claim, a process that was never idle (never stopped by the idle rule), background
 * tasks, a disconnect while a start is pending, and a dispose that throws during stopAll.
 * Test first: fake-processes.test.ts, "a released lease keeps the process busy until markIdle".
 */
import type { Clock } from "@conducted/shared";
import {
	type ProcessEntryView,
	selectIdleToStop,
	selectWarmToEvict,
} from "../process/idle-policy.ts";
import type { ProcessLease, ProcessManager } from "../process/process-manager.ts";
import type { AgentSession } from "../runners/runner.ts";

interface Entry {
	readonly key: string;
	agent: AgentSession | null;
	retention: "warm" | "active";
	activeLeases: number;
	busy: boolean;
	hasBackgroundTasks: boolean;
	lastIdleAt: number | null;
	idleGeneration: number;
	started: Promise<AgentSession | null>;
	disconnected: boolean;
}

export class FakeProcesses implements ProcessManager {
	/** The live agents by key. */
	readonly agents = new Map<string, AgentSession>();
	readonly disconnected: string[] = [];
	readonly busy: string[] = [];
	readonly idle: string[] = [];
	readonly backgroundTaskCalls: { key: string; hasTasks: boolean }[] = [];
	/** Errors thrown by an agent's dispose. The real manager logs them and goes on. */
	readonly disposeErrors: unknown[] = [];
	stopAllCalls = 0;

	private readonly entries = new Map<string, Entry>();

	constructor(private readonly clock: Clock = { now: () => 0 }) {}

	async claimActive(key: string, start: () => Promise<AgentSession>): Promise<ProcessLease> {
		const entry = await this.ensureEntry(key, start, "active");
		if (entry.disconnected || entry.agent === null) {
			throw new Error("The agent process was disconnected while starting.");
		}
		entry.retention = "active";
		entry.activeLeases += 1;
		const generation = entry.idleGeneration;
		const agent = entry.agent;
		let released = false;
		return {
			key,
			agent,
			release: () => {
				if (released) return;
				released = true;
				if (entry.activeLeases > 0) entry.activeLeases -= 1;
				if (
					!entry.disconnected &&
					this.entries.get(key) === entry &&
					entry.idleGeneration === generation
				) {
					entry.busy = true;
				}
			},
		};
	}

	async ensureWarm(key: string, start: () => Promise<AgentSession>): Promise<void> {
		const entry = await this.ensureEntry(key, start, "warm");
		if (entry.disconnected || entry.agent === null) return;
		const warm = (entry.agent as AgentSession & { warm?: () => Promise<void> }).warm;
		if (typeof warm === "function") await warm.call(entry.agent);
	}

	markBusy(key: string): void {
		this.busy.push(key);
		const entry = this.entries.get(key);
		if (entry !== undefined) entry.busy = true;
	}

	markIdle(key: string): void {
		this.idle.push(key);
		const entry = this.entries.get(key);
		if (entry === undefined) return;
		entry.busy = false;
		entry.idleGeneration += 1;
		entry.lastIdleAt = this.clock.now();
	}

	setBackgroundTasks(key: string, hasTasks: boolean): void {
		this.backgroundTaskCalls.push({ key, hasTasks });
		const entry = this.entries.get(key);
		if (entry !== undefined) entry.hasBackgroundTasks = hasTasks;
	}

	async disconnect(key: string): Promise<void> {
		this.disconnected.push(key);
		const entry = this.entries.get(key);
		if (entry === undefined) return;
		entry.disconnected = true;
		this.entries.delete(key);
		this.agents.delete(key);
		await this.dispose(entry);
	}

	async sweep(): Promise<void> {
		const now = this.clock.now();
		for (const key of selectIdleToStop(this.views(), now)) {
			await this.stopIf(key, (entry) => selectIdleToStop([this.viewOf(entry)], now).length > 0);
		}
		for (const key of selectWarmToEvict(this.views())) {
			await this.stopIf(key, () => selectWarmToEvict(this.views()).includes(key));
		}
	}

	async stopAll(): Promise<void> {
		this.stopAllCalls += 1;
		const entries = [...this.entries.values()];
		this.entries.clear();
		this.agents.clear();
		for (const entry of entries) {
			entry.disconnected = true;
			await this.dispose(entry);
		}
	}

	private async ensureEntry(
		key: string,
		start: () => Promise<AgentSession>,
		retention: "warm" | "active",
	): Promise<Entry> {
		const existing = this.entries.get(key);
		if (existing !== undefined) {
			await existing.started;
			return existing;
		}
		const entry: Entry = {
			key,
			agent: null,
			retention,
			activeLeases: 0,
			busy: false,
			hasBackgroundTasks: false,
			lastIdleAt: null,
			idleGeneration: 0,
			started: Promise.resolve(null),
			disconnected: false,
		};
		this.entries.set(key, entry);
		entry.started = this.runStart(entry, start);
		await entry.started;
		return entry;
	}

	private async runStart(
		entry: Entry,
		start: () => Promise<AgentSession>,
	): Promise<AgentSession | null> {
		let agent: AgentSession;
		try {
			agent = await start();
		} catch (cause) {
			if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
			throw cause;
		}
		if (entry.disconnected) {
			await this.disposeAgent(agent);
			return null;
		}
		entry.agent = agent;
		this.agents.set(entry.key, agent);
		if (entry.retention === "warm") entry.lastIdleAt = this.clock.now();
		return agent;
	}

	private views(): ProcessEntryView[] {
		return [...this.entries.values()]
			.filter((entry) => entry.agent !== null)
			.map((entry) => this.viewOf(entry));
	}

	private viewOf(entry: Entry): ProcessEntryView {
		return {
			key: entry.key,
			retention: entry.retention,
			activeLeases: entry.activeLeases,
			busy: entry.busy,
			hasBackgroundTasks: entry.hasBackgroundTasks,
			lastIdleAt: entry.lastIdleAt,
		};
	}

	private async stopIf(key: string, stillEligible: (entry: Entry) => boolean): Promise<void> {
		const entry = this.entries.get(key);
		if (entry === undefined || entry.disconnected || entry.agent === null) return;
		if (!stillEligible(entry)) return;
		entry.disconnected = true;
		this.entries.delete(key);
		this.agents.delete(key);
		await this.dispose(entry);
	}

	private async dispose(entry: Entry): Promise<void> {
		const agent = await entry.started.catch(() => null);
		if (agent === null) return;
		await this.disposeAgent(agent);
	}

	private async disposeAgent(agent: AgentSession): Promise<void> {
		try {
			await agent.dispose();
		} catch (cause) {
			// The real manager logs a dispose that throws and goes on with the others.
			this.disposeErrors.push(cause);
		}
	}
}
