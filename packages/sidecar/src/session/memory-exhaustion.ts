/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Owns: telling whether a failed turn happened because the sandbox ran out of memory, from the
 * kernel's OOM kill counter or the memory watchdog's incident marker, and Conductor's fixed message
 * for it.
 * Behaviour: research/conductor/claude-runner.md section 8 (host turn failure checks the marker
 * `/tmp/conductor-memory-watchdog-incident.json` with a 30 s window, or an increase of `oom_kill`
 * in `/proc/vmstat`, then replaces the raw error with the same fixed message) and the sidecar
 * inventory at 311700 (`kFe`).
 * Must handle: a missing `/proc/vmstat` (not Linux: no counter); a marker that is old, malformed or
 * larger than the watchdog's 4 KiB; a marker still `sweeping` (wait 500 ms once for `killed`); a
 * counter that did not rise; a cancel (never a memory message).
 * Our design choice: the marker path is ours (`CONDUCTED_MEMORY_INCIDENT_MARKER_PATH`, default
 * `/tmp/conducted-memory-watchdog-incident.json`), like every other file name we own. The watchdog
 * that writes it is the cloud runtime's, not built here; the OOM kill counter works without it.
 * Test first: a marker within 30 seconds names an exhausted workspace, and an unchanged OOM count
 * does not.
 */
import { z } from "zod";

/** Conductor's exact message for a turn that failed because the workspace ran out of memory. */
export const MEMORY_EXHAUSTED_MESSAGE =
	"Workspace ran out of memory, so agents and running commands were stopped. Retry, or move memory-heavy work to a separate workspace.";

/** How long an incident marker still describes the running workspace (Conductor: 30 s). */
export const MEMORY_INCIDENT_WINDOW_MS = 30_000;
/** How long a `sweeping` marker may take to become `killed` (Conductor: 500 ms). */
export const MEMORY_INCIDENT_SETTLE_MS = 500;
/** The largest marker the watchdog writes; a larger file is not its marker (Conductor: 4 KiB). */
export const MEMORY_INCIDENT_MAX_BYTES = 4096;
/** The kernel's OOM kill counter, on Linux. */
export const OOM_KILL_PATH = "/proc/vmstat";
/** Our own marker path; the cloud runtime writes it, and a test can point the variable at a temp file. */
export const DEFAULT_MEMORY_INCIDENT_MARKER_PATH = "/tmp/conducted-memory-watchdog-incident.json";

export interface MemoryIncident {
	kind: "workspace_memory_exhausted";
	occurredAtMs: number;
	trigger: "crash" | "thrash";
	phase: "sweeping" | "killed";
}

const zMemoryIncident = z.object({
	kind: z.literal("workspace_memory_exhausted"),
	occurredAtMs: z.number(),
	trigger: z.enum(["crash", "thrash"]),
	phase: z.enum(["sweeping", "killed"]),
});

/** The files and the clock a probe reads through, so tests use no real filesystem. */
export interface MemoryProbePorts {
	/** The file's text, or null when it does not exist. */
	readText(path: string): Promise<string | null>;
	now(): number;
	sleep(ms: number): Promise<void>;
}

export interface MemoryExhaustionProbe {
	/** The kernel's `oom_kill` count, or undefined when the file cannot be read. */
	oomKillCount(): Promise<number | undefined>;
	/** The watchdog's recent incident, after one settle wait if it is still sweeping. */
	recentIncident(): Promise<MemoryIncident | undefined>;
}

/** The `oom_kill` count in `/proc/vmstat` text, or undefined when the line is absent. */
export function parseOomKill(vmstat: string): number | undefined {
	for (const line of vmstat.split("\n")) {
		const [name, value] = line.trim().split(/\s+/);
		if (name !== "oom_kill" || value === undefined) continue;
		const count = Number(value);
		return Number.isFinite(count) ? count : undefined;
	}
	return undefined;
}

/** True when a marker or a rising OOM kill count says the workspace ran out of memory. */
export function memoryExhausted(input: {
	incident?: MemoryIncident;
	oomKillAtStart?: number;
	oomKillAtFailure?: number;
}): boolean {
	if (input.incident !== undefined) return true;
	return (
		input.oomKillAtStart !== undefined &&
		input.oomKillAtFailure !== undefined &&
		input.oomKillAtFailure > input.oomKillAtStart
	);
}

/** Builds the probe a turn reads through. */
export function createMemoryIncidentProbe(input: {
	markerPath: string;
	ports: MemoryProbePorts;
	settleMs?: number;
}): MemoryExhaustionProbe {
	const settleMs = input.settleMs ?? MEMORY_INCIDENT_SETTLE_MS;

	const readIncident = async (): Promise<MemoryIncident | undefined> => {
		const text = await input.ports.readText(input.markerPath);
		if (text === null || text.length > MEMORY_INCIDENT_MAX_BYTES) return undefined;
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return undefined;
		}
		const incident = zMemoryIncident.safeParse(parsed);
		if (!incident.success) return undefined;
		const age = Math.abs(input.ports.now() - incident.data.occurredAtMs);
		return age <= MEMORY_INCIDENT_WINDOW_MS ? incident.data : undefined;
	};

	return {
		async oomKillCount() {
			const text = await input.ports.readText(OOM_KILL_PATH);
			return text === null ? undefined : parseOomKill(text);
		},
		async recentIncident() {
			const first = await readIncident();
			if (first === undefined || first.phase === "killed") return first;
			await input.ports.sleep(settleMs);
			const second = await readIncident();
			return second?.phase === "killed" ? second : undefined;
		},
	};
}
