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
 *  - sweep(now) is called every 2 s by the watchdog tick; a process with background tasks is kept
 *  - disconnect(key) while a start is pending: the started process is disposed at once
 *  - stopAll() on shutdown, errors from dispose are logged and do not stop the others
 *  - no limit on the number of working chats (Conductor has none either)
 * Test first: two claimActive calls for one key run `start` once and return the same process.
 */

import type { Clock } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { AgentSession } from "../runners/runner.ts";

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

export class AgentProcessManager implements ProcessManager {
	constructor(protected readonly deps: { clock: Clock; logger: Logger }) {}

	claimActive(_key: string, _start: () => Promise<AgentSession>): Promise<ProcessLease> {
		return notImplemented("SIDE-07");
	}

	ensureWarm(_key: string, _start: () => Promise<AgentSession>): Promise<void> {
		return notImplemented("SIDE-07");
	}

	markBusy(_key: string): void {
		notImplemented("SIDE-07");
	}

	markIdle(_key: string): void {
		notImplemented("SIDE-07");
	}

	setBackgroundTasks(_key: string, _hasTasks: boolean): void {
		notImplemented("SIDE-07");
	}

	disconnect(_key: string): Promise<void> {
		return notImplemented("SIDE-07");
	}

	sweep(): Promise<void> {
		return notImplemented("SIDE-07");
	}

	stopAll(): Promise<void> {
		return notImplemented("SIDE-07");
	}
}

/** The key of a chat's process. ACP agents include the adapter name. */
export function processKey(agent: string, acpAgent: string | undefined, sessionId: string): string {
	return acpAgent === undefined ? `${agent}:${sessionId}` : `${agent}:${acpAgent}:${sessionId}`;
}
