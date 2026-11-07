/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Tests the memory-exhaustion detection a turn uses: the OOM kill counter, the watchdog's incident
 * marker and Conductor's fixed message.
 */
import { describe, expect, test } from "bun:test";
import {
	createMemoryIncidentProbe,
	DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
	MEMORY_EXHAUSTED_MESSAGE,
	MEMORY_INCIDENT_SETTLE_MS,
	MEMORY_INCIDENT_WINDOW_MS,
	type MemoryProbePorts,
	memoryExhausted,
	OOM_KILL_PATH,
	parseOomKill,
} from "./memory-exhaustion.ts";

function ports(
	options: { vmstat?: string; marker?: () => string | null; now?: number; slept?: number[] } = {},
): MemoryProbePorts {
	return {
		async readText(path) {
			if (path === OOM_KILL_PATH) return options.vmstat ?? null;
			if (path === DEFAULT_MEMORY_INCIDENT_MARKER_PATH) return options.marker?.() ?? null;
			return null;
		},
		now: () => options.now ?? 1_000_000,
		async sleep(ms) {
			options.slept?.push(ms);
		},
	};
}

const incident = (overrides: Partial<Record<string, unknown>> = {}): string =>
	JSON.stringify({
		kind: "workspace_memory_exhausted",
		occurredAtMs: 1_000_000,
		trigger: "crash",
		phase: "killed",
		...overrides,
	});

describe("CLOUD-04 memory exhaustion", () => {
	test("CLOUD-04 reads the oom_kill count from /proc/vmstat", () => {
		expect(parseOomKill("nr_free_pages 1\noom_kill 7\npgalloc_normal 2\n")).toBe(7);
		expect(parseOomKill("nr_free_pages 1\n")).toBeUndefined();
	});

	test("CLOUD-04 an incident marker within 30 seconds names an exhausted workspace", async () => {
		const probe = createMemoryIncidentProbe({
			markerPath: DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
			ports: ports({ marker: () => incident() }),
		});

		expect(await probe.recentIncident()).toEqual({
			kind: "workspace_memory_exhausted",
			occurredAtMs: 1_000_000,
			trigger: "crash",
			phase: "killed",
		});
	});

	test("CLOUD-04 an old, malformed or oversized marker is not an incident", async () => {
		const old = createMemoryIncidentProbe({
			markerPath: DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
			ports: ports({
				marker: () => incident({ occurredAtMs: 1_000_000 - MEMORY_INCIDENT_WINDOW_MS - 1 }),
				now: 1_000_000,
			}),
		});
		expect(await old.recentIncident()).toBeUndefined();

		const malformed = createMemoryIncidentProbe({
			markerPath: DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
			ports: ports({ marker: () => "{ not json" }),
		});
		expect(await malformed.recentIncident()).toBeUndefined();

		const oversized = createMemoryIncidentProbe({
			markerPath: DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
			ports: ports({ marker: () => "x".repeat(5000) }),
		});
		expect(await oversized.recentIncident()).toBeUndefined();
	});

	test("CLOUD-04 a sweeping marker becomes an incident only after it turns killed", async () => {
		let reads = 0;
		const slept: number[] = [];
		const becomesKilled = createMemoryIncidentProbe({
			markerPath: DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
			ports: ports({
				marker: () => (reads++ === 0 ? incident({ phase: "sweeping" }) : incident()),
				slept,
			}),
		});

		expect((await becomesKilled.recentIncident())?.phase).toBe("killed");
		expect(slept).toEqual([MEMORY_INCIDENT_SETTLE_MS]);

		const staysSweeping = createMemoryIncidentProbe({
			markerPath: DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
			ports: ports({ marker: () => incident({ phase: "sweeping" }) }),
		});
		expect(await staysSweeping.recentIncident()).toBeUndefined();
	});

	test("CLOUD-04 the OOM kill counter is read through the same probe", async () => {
		const probe = createMemoryIncidentProbe({
			markerPath: DEFAULT_MEMORY_INCIDENT_MARKER_PATH,
			ports: ports({ vmstat: "oom_kill 12\n" }),
		});

		expect(await probe.oomKillCount()).toBe(12);
	});

	test("CLOUD-04 a marker or a rising oom_kill count means exhausted", () => {
		const marker = {
			kind: "workspace_memory_exhausted" as const,
			occurredAtMs: 1,
			trigger: "crash" as const,
			phase: "killed" as const,
		};
		expect(memoryExhausted({ incident: marker })).toBe(true);
		expect(memoryExhausted({ oomKillAtStart: 3, oomKillAtFailure: 4 })).toBe(true);
		expect(memoryExhausted({ oomKillAtStart: 3, oomKillAtFailure: 3 })).toBe(false);
		expect(memoryExhausted({ oomKillAtStart: 3 })).toBe(false);
		expect(memoryExhausted({})).toBe(false);
	});

	test("CLOUD-04 the message is Conductor's exact wording", () => {
		expect(MEMORY_EXHAUSTED_MESSAGE).toMatch(
			/^Workspace ran out of memory, so agents and running commands were stopped\. Retry, or move memory-heavy work to a separate workspace\.$/,
		);
	});
});
