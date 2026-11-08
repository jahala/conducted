/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Owns: the reading of the Worker's `GET /w/<name>/state` answer into the status and resources the
 * header shows, and the status word a running flag means.
 * Behaviour: ui-map.md 3.1 (a cloud workspace's header shows its status, CPU, memory and disk).
 * The Worker's route is CLOUD-03's; this reads what it promises (`apps/cloud/src/workspace.ts`,
 * WorkspaceState). Conductor reads the same values from its hosted backend's `remoteState.resources`;
 * ours come from the sandbox itself (D116).
 * Must handle: a stopped workspace (no resources); a missing or malformed reading (that one value
 * is null, the rest of the state is still read); an answer that is not an object or has no running
 * flag (null, so the caller shows its own error).
 * Our design choice: each resource is checked on its own, so a Worker that upgrades one reading
 * does not hide the others.
 * Test first: a running workspace's resources are read, and a malformed reading is refused.
 */

export interface CloudCpuReading {
	/** The instance's CPU limit in cores. Null when the Worker does not know it. */
	capacityCores: number | null;
	/** The share of the limit in use. Null for the first reading after a start. */
	usedPercent: number | null;
}

export interface CloudMemoryReading {
	totalBytes: number;
	usedPercent: number;
}

export interface CloudDiskReading {
	totalBytes: number;
	availableBytes: number;
	usedPercent: number;
}

/** What the header meters. A reading the sandbox cannot give is null. */
export interface CloudWorkspaceResources {
	cpu: CloudCpuReading | null;
	memory: CloudMemoryReading | null;
	disk: CloudDiskReading | null;
}

export interface CloudWorkspaceState {
	running: boolean;
	resources: CloudWorkspaceResources | null;
}

/** A finite, non-negative number, or null. */
function count(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function optionalCount(value: unknown): number | null | "invalid" {
	if (value === null || value === undefined) return null;
	const parsed = count(value);
	return parsed === null ? "invalid" : parsed;
}

function cpuOf(value: unknown): CloudCpuReading | null {
	const cpu = record(value);
	if (cpu === null) return null;
	const capacityCores = optionalCount(cpu.capacityCores);
	const usedPercent = optionalCount(cpu.usedPercent);
	if (capacityCores === "invalid" || usedPercent === "invalid") return null;
	if (capacityCores === null && usedPercent === null) return null;
	return { capacityCores, usedPercent };
}

function memoryOf(value: unknown): CloudMemoryReading | null {
	const memory = record(value);
	if (memory === null) return null;
	const totalBytes = count(memory.totalBytes);
	const usedPercent = count(memory.usedPercent);
	return totalBytes === null || usedPercent === null ? null : { totalBytes, usedPercent };
}

function diskOf(value: unknown): CloudDiskReading | null {
	const disk = record(value);
	if (disk === null) return null;
	const totalBytes = count(disk.totalBytes);
	const availableBytes = count(disk.availableBytes);
	const usedPercent = count(disk.usedPercent);
	return totalBytes === null || availableBytes === null || usedPercent === null
		? null
		: { totalBytes, availableBytes, usedPercent };
}

function resourcesOf(value: unknown): CloudWorkspaceResources | null {
	const resources = record(value);
	if (resources === null) return null;
	return {
		cpu: cpuOf(resources.cpu),
		memory: memoryOf(resources.memory),
		disk: diskOf(resources.disk),
	};
}

/** The Worker's state answer, or null when it is not one. */
export function parseCloudWorkspaceState(value: unknown): CloudWorkspaceState | null {
	const state = record(value);
	if (state === null || typeof state.running !== "boolean") return null;
	return {
		running: state.running,
		resources: state.resources === null ? null : resourcesOf(state.resources),
	};
}

/** The status word a running flag means: Conductor says "Running" or "Stopped". */
export function statusOfCloudState(state: CloudWorkspaceState): "running" | "stopped" {
	return state.running ? "running" : "stopped";
}
