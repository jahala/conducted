/**
 * @feature SIDE-07 Process manager: leases, idle stop, warm pool
 * Owns: the agent processes of all chats. A chat takes a lease while it uses its process; a
 * process with no lease and no work is stopped after 30 minutes; at most 2 pre-warmed processes
 * that nobody used yet are kept.
 * Behaviour: research/conductor/sessions.md section 3 "Process manager N4t" and "warmAgent".
 * Conductor keys a process by agent, session and a hash of workspace and config; we key it by
 * agent and session, and the runner decides when a config change needs a restart (applyConfig).
 * Must handle:
 *  - claimActive on a key that is starting: share the start (single flight), do not start twice
 *  - claimActive sets retention "active"; ensureWarm sets "warm" but never downgrades an active one
 *  - release() on a lease: the process stays; only markIdle starts the idle clock
 *  - markBusy / markIdle follow the chat's live state; markIdle stamps lastIdleAt
 *  - race: markIdle then markBusy before the sweep runs: the sweep must see busy (idle
 *    generation guard; markBusyIfIdleGenerationUnchanged in Conductor)
 *  - sweep() reads the clock and is called every 2 s by the watchdog tick; a process with
 *    background tasks is kept
 *  - disconnect(key) while a start is pending: the started process is disposed at once
 *  - stopAll() on shutdown, errors from dispose are logged and do not stop the others
 *  - no limit on the number of working chats (Conductor has none either)
 * Test first: two claimActive calls for one key run `start` once and return the same process.
 */

import type { Clock } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { AgentSession } from "../runners/runner.ts";
import { messageOf } from "../util/errors.ts";
import {
	type ProcessEntryView,
	type Retention,
	selectIdleToStop,
	selectWarmToEvict,
} from "./idle-policy.ts";

export interface ProcessLease {
	readonly key: string;
	readonly agent: AgentSession;
	/** Gives the lease back. The process stays alive. */
	release(): void;
}

export interface ProcessManager {
	/** Takes a lease, starting the process with `start` if there is none. */
	claimActive(key: string, start: () => Promise<AgentSession>): Promise<ProcessLease>;
	/** Starts a process ahead of the first message. Counts toward the warm cap. */
	ensureWarm(key: string, start: () => Promise<AgentSession>): Promise<void>;
	markBusy(key: string): void;
	markIdle(key: string): void;
	/** Tells the manager which chats have background tasks, so the idle sweep spares them. */
	setBackgroundTasks(key: string, hasTasks: boolean): void;
	/** Stops one process and forgets it. */
	disconnect(key: string): Promise<void>;
	/** Applies the idle rule and the warm cap. Called every SWEEP_INTERVAL_MS. */
	sweep(): Promise<void>;
	stopAll(): Promise<void>;
}

type EntryState = "starting" | "live";

interface ProcessEntry {
	readonly key: string;
	agent: AgentSession | null;
	state: EntryState;
	retention: Retention;
	activeLeases: number;
	busy: boolean;
	hasBackgroundTasks: boolean;
	/** When the process last went idle (ms since epoch), or null if it never did. */
	lastIdleAt: number | null;
	/** Bumped by every idle transition, so a late markBusy can see it happened. */
	idleGeneration: number;
	/** The one start every caller for this key shares. */
	started: Promise<AgentSession | null> | null;
	/** The one warm call every caller shares. */
	warming: Promise<void> | null;
	disconnected: boolean;
}

/** Runners that can start their process ahead of the first message (Claude today). */
interface WarmableAgent {
	warm(): Promise<void>;
}

export class AgentProcessManager implements ProcessManager {
	private readonly entries = new Map<string, ProcessEntry>();

	constructor(protected readonly deps: { clock: Clock; logger: Logger }) {}

	async claimActive(key: string, start: () => Promise<AgentSession>): Promise<ProcessLease> {
		const entry = await this.ensureEntry(key, start, "active");
		if (entry.disconnected || entry.agent === null) {
			throw new Error("The agent process was disconnected while starting.");
		}
		entry.retention = "active";
		entry.activeLeases += 1;
		const idleGeneration = entry.idleGeneration;

		let released = false;
		return {
			key,
			agent: entry.agent,
			release: () => {
				if (released) return;
				released = true;
				if (entry.activeLeases > 0) entry.activeLeases -= 1;
				// A turn that is still running keeps the process busy. An idle transition after the
				// claim means the turn already ended, so the process must stay idle.
				if (
					!entry.disconnected &&
					this.entries.get(key) === entry &&
					entry.idleGeneration === idleGeneration
				) {
					entry.busy = true;
				}
			},
		};
	}

	async ensureWarm(key: string, start: () => Promise<AgentSession>): Promise<void> {
		const entry = await this.ensureEntry(key, start, "warm");
		if (entry.disconnected) return;
		await this.warmEntry(entry);
	}

	markBusy(key: string): void {
		const entry = this.entries.get(key);
		if (entry === undefined) return;
		entry.busy = true;
	}

	markIdle(key: string): void {
		const entry = this.entries.get(key);
		if (entry === undefined) return;
		entry.busy = false;
		entry.idleGeneration += 1;
		entry.lastIdleAt = this.deps.clock.now();
	}

	setBackgroundTasks(key: string, hasTasks: boolean): void {
		const entry = this.entries.get(key);
		if (entry === undefined) return;
		entry.hasBackgroundTasks = hasTasks;
	}

	async disconnect(key: string): Promise<void> {
		const entry = this.entries.get(key);
		if (entry === undefined) return;
		entry.disconnected = true;
		this.entries.delete(key);
		await this.disposeEntry(entry, "disconnect");
	}

	async sweep(): Promise<void> {
		const now = this.deps.clock.now();
		for (const key of selectIdleToStop(this.liveViews(), now)) {
			await this.stopEntry(key, "idle timeout");
		}
		for (const key of selectWarmToEvict(this.liveViews())) {
			await this.stopEntry(key, "warm cap");
		}
	}

	async stopAll(): Promise<void> {
		const entries = [...this.entries.values()];
		this.entries.clear();
		for (const entry of entries) {
			entry.disconnected = true;
			await this.disposeEntry(entry, "shutdown");
		}
	}

	/** Finds or creates the entry for a key, so every caller shares one start. */
	private async ensureEntry(
		key: string,
		start: () => Promise<AgentSession>,
		retention: Retention,
	): Promise<ProcessEntry> {
		const existing = this.entries.get(key);
		if (existing !== undefined) {
			if (existing.state === "starting" && existing.started !== null) await existing.started;
			return existing;
		}

		const entry: ProcessEntry = {
			key,
			agent: null,
			state: "starting",
			retention,
			activeLeases: 0,
			busy: false,
			hasBackgroundTasks: false,
			lastIdleAt: null,
			idleGeneration: 0,
			started: null,
			warming: null,
			disconnected: false,
		};
		this.entries.set(key, entry);
		entry.started = this.runStart(entry, start);
		await entry.started;
		return entry;
	}

	/** Starts one process. A disconnect during the start disposes it as soon as it exists. */
	private async runStart(
		entry: ProcessEntry,
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
			await this.disposeAgent(entry.key, agent, "disconnected while starting");
			return null;
		}

		entry.agent = agent;
		entry.state = "live";
		// A process nothing has used yet is idle from the moment it exists. Its idle time also
		// orders the warm cap, least recently idle first.
		if (entry.retention === "warm") entry.lastIdleAt = this.deps.clock.now();
		return agent;
	}

	/** Starts the agent's process ahead of the first message, once for every caller. */
	private async warmEntry(entry: ProcessEntry): Promise<void> {
		if (entry.warming !== null) return entry.warming;
		const agent = entry.agent;
		if (agent === null) return;
		const warm = warmMethodOf(agent);
		if (warm === undefined) return;
		entry.warming = warm().then(
			() => {
				entry.warming = null;
			},
			(cause: unknown) => {
				entry.warming = null;
				throw cause;
			},
		);
		return entry.warming;
	}

	private liveViews(): ProcessEntryView[] {
		return [...this.entries.values()]
			.filter((entry) => entry.state === "live")
			.map((entry) => ({
				key: entry.key,
				retention: entry.retention,
				activeLeases: entry.activeLeases,
				busy: entry.busy,
				hasBackgroundTasks: entry.hasBackgroundTasks,
				lastIdleAt: entry.lastIdleAt,
			}));
	}

	private async stopEntry(key: string, reason: string): Promise<void> {
		const entry = this.entries.get(key);
		if (entry === undefined) return;
		entry.disconnected = true;
		this.entries.delete(key);
		await this.disposeEntry(entry, reason);
	}

	/** Disposes one entry. A start still pending disposes its process when it arrives. */
	private async disposeEntry(entry: ProcessEntry, reason: string): Promise<void> {
		if (entry.state === "starting") {
			if (entry.started === null) return;
			try {
				await entry.started;
			} catch (cause) {
				this.deps.logger.warn("An agent process failed while it was being stopped", {
					key: entry.key,
					reason,
					error: messageOf(cause),
				});
			}
			return;
		}
		if (entry.agent === null) return;
		await this.disposeAgent(entry.key, entry.agent, reason);
	}

	private async disposeAgent(key: string, agent: AgentSession, reason: string): Promise<void> {
		try {
			await agent.dispose();
		} catch (cause) {
			this.deps.logger.warn("Could not stop an agent process", {
				key,
				reason,
				error: messageOf(cause),
			});
		}
	}
}

function warmMethodOf(agent: AgentSession): (() => Promise<void>) | undefined {
	const candidate = agent as AgentSession & Partial<WarmableAgent>;
	const warm = candidate.warm;
	if (typeof warm !== "function") return undefined;
	return () => warm.call(agent);
}

/** The key of a chat's process. ACP agents include the adapter name. */
export function processKey(agent: string, acpAgent: string | undefined, sessionId: string): string {
	return acpAgent === undefined ? `${agent}:${sessionId}` : `${agent}:${acpAgent}:${sessionId}`;
}
