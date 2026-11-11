/**
 * @feature APP-07 Resource usage table
 * Owns: the resource chip in the sidebar's top strip and its Resources popover: the heading with
 * its four buttons, the CPU and memory summary, the table of processes grouped into a collapsible
 * tree, sorting, and "Show all". It also writes a log line for a process over the memory threshold.
 * Behaviour: ui-map.md 1.3 (Conductor 0.92.1, renderApp @10350785 to @10368072): the chip has a
 * microchip icon and the app's own memory, is hidden below 200px of sidebar width and shows only
 * its icon below 260px; the popover (at least 360px, or the sidebar less 24px) opens at the chip's
 * end. Its header reads "Resources", with "Include terminal processes", "Group by workspace",
 * "Switch to flat view" and "Copy resource usage" at the right, and "CPU <n>% Memory <n>" below.
 * The table (Name, CPU, Mem) starts sorted by memory, high first, as a tree grouped under App and
 * each workspace's folder name; a group row folds its rows away. Past seven processes a footer
 * reads "Show all (n)" and grows the table from 220px to 60% of the window. The rules are in
 * resource-usage.ts. ui-map.md 4 item 8 and 5.2 (Popover: Resources).
 * Data: `platform.app.resourceUsage` (PLAT-14), the setting `sidebar_resource_usage`, and
 * `useWorkspaces` for the group names.
 * Our design choice: the popover's view (sort, toggles, folded groups) lives in this component, so
 * it lasts while the chip is shown, as Conductor's store lasts while the app runs. The process
 * table is read every 5 seconds, not Conductor's 2, because each reading also feeds the
 * high-memory log line. A reading that fails keeps the last one; with none yet there is no chip,
 * as in Conductor, and the first failure in a row is written to the app log. The high-memory log
 * line runs while the sidebar is mounted, even with the setting off, because the research puts
 * that logger in the app's startup.
 * Must handle: Setting off (renders nothing); no reading yet (no chip); sorting by a column; a
 * process that exits between polls disappears on the next poll; copy puts plain text in the
 * clipboard.
 * Test first: with the setting on, the popover lists App first with Main's Sidecar under Main,
 * then each workspace, sorted by memory, with "Show all (n)" once more than seven processes show.
 */
import { appError, err, type Result } from "@conducted/shared";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { createLatestWins } from "../../core/async/latest-wins.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useSetting, useWorkspaces } from "../../core/hooks.ts";
import type { ProcessUsage } from "../../platform/platform.ts";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { cn } from "../../ui/cn.ts";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	GitForkIcon,
	LayersIcon,
	MicrochipIcon,
	TerminalIcon,
} from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { TableCaption } from "../../ui/Table.tsx";
import {
	appMemoryBytes,
	DEFAULT_VIEW,
	formatCpu,
	formatMemory,
	groupProcesses,
	nextSort,
	type ResourceView,
	SHOW_ALL_AFTER,
	type SortKey,
	shownProcesses,
	sortedFlat,
	sortedTree,
	type TreeRow,
	totals,
	usageText,
} from "./resource-usage.ts";

/** How often the process table is read while the sidebar is mounted. */
const POLL_INTERVAL_MS = 5_000;

/** A process at or above this resident size gets a log line. Our dial. */
const HEAVY_MEMORY_BYTES = 512 * 1024 * 1024;

/** Below this sidebar width the chip is not shown; below the next, only its icon is. */
const HIDE_BELOW_PX = 200;
const ICON_ONLY_BELOW_PX = 260;
const MIN_POPOVER_PX = 360;

export interface ResourceUsageTableProps {
	/** How often usage is read, in milliseconds. Zero reads once. */
	pollIntervalMs?: number;
	/** The sidebar's width in pixels, which decides the chip's form and the popover's width. */
	sidebarWidth?: number;
}

interface WorkspaceFolder {
	path: string;
	directoryName: string;
}

const EMPTY_FOLDERS: readonly WorkspaceFolder[] = [];

function logHeavyProcesses(
	writeLog: (level: "warn", message: string, data: unknown) => void,
	processes: readonly ProcessUsage[],
): void {
	for (const process of processes) {
		if (process.memoryBytes < HEAVY_MEMORY_BYTES) continue;
		writeLog(
			"warn",
			`High memory: ${process.label} (pid ${process.pid}) is using ${formatMemory(process.memoryBytes)}`,
			{
				pid: process.pid,
				label: process.label,
				memoryBytes: process.memoryBytes,
				cpuPercent: process.cpuPercent,
				workspacePath: process.workspacePath ?? null,
			},
		);
	}
}

export function ResourceUsageTable({
	pollIntervalMs = POLL_INTERVAL_MS,
	sidebarWidth,
}: ResourceUsageTableProps) {
	const { platform } = useServices();
	const workspaces = useWorkspaces();
	const enabled = useSetting<boolean>("sidebar_resource_usage");
	const [processes, setProcesses] = useState<ProcessUsage[] | null>(null);
	const [view, setView] = useState<ResourceView>(DEFAULT_VIEW);

	const folders = useMemo(
		() =>
			workspaces.state === "ready"
				? workspaces.data.map(({ path, directoryName }) => ({ path, directoryName }))
				: EMPTY_FOLDERS,
		[workspaces],
	);
	const pathKey = folders.map((folder) => folder.path).join("\n");

	useEffect(() => {
		const paths = pathKey === "" ? [] : pathKey.split("\n");
		const latest = createLatestWins();
		let active = true;
		let failing = false;
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
				if (!failing) {
					platform.app.writeLog("warn", "Resource usage could not be read", {
						code: result.error.code,
						message: result.error.message,
					});
				}
				failing = true;
				return;
			}
			failing = false;
			setProcesses(result.value);
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

	if (!enabled || processes === null) return null;
	if (sidebarWidth !== undefined && sidebarWidth < HIDE_BELOW_PX) return null;

	const iconOnly = sidebarWidth !== undefined && sidebarWidth < ICON_ONLY_BELOW_PX;
	const memory = formatMemory(appMemoryBytes(processes));
	const label = `Resource usage: ${memory}`;
	const minWidth = Math.max(sidebarWidth === undefined ? 280 : sidebarWidth - 24, MIN_POPOVER_PX);

	return (
		<Popover
			align="end"
			sideOffset={8}
			collisionPadding={12}
			className="w-max max-w-(--radix-popover-content-available-width) p-0! ring-1 ring-popover-ring"
			style={{ minWidth: `${minWidth}px` }}
			trigger={
				<button
					type="button"
					aria-label={label}
					title={iconOnly ? label : undefined}
					className={cn(
						"flex items-center rounded-md border border-border text-2xs text-sidebar-fg-muted hover:bg-hover hover:text-sidebar-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus",
						iconOnly ? "p-1" : "gap-1 px-2 py-1",
					)}
				>
					<MicrochipIcon className="size-3" />
					{iconOnly ? null : <span className="tabular-nums">{memory}</span>}
				</button>
			}
		>
			<ResourcesPanel processes={processes} folders={folders} view={view} onView={setView} />
		</Popover>
	);
}

function ResourcesPanel({
	processes,
	folders,
	view,
	onView,
}: {
	processes: readonly ProcessUsage[];
	folders: readonly WorkspaceFolder[];
	view: ResourceView;
	onView: (update: (view: ResourceView) => ResourceView) => void;
}) {
	const actions = useActions();
	const shown = shownProcesses(processes, view.includeTerminals);
	const sum = totals(shown);
	const { sortKey, sortDirection, treeMode } = view;
	const ordered = treeMode
		? sortedTree(shown, sortKey, sortDirection).map((row) => row.process)
		: sortedFlat(shown, sortKey, sortDirection);
	const toggle = (key: "includeTerminals" | "groupByWorkspace" | "treeMode" | "showAll") =>
		onView((current) => ({ ...current, [key]: !current[key] }));

	const rowsOf = (list: readonly ProcessUsage[], inGroup: boolean): ReactNode => {
		const rows: TreeRow[] = treeMode
			? sortedTree(list, sortKey, sortDirection)
			: sortedFlat(list, sortKey, sortDirection).map((process) => ({ process, depth: 0 }));
		return rows.map((row) => <ProcessRow key={row.process.pid} row={row} inGroup={inGroup} />);
	};

	return (
		<>
			<div className="border-b border-border px-4 py-2">
				<div className="flex items-center justify-between gap-2">
					<p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Resources</p>
					<div className="flex items-center gap-0.5">
						<HeaderToggle
							on={view.includeTerminals}
							title={
								view.includeTerminals ? "Exclude terminal processes" : "Include terminal processes"
							}
							icon={<TerminalIcon className="size-3.5" />}
							onClick={() => toggle("includeTerminals")}
						/>
						<HeaderToggle
							on={view.groupByWorkspace}
							title={view.groupByWorkspace ? "Ungroup processes" : "Group by workspace"}
							icon={<LayersIcon className="size-3.5" />}
							onClick={() => toggle("groupByWorkspace")}
						/>
						<HeaderToggle
							on={treeMode}
							title={treeMode ? "Switch to flat view" : "Switch to tree view"}
							icon={<GitForkIcon className="size-3.5" />}
							onClick={() => toggle("treeMode")}
						/>
						<CopyButton
							iconOnly
							size="xs"
							label="Copy resource usage"
							text={usageText(ordered, folders)}
							onCopy={(text) => actions.app.copyText(text)}
							className="w-auto rounded-sm p-1! text-fg-muted! hover:text-fg!"
						/>
					</div>
				</div>
				<p className="mt-1 text-sm">
					<span className="text-fg-muted">CPU</span>{" "}
					<span className="font-medium tabular-nums text-fg">{formatCpu(sum.cpuPercent)}</span>{" "}
					<span className="text-fg-muted">Memory</span>{" "}
					<span className="tabular-nums text-fg">{formatMemory(sum.memoryBytes)}</span>
				</p>
			</div>
			<div
				className={cn(
					"overflow-x-hidden overflow-y-auto",
					view.showAll ? "max-h-[60vh]" : "max-h-[220px]",
				)}
			>
				<table className="w-full text-xs">
					<TableCaption className="sr-only">Resources</TableCaption>
					<thead className="sticky top-0 bg-raised">
						<tr className="text-2xs text-fg-muted">
							<SortHead label="Name" sortKey="name" view={view} onView={onView} align="left" />
							<SortHead label="CPU" sortKey="cpu" view={view} onView={onView} align="right" />
							<SortHead label="Mem" sortKey="memory" view={view} onView={onView} align="right" />
						</tr>
					</thead>
					<tbody>
						{view.groupByWorkspace
							? groupProcesses(shown, folders).map((group) => {
									const collapsed = view.collapsedGroups.has(group.name);
									const groupSum = totals(group.processes);
									return (
										<Fragment key={group.name}>
											<GroupRow
												name={group.name}
												cpuPercent={groupSum.cpuPercent}
												memoryBytes={groupSum.memoryBytes}
												collapsed={collapsed}
												onToggle={() =>
													onView((current) => {
														const next = new Set(current.collapsedGroups);
														if (next.has(group.name)) next.delete(group.name);
														else next.add(group.name);
														return { ...current, collapsedGroups: next };
													})
												}
											/>
											{collapsed ? null : rowsOf(group.processes, true)}
										</Fragment>
									);
								})
							: rowsOf(shown, false)}
					</tbody>
				</table>
			</div>
			{shown.length > SHOW_ALL_AFTER ? (
				<button
					type="button"
					onClick={() => toggle("showAll")}
					className="w-full border-t border-border px-4 py-1.5 text-2xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
				>
					{view.showAll ? "Show less" : `Show all (${shown.length})`}
				</button>
			) : null}
		</>
	);
}

function HeaderToggle({
	on,
	title,
	icon,
	onClick,
}: {
	on: boolean;
	title: string;
	icon: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			aria-pressed={on}
			onClick={onClick}
			className={cn(
				"rounded-sm p-1 hover:bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
				on ? "text-fg" : "text-fg-muted",
			)}
		>
			{icon}
		</button>
	);
}

function SortHead({
	label,
	sortKey,
	view,
	onView,
	align,
}: {
	label: string;
	sortKey: SortKey;
	view: ResourceView;
	onView: (update: (view: ResourceView) => ResourceView) => void;
	align: "left" | "right";
}) {
	const active = view.sortKey === sortKey;
	const padding = sortKey === "name" ? "pl-4 pr-3" : sortKey === "cpu" ? "px-3" : "pl-3 pr-4";
	return (
		<th
			aria-sort={active ? (view.sortDirection === "asc" ? "ascending" : "descending") : "none"}
			className={cn(
				padding,
				"pt-2 pb-1 font-normal",
				align === "left" ? "text-left" : "text-right",
			)}
		>
			<button
				type="button"
				onClick={() => onView((current) => ({ ...current, ...nextSort(current, sortKey) }))}
				className={cn(
					"inline-flex items-center gap-0.5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
					active && "text-fg",
				)}
			>
				{label}
				{active ? (
					view.sortDirection === "asc" ? (
						<ChevronUpIcon className="size-3" />
					) : (
						<ChevronDownIcon className="size-3" />
					)
				) : null}
			</button>
		</th>
	);
}

const cpuCell = "whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums text-fg";
const memoryCell = "whitespace-nowrap py-1.5 pr-4 pl-3 text-right tabular-nums text-fg-muted";

function GroupRow({
	name,
	cpuPercent,
	memoryBytes,
	collapsed,
	onToggle,
}: {
	name: string;
	cpuPercent: number;
	memoryBytes: number;
	collapsed: boolean;
	onToggle: () => void;
}) {
	return (
		<tr className="cursor-pointer hover:bg-hover" onClick={onToggle}>
			<td className="py-1.5 pr-4 pl-2">
				<button
					type="button"
					aria-expanded={!collapsed}
					onClick={(event) => {
						event.stopPropagation();
						onToggle();
					}}
					className="flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
				>
					<ChevronDownIcon
						className={cn(
							"size-3 shrink-0 text-fg-muted transition-transform",
							!collapsed && "rotate-180",
						)}
					/>
					<span className="truncate text-xs font-medium text-fg">{name}</span>
				</button>
			</td>
			<td className={cpuCell}>{formatCpu(cpuPercent)}</td>
			<td className={memoryCell}>{formatMemory(memoryBytes)}</td>
		</tr>
	);
}

function ProcessRow({ row, inGroup }: { row: TreeRow; inGroup: boolean }) {
	const indent = (inGroup ? 24 : 16) + row.depth * 12;
	return (
		<tr>
			<td className="truncate py-1.5 pr-4 text-fg" style={{ paddingLeft: `${indent}px` }}>
				{row.process.label}
			</td>
			<td className={cpuCell}>{formatCpu(row.process.cpuPercent)}</td>
			<td className={memoryCell}>{formatMemory(row.process.memoryBytes)}</td>
		</tr>
	);
}
