/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * @feature RUN-01 Scripts panel tab strip
 * Owns: the tab buttons of the scripts panel and the collapse button. Fixed tabs Setup, Run and
 * Ports; one tab per terminal, with its host in a cloud workspace; a "new terminal" button.
 * Behaviour: ui-map.md 3.7 (tabs; "New terminal", "Close terminal", "Maximum N terminals
 * allowed"; Cmd+J "Toggle terminal panel"; a cloud workspace's terminal tabs carry a cloud or
 * laptop host icon, CLOUD-09).
 * Must handle: a status dot on Setup (running, failed) and Run (running), the limit disabling "new
 * terminal" with the reason as its title, many terminals (the strip scrolls), middle-click closing
 * a terminal tab, the Ports tab being hidden until a port is detected or its scan fails, and a
 * cloud workspace's New terminal offering "Cloud terminal" and "Local terminal" (CLOUD-11).
 * Test first: at the terminal limit the new-terminal button is disabled and says why.
 */
import type { TerminalId } from "@conducted/shared";
import type { FileSyncView } from "../../core/file-sync-view.ts";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	CloudIcon,
	LaptopIcon,
	PlusIcon,
} from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";

export type ScriptsPanelTabId =
	| { kind: "setup" }
	| { kind: "run" }
	| { kind: "ports" }
	| { kind: "terminal"; terminalId: TerminalId };

export interface ScriptsPanelTabsProps {
	active: ScriptsPanelTabId;
	terminals: {
		id: TerminalId;
		title: string;
		ended: boolean;
		/** Where the terminal runs; a cloud workspace shows it beside the title (CLOUD-09). */
		hostKind?: "local" | "cloud";
	}[];
	setupStatus: "idle" | "running" | "failed" | "completed";
	runActive: boolean;
	showPorts: boolean;
	terminalLimit: number;
	collapsed: boolean;
	/** A cloud workspace's file-sync state; undefined on a Mac workspace (CLOUD-11). */
	fileSync?: FileSyncView;
	/** True for a cloud workspace, whose New terminal offers the sandbox and the Mac (CLOUD-11). */
	cloudWorkspace?: boolean;
	onSelect: (tab: ScriptsPanelTabId) => void;
	onNewTerminal: (hostKind?: "local" | "cloud") => void;
	onCloseTerminal: (id: TerminalId) => void;
	onToggleCollapsed: () => void;
}

const sameTab = (left: ScriptsPanelTabId, right: ScriptsPanelTabId): boolean => {
	if (left.kind !== right.kind) return false;
	if (left.kind === "terminal" && right.kind === "terminal") {
		return left.terminalId === right.terminalId;
	}
	return true;
};

function StatusDot({ tone }: { tone: "running" | "failed" }) {
	return (
		<span
			aria-hidden="true"
			data-status={tone}
			className={cn("size-1.5 rounded-full", tone === "failed" ? "bg-danger" : "bg-success")}
		/>
	);
}

export function ScriptsPanelTabs({
	active,
	terminals,
	setupStatus,
	runActive,
	showPorts,
	terminalLimit,
	collapsed,
	fileSync,
	cloudWorkspace = false,
	onSelect,
	onNewTerminal,
	onCloseTerminal,
	onToggleCollapsed,
}: ScriptsPanelTabsProps) {
	const atLimit = terminals.length >= terminalLimit;
	const reason = `Maximum ${terminalLimit} terminals allowed`;
	const tab = (
		id: ScriptsPanelTabId,
		label: string,
		status?: "running" | "failed",
		hostKind?: "local" | "cloud",
	) => (
		<button
			key={id.kind === "terminal" ? id.terminalId : id.kind}
			type="button"
			role="tab"
			aria-selected={sameTab(active, id)}
			onClick={() => onSelect(id)}
			onAuxClick={(event) => {
				if (id.kind === "terminal" && event.button === 1) onCloseTerminal(id.terminalId);
			}}
			className={cn(
				"inline-flex h-8 shrink-0 items-center gap-1.5 border-b-2 px-2 text-xs font-medium transition-colors",
				sameTab(active, id)
					? "border-[var(--color-accent)] text-fg"
					: "border-transparent text-fg-muted hover:text-fg",
			)}
		>
			{hostKind === undefined ? null : (
				<span
					data-host={hostKind}
					className="flex shrink-0 items-center text-fg-muted"
					aria-hidden="true"
				>
					{hostKind === "cloud" ? (
						<CloudIcon className="size-3" />
					) : (
						<LaptopIcon className="size-3" />
					)}
				</span>
			)}
			{label}
			{status === undefined ? null : <StatusDot tone={status} />}
		</button>
	);

	return (
		<div className="flex h-8 shrink-0 items-center gap-1 border-b border-separator px-2">
			<IconButton
				size="xs"
				variant="ghost"
				label={collapsed ? "Expand panel" : "Collapse panel"}
				icon={
					collapsed ? (
						<ChevronRightIcon className="size-3.5" />
					) : (
						<ChevronDownIcon className="size-3.5" />
					)
				}
				className="text-fg-muted"
				onClick={onToggleCollapsed}
			/>
			{fileSync !== undefined && fileSync.state !== "local" && fileSync.state !== "synced" ? (
				<span
					data-file-sync-state={fileSync.state}
					title={
						fileSync.state === "unavailable"
							? fileSync.localTerminalLabel
							: fileSync.state === "failed"
								? fileSync.message
								: undefined
					}
					className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-fg-muted"
				>
					{fileSync.label}
				</span>
			) : null}
			<div role="tablist" className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
				{tab(
					{ kind: "setup" },
					"Setup",
					setupStatus === "failed" ? "failed" : setupStatus === "running" ? "running" : undefined,
				)}
				{tab({ kind: "run" }, "Run", runActive ? "running" : undefined)}
				{showPorts ? tab({ kind: "ports" }, "Ports") : null}
				{terminals.map((terminal) =>
					tab(
						{ kind: "terminal", terminalId: terminal.id },
						terminal.title,
						undefined,
						terminal.hostKind,
					),
				)}
			</div>
			{cloudWorkspace ? (
				<Menu>
					<MenuTrigger asChild>
						<IconButton
							size="xs"
							variant="ghost"
							label="New terminal"
							icon={<PlusIcon className="size-3.5" />}
							className="text-fg-muted"
							disabled={atLimit}
							title={atLimit ? reason : undefined}
						/>
					</MenuTrigger>
					<MenuContent align="end">
						<MenuItem icon={<CloudIcon />} onSelect={() => onNewTerminal("cloud")}>
							Cloud terminal
						</MenuItem>
						<MenuItem icon={<LaptopIcon />} onSelect={() => onNewTerminal("local")}>
							Local terminal
						</MenuItem>
					</MenuContent>
				</Menu>
			) : (
				<IconButton
					size="xs"
					variant="ghost"
					label="New terminal"
					icon={<PlusIcon className="size-3.5" />}
					className="text-fg-muted"
					disabled={atLimit}
					title={atLimit ? reason : undefined}
					onClick={() => onNewTerminal()}
				/>
			)}
		</div>
	);
}
