/**
 * @feature APP-07 Resource usage table
 * Owns: The table of CPU and memory per process, grouped by workspace, in a popover under the
 * memory chip in the sidebar's top strip. It also writes a log line for a process over the memory
 * threshold.
 * Behaviour: ui-map.md 1.3 and 4 item 8 ('Resources' table: Name, CPU, Mem; rows grouped by
 * workspace, sortable, 'Copy resource usage'; shown by the setting 'Show sidebar resource usage'),
 * 5.2 (Popover: Resources).
 * Data: `platform.app.resourceUsage` (PLAT-14), the setting `sidebar_resource_usage`, and
 * `useWorkspaces` for the group names.
 * Measured from Conductor 0.92.1 (renderApp @10365848, @10538807): the trigger is a chip in the
 * sidebar's top strip, beside Go back and Go forward: a 12px drive icon and the total memory in 11px
 * tabular figures, a 1px border and 6px radius, named "Resource usage: <total>"; the table opens
 * under it. (Its setting text says "sidebar footer"; the code mounts it in the top strip.)
 * Our design choice: while the first reading loads the chip shows its icon only. The
 * table sorts by CPU first, then by Name, CPU or Mem when a header is chosen. A process with no
 * workspace goes under "Other". The high-memory log line runs while the sidebar is mounted, even
 * with the table hidden, because the research puts that logger in the app's startup.
 * Must handle: Setting off (renders nothing); no data yet (skeleton rows); the platform cannot read
 * usage (one line saying so); sorting by a column; a process that exits between polls disappears on
 * the next poll; copy puts plain text in the clipboard.
 * Test first: With the setting on and two workspaces' processes, rows are grouped by workspace and
 * sorted by memory when that header is chosen.
 */
import { appError, err, type Result } from "@conducted/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Loadable } from "../../core/api.ts";
import { createLatestWins } from "../../core/async/latest-wins.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useSetting, useWorkspaces } from "../../core/hooks.ts";
import type { Workspace } from "../../core/model.ts";
import type { ProcessUsage } from "../../platform/platform.ts";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { DatabaseIcon } from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../ui/Table.tsx";
import { formatFileSize } from "../file-viewer/preview/PreviewUnavailable.tsx";
import { workspaceName } from "../workspace/workspace-name.ts";

/** How often the process table is read while the sidebar is mounted. */
const POLL_INTERVAL_MS = 5_000;

/** A process at or above this resident size gets a log line. Our dial. */
const HEAVY_MEMORY_BYTES = 512 * 1024 * 1024;

type SortKey = "name" | "cpu" | "memory";
type SortDirection = "asc" | "desc";

interface SortState {
	key: SortKey;
	direction: SortDirection;
}

interface UsageGroup {
	path: string | null;
	label: string;
	rows: ProcessUsage[];
}

export interface ResourceUsageTableProps {
	/** How often usage is read, in milliseconds. Zero reads once. */
	pollIntervalMs?: number;
}

const EMPTY_WORKSPACES: readonly Workspace[] = [];

const folderName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

const compareRows = (left: ProcessUsage, right: ProcessUsage, key: SortKey): number => {
	const byKey =
		key === "name"
			? left.name.localeCompare(right.name)
			: key === "cpu"
				? left.cpuPercent - right.cpuPercent
				: left.memoryBytes - right.memoryBytes;
	return byKey !== 0 ? byKey : left.pid - right.pid;
};

const sortedRows = (rows: readonly ProcessUsage[], sort: SortState): ProcessUsage[] => {
	const direction = sort.direction === "asc" ? 1 : -1;
	return [...rows].sort((left, right) => compareRows(left, right, sort.key) * direction);
};

/** One group per workspace with a process, in workspace order, then "Other". */
function groupRows(
	processes: readonly ProcessUsage[],
	workspaces: readonly Workspace[],
	sort: SortState,
): UsageGroup[] {
	const labels = new Map<string, string>();
	const order: string[] = [];
	for (const workspace of workspaces) {
		labels.set(workspace.path, workspaceName(workspace));
		order.push(workspace.path);
	}

	const byPath = new Map<string, ProcessUsage[]>();
	const ungrouped: ProcessUsage[] = [];
	for (const process of processes) {
		const path = process.workspacePath;
		if (path === undefined) {
			ungrouped.push(process);
			continue;
		}
		const rows = byPath.get(path);
		if (rows === undefined) byPath.set(path, [process]);
		else rows.push(process);
	}

	const groups: UsageGroup[] = [];
	const seen = new Set<string>();
	for (const path of order) {
		if (seen.has(path)) continue;
		seen.add(path);
		const rows = byPath.get(path);
		if (rows === undefined) continue;
		groups.push({
			path,
			label: labels.get(path) ?? folderName(path),
			rows: sortedRows(rows, sort),
		});
	}
	for (const [path, rows] of byPath) {
		if (seen.has(path)) continue;
		groups.push({
			path,
			label: labels.get(path) ?? folderName(path),
			rows: sortedRows(rows, sort),
		});
	}
	if (ungrouped.length > 0) {
		groups.push({ path: null, label: "Other", rows: sortedRows(ungrouped, sort) });
	}
	return groups;
}

const cpuText = (cpuPercent: number): string => `${cpuPercent.toFixed(1)}%`;

const memoryText = (memoryBytes: number): string => formatFileSize(memoryBytes);

/** The table as plain text, for the clipboard. */
function usageText(groups: readonly UsageGroup[]): string {
	const lines = ["Resources", ["Name", "CPU", "Mem"].join("\t")];
	for (const group of groups) {
		lines.push("", group.label);
		for (const row of group.rows) {
			lines.push([row.name, cpuText(row.cpuPercent), memoryText(row.memoryBytes)].join("\t"));
		}
	}
	return lines.join("\n");
}

function logHeavyProcesses(
	writeLog: (level: "warn", message: string, data: unknown) => void,
	processes: readonly ProcessUsage[],
): void {
	for (const process of processes) {
		if (process.memoryBytes < HEAVY_MEMORY_BYTES) continue;
		writeLog(
			"warn",
			`High memory: ${process.name} (pid ${process.pid}) is using ${memoryText(process.memoryBytes)}`,
			{
				pid: process.pid,
				name: process.name,
				memoryBytes: process.memoryBytes,
				cpuPercent: process.cpuPercent,
				workspacePath: process.workspacePath ?? null,
			},
		);
	}
}

function SortHead({
	label,
	ariaLabel,
	sortKey,
	sort,
	onSort,
}: {
	label: string;
	ariaLabel: string;
	sortKey: SortKey;
	sort: SortState;
	onSort: (key: SortKey) => void;
}) {
	const active = sort.key === sortKey;
	return (
		<TableHead
			aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
		>
			<button
				type="button"
				aria-label={ariaLabel}
				onClick={() => onSort(sortKey)}
				className="flex items-center gap-1 font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
			>
				{label}
				{active ? <span aria-hidden="true">{sort.direction === "asc" ? "↑" : "↓"}</span> : null}
			</button>
		</TableHead>
	);
}

export function ResourceUsageTable({ pollIntervalMs = POLL_INTERVAL_MS }: ResourceUsageTableProps) {
	const { platform } = useServices();
	const actions = useActions();
	const workspaces = useWorkspaces();
	const enabled = useSetting<boolean>("sidebar_resource_usage");
	const [usage, setUsage] = useState<Loadable<ProcessUsage[]>>({ state: "loading" });
	const [sort, setSort] = useState<SortState>({ key: "cpu", direction: "desc" });

	const workspaceRows = workspaces.state === "ready" ? workspaces.data : EMPTY_WORKSPACES;
	const pathKey = workspaceRows.map((workspace) => workspace.path).join("\n");

	useEffect(() => {
		const paths = pathKey === "" ? [] : pathKey.split("\n");
		const latest = createLatestWins();
		let active = true;
		let timer: ReturnType<typeof setInterval> | null = null;

		const poll = async () => {
			const ticket = latest.begin("usage");
			let result: Result<ProcessUsage[]>;
			try {
				result = await platform.app.resourceUsage(paths);
			} catch (cause) {
				result = err(appError("resource_usage_failed", "The processes could not be read.", cause));
			}
			if (!active || !latest.isLatest(ticket)) return;
			latest.settle(ticket);
			if (!result.ok) {
				setUsage({ state: "error", error: result.error });
				return;
			}
			setUsage({ state: "ready", data: result.value });
			logHeavyProcesses(
				(level, message, data) => platform.app.writeLog(level, message, data),
				result.value,
			);
		};

		void poll();
		if (pollIntervalMs > 0) timer = setInterval(() => void poll(), pollIntervalMs);

		return () => {
			active = false;
			latest.invalidate("usage");
			if (timer !== null) clearInterval(timer);
		};
	}, [platform, pathKey, pollIntervalMs]);

	const groups = useMemo(
		() => (usage.state === "ready" ? groupRows(usage.data, workspaceRows, sort) : []),
		[usage, workspaceRows, sort],
	);

	const chooseSort = useCallback((key: SortKey) => {
		setSort((current) =>
			current.key === key
				? { key, direction: current.direction === "asc" ? "desc" : "asc" }
				: { key, direction: key === "name" ? "asc" : "desc" },
		);
	}, []);

	if (!enabled) return null;

	const total =
		usage.state === "ready"
			? memoryText(usage.data.reduce((sum, row) => sum + row.memoryBytes, 0))
			: null;

	return (
		<Popover
			side="bottom"
			align="start"
			className="w-96"
			trigger={
				<button
					type="button"
					aria-label={total === null ? "Resource usage" : `Resource usage: ${total}`}
					className="flex h-6 items-center gap-1 rounded-md border border-border px-2 text-2xs text-sidebar-fg-muted transition-colors hover:bg-hover hover:text-fg"
				>
					<DatabaseIcon className="size-3" />
					{total === null ? null : <span className="tabular-nums">{total}</span>}
				</button>
			}
		>
			<div className="flex flex-col gap-2">
				{usage.state === "loading" ? (
					<div className="flex flex-col gap-1" role="status" aria-label="Loading resource usage">
						<Skeleton className="h-4" />
						<Skeleton className="h-4" />
						<Skeleton className="h-4" />
					</div>
				) : usage.state === "error" ? (
					<p role="status" className="text-xs text-fg-muted">
						Couldn't read resource usage: {usage.error.message}
					</p>
				) : groups.length === 0 ? (
					<p role="status" className="text-xs text-fg-muted">
						No processes are running.
					</p>
				) : (
					<>
						<Table>
							<TableCaption className="sr-only">Resources</TableCaption>
							<TableHeader>
								<TableRow>
									<SortHead
										label="Name"
										ariaLabel="Sort by name"
										sortKey="name"
										sort={sort}
										onSort={chooseSort}
									/>
									<SortHead
										label="CPU"
										ariaLabel="Sort by CPU"
										sortKey="cpu"
										sort={sort}
										onSort={chooseSort}
									/>
									<SortHead
										label="Mem"
										ariaLabel="Sort by memory"
										sortKey="memory"
										sort={sort}
										onSort={chooseSort}
									/>
								</TableRow>
							</TableHeader>
							{groups.map((group) => (
								<TableBody key={group.path ?? "other"} aria-label={group.label}>
									<TableRow>
										<TableHead scope="rowgroup" colSpan={3} className="text-fg-muted">
											{group.label}
										</TableHead>
									</TableRow>
									{group.rows.map((row) => (
										<TableRow key={row.pid}>
											<TableCell className="max-w-48 truncate" title={row.name}>
												{row.name}
											</TableCell>
											<TableCell className="tabular-nums">{cpuText(row.cpuPercent)}</TableCell>
											<TableCell className="tabular-nums">{memoryText(row.memoryBytes)}</TableCell>
										</TableRow>
									))}
								</TableBody>
							))}
						</Table>
						<div className="flex justify-end">
							<CopyButton
								text={usageText(groups)}
								onCopy={(text) => actions.app.copyText(text)}
								label="Copy resource usage"
							/>
						</div>
					</>
				)}
			</div>
		</Popover>
	);
}
