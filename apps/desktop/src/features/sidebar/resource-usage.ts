/**
 * @feature APP-07 Resource usage table
 * Owns: the rules behind the Resources popover and its chip, as pure functions over the process
 * rows: which processes show, the chip's memory, the groups, the tree and flat sorts, the sort
 * header's directions, the summary, the number formats and the copied text.
 * Behaviour: ui-map.md 1.3. Conductor 0.92.1, renderApp: the view's starting state and sort
 * directions @10352212; groups @10353260; terminal filter, chip memory, tree and flat sorts,
 * copied text @5569383 to @5571346; number formats @5569343.
 * Must handle: a parent outside the list (its child is a root); a process whose workspace has left
 * the list (named by its folder, as Conductor names it by its id); ties (broken by the other
 * number, then by pid); an empty list (zero totals, no groups).
 * Our design choice: memory arrives in bytes and is shown in Conductor's units (1 KB is 1024
 * bytes). The copied line has no `cmd=`, because the Rust shell never returns command lines.
 * Test first: grouped, tree-sorted rows put App first, then each workspace by folder name, with a
 * child under its parent and siblings by the subtree's memory.
 */
import type { ProcessUsage } from "../../platform/platform.ts";

export type SortKey = "name" | "cpu" | "memory";
export type SortDirection = "asc" | "desc";

export interface SortState {
	sortKey: SortKey;
	sortDirection: SortDirection;
}

/** What the popover remembers while the app runs. */
export interface ResourceView extends SortState {
	/** The table grows from 220px to 60% of the window. */
	showAll: boolean;
	treeMode: boolean;
	groupByWorkspace: boolean;
	includeTerminals: boolean;
	/** Group names whose rows are hidden. */
	collapsedGroups: ReadonlySet<string>;
}

export const DEFAULT_VIEW: ResourceView = {
	sortKey: "memory",
	sortDirection: "desc",
	showAll: false,
	treeMode: true,
	groupByWorkspace: true,
	includeTerminals: false,
	collapsedGroups: new Set(),
};

/** The direction a column starts in when it is chosen. */
const FIRST_DIRECTION: Record<SortKey, SortDirection> = {
	name: "asc",
	cpu: "desc",
	memory: "desc",
};

/** "Show all (n)" appears once more processes than this are shown. */
export const SHOW_ALL_AFTER = 7;

/** The name of the group for processes in no workspace. */
export const APP_GROUP = "App";

/** Agents the chip leaves out, with everything they start, by label. */
const AGENT_LABELS = new Set(["Claude Code", "claude", "Codex", "codex", "node"]);

/** Choosing the sorted column flips it; another column starts in its own direction. */
export function nextSort(current: SortState, key: SortKey): SortState {
	if (key === current.sortKey) {
		return { sortKey: key, sortDirection: current.sortDirection === "asc" ? "desc" : "asc" };
	}
	return { sortKey: key, sortDirection: FIRST_DIRECTION[key] };
}

export function shownProcesses(
	processes: readonly ProcessUsage[],
	includeTerminals: boolean,
): ProcessUsage[] {
	return includeTerminals
		? [...processes]
		: processes.filter((row) => row.terminalId === undefined);
}

export function totals(processes: readonly ProcessUsage[]): {
	cpuPercent: number;
	memoryBytes: number;
} {
	let cpuPercent = 0;
	let memoryBytes = 0;
	for (const row of processes) {
		cpuPercent += row.cpuPercent;
		memoryBytes += row.memoryBytes;
	}
	return { cpuPercent, memoryBytes };
}

function childrenByParent(processes: readonly ProcessUsage[]): Map<number, ProcessUsage[]> {
	const children = new Map<number, ProcessUsage[]>();
	for (const row of processes) {
		const siblings = children.get(row.ppid);
		if (siblings === undefined) children.set(row.ppid, [row]);
		else siblings.push(row);
	}
	return children;
}

/**
 * The app's own memory, as the chip shows it: every process except terminals and agents, and
 * except anything those started.
 */
export function appMemoryBytes(processes: readonly ProcessUsage[]): number {
	const children = childrenByParent(processes);
	const left = new Set<number>();
	const queue = processes
		.filter((row) => row.terminalId !== undefined || AGENT_LABELS.has(row.label))
		.map((row) => row.pid);
	for (let pid = queue.pop(); pid !== undefined; pid = queue.pop()) {
		if (left.has(pid)) continue;
		left.add(pid);
		for (const child of children.get(pid) ?? []) queue.push(child.pid);
	}
	let memoryBytes = 0;
	for (const row of processes) if (!left.has(row.pid)) memoryBytes += row.memoryBytes;
	return memoryBytes;
}

export interface ProcessGroup {
	name: string;
	processes: ProcessUsage[];
}

const folderName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

/** App first (when it has processes), then one group per workspace, by folder name. */
export function groupProcesses(
	processes: readonly ProcessUsage[],
	workspaces: readonly { path: string; directoryName: string }[],
): ProcessGroup[] {
	const names = new Map(workspaces.map((workspace) => [workspace.path, workspace.directoryName]));
	const app: ProcessUsage[] = [];
	const byPath = new Map<string, ProcessUsage[]>();
	for (const row of processes) {
		if (row.workspacePath === undefined) {
			app.push(row);
			continue;
		}
		const rows = byPath.get(row.workspacePath);
		if (rows === undefined) byPath.set(row.workspacePath, [row]);
		else rows.push(row);
	}
	const workspaceGroups = [...byPath].map(([path, rows]) => ({
		name: names.get(path) ?? folderName(path),
		processes: rows,
	}));
	workspaceGroups.sort((left, right) => left.name.localeCompare(right.name));
	return app.length > 0
		? [{ name: APP_GROUP, processes: app }, ...workspaceGroups]
		: workspaceGroups;
}

/** Each process's own CPU first, then memory, then pid; or the reverse for memory. */
function compareNumbers(
	key: SortKey,
	direction: number,
	left: { cpu: number; memory: number },
	right: { cpu: number; memory: number },
): number {
	const cpu = direction * (left.cpu - right.cpu);
	const memory = direction * (left.memory - right.memory);
	return key === "cpu" ? cpu || memory : memory || cpu;
}

export function sortedFlat(
	processes: readonly ProcessUsage[],
	key: SortKey,
	direction: SortDirection,
): ProcessUsage[] {
	const sign = direction === "asc" ? 1 : -1;
	return [...processes].sort((left, right) => {
		const byKey =
			key === "name"
				? sign * left.label.localeCompare(right.label)
				: compareNumbers(
						key,
						sign,
						{ cpu: left.cpuPercent, memory: left.memoryBytes },
						{ cpu: right.cpuPercent, memory: right.memoryBytes },
					);
		return byKey || left.pid - right.pid;
	});
}

export interface TreeRow {
	process: ProcessUsage;
	/** 0 for a process whose parent is not in the list. */
	depth: number;
}

/**
 * Parents before their children. Siblings sort by their whole subtree's CPU or memory; each row
 * still shows its own numbers.
 */
export function sortedTree(
	processes: readonly ProcessUsage[],
	key: SortKey,
	direction: SortDirection,
): TreeRow[] {
	const listed = new Set(processes.map((row) => row.pid));
	const children = childrenByParent(processes);
	const subtree = new Map<number, { cpu: number; memory: number }>();
	const sumOf = (row: ProcessUsage): { cpu: number; memory: number } => {
		const known = subtree.get(row.pid);
		if (known !== undefined) return known;
		const sum = { cpu: row.cpuPercent, memory: row.memoryBytes };
		// Marked before the children are read, so a loop in the parent links cannot recurse forever.
		subtree.set(row.pid, sum);
		for (const child of children.get(row.pid) ?? []) {
			const below = sumOf(child);
			sum.cpu += below.cpu;
			sum.memory += below.memory;
		}
		return sum;
	};
	const sign = direction === "asc" ? 1 : -1;
	const order = (rows: readonly ProcessUsage[]): ProcessUsage[] =>
		[...rows].sort((left, right) => {
			const byKey =
				key === "name"
					? sign * left.label.localeCompare(right.label)
					: compareNumbers(key, sign, sumOf(left), sumOf(right));
			return byKey || left.pid - right.pid;
		});

	const rows: TreeRow[] = [];
	const placed = new Set<number>();
	const walk = (level: readonly ProcessUsage[], depth: number): void => {
		for (const row of order(level)) {
			if (placed.has(row.pid)) continue;
			placed.add(row.pid);
			rows.push({ process: row, depth });
			walk(children.get(row.pid) ?? [], depth + 1);
		}
	};
	walk(
		processes.filter((row) => !listed.has(row.ppid) || row.ppid === row.pid),
		0,
	);
	return rows;
}

export const formatCpu = (cpuPercent: number): string => `${cpuPercent.toFixed(1)}%`;

/** Conductor's memory format: whole KB, MB with one decimal, GB with two. */
export function formatMemory(memoryBytes: number): string {
	const kb = memoryBytes / 1024;
	if (kb < 1024) return `${kb.toFixed(0)} KB`;
	const mb = kb / 1024;
	return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

/** The text "Copy resource usage" puts on the clipboard, for processes in the order shown. */
export function usageText(
	processes: readonly ProcessUsage[],
	workspaces: readonly { path: string; directoryName: string }[],
): string {
	const names = new Map(workspaces.map((workspace) => [workspace.path, workspace.directoryName]));
	const sum = totals(processes);
	const lines = processes.map((row) => {
		const workspace =
			row.workspacePath === undefined
				? ""
				: ` ws=${names.get(row.workspacePath) ?? folderName(row.workspacePath)}`;
		return `${row.label} ${formatCpu(row.cpuPercent)} ${formatMemory(row.memoryBytes)} (pid=${row.pid} ppid=${row.ppid}${workspace})`;
	});
	return [
		`CPU ${formatCpu(sum.cpuPercent)} Memory ${formatMemory(sum.memoryBytes)}`,
		...lines,
	].join("\n");
}
