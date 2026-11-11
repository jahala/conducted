/**
 * @feature APP-07 Resource usage table
 * Owns: tests for the rules behind the Resources popover: the chip's memory, the terminal filter,
 * the groups, the tree and flat sorts, the sort header's directions, the summary, the number
 * formats and the copied text.
 * Behaviour: ui-map.md 1.3 (Conductor's popover, renderApp @10350785 to @10368072 and @5568938 to
 * @5571346).
 * Test first: grouped, tree-sorted rows put App first, then each workspace by folder name, with a
 * child under its parent and siblings by the subtree's memory.
 */
import { describe, expect, it } from "vitest";
import type { ProcessUsage } from "../../platform/platform.ts";
import {
	appMemoryBytes,
	DEFAULT_VIEW,
	formatCpu,
	formatMemory,
	groupProcesses,
	nextSort,
	shownProcesses,
	sortedFlat,
	sortedTree,
	totals,
	usageText,
} from "./resource-usage.ts";

const KB = 1024;
const MB = 1024 * KB;

const proc = (
	pid: number,
	ppid: number,
	label: string,
	cpuPercent: number,
	memoryBytes: number,
	extra: Partial<ProcessUsage> = {},
): ProcessUsage => ({ pid, ppid, label, cpuPercent, memoryBytes, ...extra });

// Made-up processes shaped like the owner's screenshot of Conductor.
const main = proc(100, 1, "Main", 3, 189 * MB);
const renderer = proc(200, 1, "Renderer", 10.1, 1040 * MB);
const networking = proc(300, 1, "Networking", 0, 9 * MB);
const sidecar = proc(101, 100, "Sidecar", 0, 133 * MB);
const claude = proc(102, 101, "claude", 4, 400 * MB, { workspacePath: "/w/oslo" });
const mcp = proc(103, 102, "node", 0.5, 60 * MB, { workspacePath: "/w/oslo" });
const zsh = proc(104, 100, "zsh", 0, 5 * MB, { workspacePath: "/w/athens", terminalId: "t1" });
const vite = proc(105, 104, "node", 2, 90 * MB, { workspacePath: "/w/athens", terminalId: "t1" });
const all = [main, renderer, networking, sidecar, claude, mcp, zsh, vite];
const workspaces = [
	{ path: "/w/oslo", directoryName: "oslo" },
	{ path: "/w/athens", directoryName: "athens" },
];

const labels = (rows: readonly { process: ProcessUsage }[]) => rows.map((row) => row.process.label);

describe("APP-07 resource usage rules", () => {
	it("starts sorted by memory, high first, as a grouped tree without terminals", () => {
		expect(DEFAULT_VIEW).toEqual({
			sortKey: "memory",
			sortDirection: "desc",
			showAll: false,
			treeMode: true,
			groupByWorkspace: true,
			includeTerminals: false,
			collapsedGroups: new Set(),
		});
	});

	it("leaves out a terminal's processes unless they are included", () => {
		expect(shownProcesses(all, false).map((row) => row.pid)).toEqual([
			100, 200, 300, 101, 102, 103,
		]);
		expect(shownProcesses(all, true)).toHaveLength(8);
	});

	it("groups App first, then each workspace by folder name", () => {
		const groups = groupProcesses(all, workspaces);
		expect(groups.map((group) => group.name)).toEqual(["App", "athens", "oslo"]);
		expect(groups[0]?.processes.map((row) => row.label)).toEqual([
			"Main",
			"Renderer",
			"Networking",
			"Sidecar",
		]);
		expect(groups[2]?.processes.map((row) => row.pid)).toEqual([102, 103]);
	});

	it("names a workspace missing from the list by its folder", () => {
		const groups = groupProcesses([claude], []);
		expect(groups.map((group) => group.name)).toEqual(["oslo"]);
	});

	it("nests a child under its parent and orders siblings by the subtree's memory", () => {
		const app = groupProcesses(all, workspaces)[0]?.processes ?? [];
		const rows = sortedTree(app, "memory", "desc");
		// Renderer (1040 MB) beats Main, whose subtree is 189 + 133 MB; Networking comes last.
		expect(labels(rows)).toEqual(["Renderer", "Main", "Sidecar", "Networking"]);
		expect(rows.map((row) => row.depth)).toEqual([0, 0, 1, 0]);
		// A row shows its own numbers, not its subtree's.
		expect(rows[1]?.process.memoryBytes).toBe(189 * MB);
		// GPU alone (250 MB) holds more than Main alone (189 MB), but less than Main with Sidecar.
		const gpu = proc(400, 1, "GPU", 0, 250 * MB);
		expect(labels(sortedTree([gpu, main, sidecar], "memory", "desc"))).toEqual([
			"Main",
			"Sidecar",
			"GPU",
		]);
	});

	it("sorts the tree by CPU with memory breaking ties, and by name from A", () => {
		const app = [main, renderer, networking, sidecar];
		expect(labels(sortedTree(app, "cpu", "desc"))).toEqual([
			"Renderer",
			"Main",
			"Sidecar",
			"Networking",
		]);
		expect(labels(sortedTree(app, "name", "asc"))).toEqual([
			"Main",
			"Sidecar",
			"Networking",
			"Renderer",
		]);
	});

	it("sorts the flat list by each process's own numbers", () => {
		expect(sortedFlat([main, renderer, sidecar], "memory", "desc").map((row) => row.label)).toEqual(
			["Renderer", "Main", "Sidecar"],
		);
		expect(sortedFlat([main, renderer, sidecar], "memory", "asc").map((row) => row.label)).toEqual([
			"Sidecar",
			"Main",
			"Renderer",
		]);
		const tie = [proc(9, 0, "b", 1, MB), proc(8, 0, "a", 1, MB)];
		expect(sortedFlat(tie, "cpu", "desc").map((row) => row.pid)).toEqual([8, 9]);
	});

	it("flips the direction of the sorted column and starts a new column at its own default", () => {
		const byMemory = { sortKey: "memory", sortDirection: "desc" } as const;
		expect(nextSort(byMemory, "memory")).toEqual({ sortKey: "memory", sortDirection: "asc" });
		expect(nextSort(byMemory, "name")).toEqual({ sortKey: "name", sortDirection: "asc" });
		expect(nextSort(byMemory, "cpu")).toEqual({ sortKey: "cpu", sortDirection: "desc" });
	});

	it("sums CPU and memory over the shown processes", () => {
		const sum = totals([main, renderer]);
		expect(sum.cpuPercent).toBeCloseTo(13.1);
		expect(sum.memoryBytes).toBe(1229 * MB);
	});

	it("counts the app's own memory without terminals or agents and what they started", () => {
		// claude and the node it started, and the terminal's zsh and its node, are left out.
		expect(appMemoryBytes(all)).toBe((189 + 1040 + 9 + 133) * MB);
		const codex = proc(110, 101, "Codex", 0, 50 * MB);
		const helper = proc(111, 110, "rg", 0, 7 * MB);
		expect(appMemoryBytes([main, codex, helper])).toBe(189 * MB);
	});

	it("writes CPU with one decimal and memory in KB, MB or GB", () => {
		expect(formatCpu(518.62)).toBe("518.6%");
		expect(formatMemory(2 * KB)).toBe("2 KB");
		expect(formatMemory(1023 * KB)).toBe("1023 KB");
		expect(formatMemory(189 * MB)).toBe("189.0 MB");
		expect(formatMemory(1.41 * 1024 * MB)).toBe("1.41 GB");
	});

	it("copies the summary, then one line per process with its pid, parent and workspace", () => {
		const text = usageText([renderer, main, claude], workspaces);
		expect(text.split("\n")).toEqual([
			"CPU 17.1% Memory 1.59 GB",
			"Renderer 10.1% 1.02 GB (pid=200 ppid=1)",
			"Main 3.0% 189.0 MB (pid=100 ppid=1)",
			"claude 4.0% 400.0 MB (pid=102 ppid=101 ws=oslo)",
		]);
	});
});
