/**
 * @feature RUN-01 Scripts panel tab strip
 * Owns: the tab buttons of the scripts panel and the collapse button. Fixed tabs Setup, Run and
 * Ports; one tab per terminal; a "new terminal" button.
 * Behaviour: ui-map.md 3.7 (tabs; "New terminal", "Close terminal", "Maximum N terminals
 * allowed"; Cmd+J "Toggle terminal panel").
 * Must handle: a status dot on Setup (running, failed) and Run (running), the limit disabling "new
 * terminal" with the reason as its title, many terminals (the strip scrolls), middle-click closing
 * a terminal tab, and the Ports tab being hidden until a port is detected or its scan fails (Our
 * design choice).
 * Test first: at the terminal limit the new-terminal button is disabled and says why.
 */
import type { TerminalId } from "@conducted/shared";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";

export type ScriptsPanelTabId =
	| { kind: "setup" }
	| { kind: "run" }
	| { kind: "ports" }
	| { kind: "terminal"; terminalId: TerminalId };

export interface ScriptsPanelTabsProps {
	active: ScriptsPanelTabId;
	terminals: { id: TerminalId; title: string; ended: boolean }[];
	setupStatus: "idle" | "running" | "failed" | "completed";
	runActive: boolean;
	showPorts: boolean;
	terminalLimit: number;
	collapsed: boolean;
	onSelect: (tab: ScriptsPanelTabId) => void;
	onNewTerminal: () => void;
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
	onSelect,
	onNewTerminal,
	onCloseTerminal,
	onToggleCollapsed,
}: ScriptsPanelTabsProps) {
	const atLimit = terminals.length >= terminalLimit;
	const reason = `Maximum ${terminalLimit} terminals allowed`;
	const tab = (id: ScriptsPanelTabId, label: string, status?: "running" | "failed") => (
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
				"inline-flex h-8 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs transition-colors",
				sameTab(active, id)
					? "border-[var(--color-accent)] text-fg"
					: "border-transparent text-fg-muted hover:text-fg",
			)}
		>
			{label}
			{status === undefined ? null : <StatusDot tone={status} />}
		</button>
	);

	return (
		<div className="flex shrink-0 items-center gap-1 border-b border-separator px-2">
			<div role="tablist" className="flex min-w-0 flex-1 items-center overflow-x-auto">
				{tab(
					{ kind: "setup" },
					"Setup",
					setupStatus === "failed" ? "failed" : setupStatus === "running" ? "running" : undefined,
				)}
				{tab({ kind: "run" }, "Run", runActive ? "running" : undefined)}
				{showPorts ? tab({ kind: "ports" }, "Ports") : null}
				{terminals.map((terminal) =>
					tab({ kind: "terminal", terminalId: terminal.id }, terminal.title, undefined),
				)}
			</div>
			<Button
				variant="ghost"
				size="sm"
				disabled={atLimit}
				title={atLimit ? reason : undefined}
				onClick={onNewTerminal}
			>
				New terminal
			</Button>
			<Button variant="ghost" size="sm" onClick={onToggleCollapsed}>
				{collapsed ? "Expand panel" : "Collapse panel"}
			</Button>
		</div>
	);
}
