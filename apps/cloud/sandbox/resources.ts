/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Owns: the CPU, memory and disk readings the sandbox entry answers at `GET /resources`, from the
 * container's own cgroup files and `statfs`. The Worker's `state` route carries them to the app.
 * Behaviour: ui-map.md 3.1 (the cloud header shows CPU, memory and disk, with "Low disk" when the
 * space left is small). The numbers come from the running container itself, not from a hosted
 * service; Conductor's own values arrive in its backend's `remoteState.resources`, which is not in
 * the research (D002, D116).
 * Must handle: a cgroup that does not name a limit ("max"); a missing file (that reading is null,
 * never zero); the first CPU reading (no earlier sample, so no percentage); a memory total missing
 * from the cgroup (fall back to `/proc/meminfo`); a zero-size disk (no division).
 * Our design choice: CPU capacity is `cpu.max`'s quota over its period, so the instance type does
 * not have to be copied into this file. CPU use is the `usage_usec` delta over the wall-clock
 * delta, as the CLOUD-02 spike measured (`docs/research/cloud-spike-2026-11-06.md`, "Costs").
 * Test first: two CPU samples a second apart report the used share of the instance's cores.
 */

/** One `cpu.stat` reading, kept so the next call can report a share over the interval. */
export interface CpuSample {
	usageUsec: number;
	at: number;
}

export interface CpuResources {
	/** The instance's CPU limit in cores, from `cpu.max`. Null when it is unlimited or unread. */
	capacityCores: number | null;
	/** The share of the limit used since the previous reading. Null for the first reading. */
	usedPercent: number | null;
}

export interface MemoryResources {
	totalBytes: number;
	usedPercent: number;
}

export interface DiskResources {
	totalBytes: number;
	availableBytes: number;
	usedPercent: number;
}

/** What the header shows for one running sandbox. A reading the container cannot give is null. */
export interface SandboxResources {
	cpu: CpuResources | null;
	memory: MemoryResources | null;
	disk: DiskResources | null;
}

/** The files and the clock one reading is built from. */
export interface ResourceInputs {
	/** `/sys/fs/cgroup/cpu.max`: "<quota> <period>" or "max <period>". */
	cpuMax: string;
	/** `/sys/fs/cgroup/cpu.stat`: one "name value" pair per line. */
	cpuStat: string;
	/** `/sys/fs/cgroup/memory.max`: bytes, or "max". */
	memoryMax: string;
	/** `/sys/fs/cgroup/memory.current`: bytes. */
	memoryCurrent: string;
	/** `/proc/meminfo`, for a host memory total when the cgroup does not name one. */
	meminfo: string;
	/** `statfs("/workspace")`. */
	disk: { bsize: number; blocks: number; bavail: number } | null;
	/** Milliseconds since the epoch at this reading. */
	now: number;
	/** The previous CPU reading, or null for the first. */
	previous: CpuSample | null;
}

export interface ResourceReading {
	resources: SandboxResources;
	/** The sample to pass as `previous` next time. */
	cpuSample: CpuSample | null;
}

/** An unsigned integer in a cgroup file, or null. */
function integerOf(text: string): number | null {
	const trimmed = text.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return Number.isSafeInteger(value) ? value : null;
}

/** The instance's cores from `cpu.max`, or null when it is unlimited or unread. */
export function parseCpuMax(text: string): number | null {
	const [rawQuota, rawPeriod] = text.trim().split(/\s+/);
	if (rawQuota === undefined || rawPeriod === undefined || rawQuota === "max") return null;
	const quota = integerOf(rawQuota);
	const period = integerOf(rawPeriod);
	if (quota === null || period === null || quota <= 0 || period <= 0) return null;
	return quota / period;
}

/** The `usage_usec` value in `cpu.stat`, or null when the file has no such line. */
export function parseUsageUsec(text: string): number | null {
	for (const line of text.split("\n")) {
		const [name, value] = line.trim().split(/\s+/);
		if (name === "usage_usec" && value !== undefined) return integerOf(value);
	}
	return null;
}

/** The `MemTotal` in `/proc/meminfo`, in bytes (the file counts kibibytes). */
export function parseMemTotalBytes(text: string): number | null {
	for (const line of text.split("\n")) {
		const match = /^MemTotal:\s*(\d+)\s*kB$/i.exec(line.trim());
		if (match?.[1] !== undefined) {
			const kibibytes = Number(match[1]);
			return Number.isSafeInteger(kibibytes) ? kibibytes * 1024 : null;
		}
	}
	return null;
}

/** The memory total the cgroup names, then `/proc/meminfo`, or null. */
export function memoryTotal(memoryMax: string, meminfo: string): number | null {
	if (!/^\d+$/.test(memoryMax.trim())) return parseMemTotalBytes(meminfo);
	const bytes = integerOf(memoryMax);
	return bytes !== null && bytes > 0 ? bytes : parseMemTotalBytes(meminfo);
}

/** The CPU share since the previous sample, as a percentage of the instance's cores. */
export function cpuUsedPercent(
	previous: CpuSample | null,
	usageUsec: number,
	now: number,
	capacityCores: number | null,
): number | null {
	if (previous === null) return null;
	const elapsedMs = now - previous.at;
	const usedUsec = usageUsec - previous.usageUsec;
	if (elapsedMs <= 0 || usedUsec < 0) return null;
	const usedCores = usedUsec / 1000 / elapsedMs;
	const share =
		capacityCores === null || capacityCores <= 0
			? usedCores * 100
			: (usedCores / capacityCores) * 100;
	return Math.min(100, Math.max(0, share));
}

/** Disk use from a `statfs` answer, in bytes. */
export function sizeFromStatfs(stat: {
	bsize: number;
	blocks: number;
	bavail: number;
}): DiskResources {
	const totalBytes = Math.max(0, stat.bsize * stat.blocks);
	const availableBytes = Math.min(totalBytes, Math.max(0, stat.bsize * stat.bavail));
	const usedPercent =
		totalBytes === 0 ? 0 : Math.min(100, ((totalBytes - availableBytes) / totalBytes) * 100);
	return { totalBytes, availableBytes, usedPercent };
}

/** Builds one reading, and the CPU sample the next reading compares against. */
export function resourcesFrom(inputs: ResourceInputs): ResourceReading {
	const capacityCores = parseCpuMax(inputs.cpuMax);
	const usageUsec = parseUsageUsec(inputs.cpuStat);
	const cpuSample = usageUsec === null ? null : { usageUsec, at: inputs.now };
	const cpu =
		cpuSample === null
			? null
			: {
					capacityCores,
					usedPercent: cpuUsedPercent(
						inputs.previous,
						cpuSample.usageUsec,
						cpuSample.at,
						capacityCores,
					),
				};

	const totalBytes = memoryTotal(inputs.memoryMax, inputs.meminfo);
	const current = integerOf(inputs.memoryCurrent);
	const memory =
		totalBytes === null || current === null
			? null
			: {
					totalBytes,
					usedPercent:
						totalBytes === 0 ? 0 : Math.min(100, Math.max(0, (current / totalBytes) * 100)),
				};

	return {
		resources: {
			cpu,
			memory,
			disk: inputs.disk === null ? null : sizeFromStatfs(inputs.disk),
		},
		cpuSample,
	};
}
