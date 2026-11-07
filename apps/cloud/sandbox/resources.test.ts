/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Tests the readings the sandbox entry sends for the header: core capacity from `cpu.max`, CPU
 * use from two `cpu.stat` samples, memory from the cgroup with `/proc/meminfo` as the fallback,
 * and disk from `statfs`. The fixtures are the files' real text, so a change to the paths or
 * their shape is caught here rather than by a live run.
 * Test first: two CPU samples a second apart report the used share of the instance's cores.
 */
import { describe, expect, it } from "vitest";
import {
	cpuUsedPercent,
	parseCpuMax,
	parseMemTotalBytes,
	parseUsageUsec,
	resourcesFrom,
	sizeFromStatfs,
} from "./resources.ts";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

describe("CLOUD-15 sandbox resources", () => {
	it("reads the instance's cores from cpu.max", () => {
		expect(parseCpuMax("25000 100000")).toBe(0.25);
		expect(parseCpuMax("50000 100000")).toBe(0.5);
		expect(parseCpuMax("100000 100000")).toBe(1);
		expect(parseCpuMax("max 100000")).toBeNull();
		expect(parseCpuMax("")).toBeNull();
	});

	it("reports CPU use as a share of the instance's cores between two samples", () => {
		// 0.1 core-seconds used in one second is 0.1 of a core; the instance has 0.25 of a core.
		expect(cpuUsedPercent({ usageUsec: 0, at: 0 }, 100_000, 1_000, 0.25)).toBe(40);
		// The first sample has no earlier reading to compare with.
		expect(cpuUsedPercent(null, 100_000, 1_000, 0.25)).toBeNull();
		// A share over the instance's own limit is clamped, never shown above 100%.
		expect(cpuUsedPercent({ usageUsec: 0, at: 0 }, 2_000_000, 1_000, 0.25)).toBe(100);
	});

	it("reads memory from the cgroup, and its total from memory.max", () => {
		const reading = resourcesFrom({
			cpuMax: "25000 100000",
			cpuStat: "usage_usec 0\n",
			memoryMax: String(GIB),
			memoryCurrent: String(GIB / 4),
			meminfo: "",
			disk: null,
			now: 0,
			previous: null,
		});
		expect(reading.resources.memory).toEqual({ totalBytes: GIB, usedPercent: 25 });
	});

	it("falls back to /proc/meminfo when memory.max is unlimited", () => {
		expect(parseMemTotalBytes("MemTotal:       1048576 kB\nMemFree: 1 kB\n")).toBe(GIB);
		const reading = resourcesFrom({
			cpuMax: "",
			cpuStat: "",
			memoryMax: "max",
			memoryCurrent: String(MIB),
			meminfo: "MemTotal:       1048576 kB\n",
			disk: null,
			now: 0,
			previous: null,
		});
		expect(reading.resources.memory?.totalBytes).toBe(GIB);
		expect(reading.resources.memory?.usedPercent).toBeCloseTo(0.0977, 4);
	});

	it("reads disk from statfs, with the space the sandbox may use", () => {
		const disk = sizeFromStatfs({ bsize: 4096, blocks: 1_048_576, bavail: 131_072 });
		expect(disk).toEqual({
			totalBytes: 4 * GIB,
			availableBytes: 512 * MIB,
			usedPercent: 87.5,
		});
	});

	it("answers null for a reading the sandbox cannot give", () => {
		const reading = resourcesFrom({
			cpuMax: "",
			cpuStat: "",
			memoryMax: "",
			memoryCurrent: "",
			meminfo: "",
			disk: null,
			now: 0,
			previous: null,
		});
		expect(reading.resources).toEqual({ cpu: null, memory: null, disk: null });
		expect(reading.cpuSample).toBeNull();
	});

	it("keeps the new CPU sample for the next reading", () => {
		const reading = resourcesFrom({
			cpuMax: "25000 100000",
			cpuStat: "usage_usec 250000\n",
			memoryMax: "",
			memoryCurrent: "",
			meminfo: "",
			disk: null,
			now: 5_000,
			previous: null,
		});
		expect(parseUsageUsec("usage_usec 250000\n")).toBe(250_000);
		expect(reading.cpuSample).toEqual({ usageUsec: 250_000, at: 5_000 });
		expect(reading.resources.cpu).toEqual({ capacityCores: 0.25, usedPercent: null });
	});
});
