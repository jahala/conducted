/**
 * @feature RUN-01 ScriptsPanel
 * Owns: right panel, bottom half. Tabs Setup, Run, Terminal N and Ports, a collapse control, and
 * the active tab. Entry point embedded by the workspace screen.
 * Behaviour: ui-map.md 3.7 (tabs, Cmd+J toggles the panel); services-map.md 5A.1 (setup and
 * action process stores).
 * Data: useTerminals, useRunState, useWorkspace, useSetupState, useSetting, useActions().
 * Children: ScriptsPanelTabs, setup/SetupTab, run/RunTab, terminals/TerminalTabBody and
 * ports/PortsTab.
 * Our design choice: the active tab and the collapsed state live in this component for now; the
 * workspace screen can persist them through settings later. Every tab body stays mounted while
 * another tab is active, so a terminal and a running action keep their state.
 * Must handle: loading and error, a workspace still initializing (Setup tab active), the active
 * terminal being closed (select its neighbour), the tab limit reached, and collapse keeping
 * process state alive.
 * Test first: with run state "running" the Run tab shows the Stop button for that action.
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import { useState } from "react";
import {
	useActions,
	useRunState,
	useSetting,
	useSetupState,
	useTerminals,
	useWorkspace,
} from "../../core/hooks.ts";
import { terminalLimit } from "../../core/services/terminals.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { PortsTab } from "./ports/PortsTab.tsx";
import { RunTab } from "./run/RunTab.tsx";
import { type ScriptsPanelTabId, ScriptsPanelTabs } from "./ScriptsPanelTabs.tsx";
import { SetupTab } from "./setup/SetupTab.tsx";
import { nextTerminalAfterClose, TerminalTabBody } from "./terminals/TerminalTabBody.tsx";

export function ScriptsPanel({ workspaceId }: { workspaceId: WorkspaceId }) {
	const workspace = useWorkspace(workspaceId);
	const terminals = useTerminals(workspaceId);
	const setup = useSetupState(workspaceId);
	const run = useRunState(workspaceId);
	const tabFreakMode = useSetting<boolean>("experimental_tab_freak_mode");
	const actions = useActions();
	const [picked, setPicked] = useState<ScriptsPanelTabId | null>(null);
	const [collapsed, setCollapsed] = useState(false);

	const all = terminals.state === "ready" ? terminals.data : [];
	const interactive = all.filter((terminal) => terminal.kind === "terminal");
	const terminalTabs = interactive.map((terminal) => ({
		id: terminal.id,
		title: terminal.title,
		ended: terminal.endedAt !== null,
	}));
	const limit = terminalLimit(Boolean(tabFreakMode));
	const atLimit = terminalTabs.length >= limit;

	const runActions =
		run.state === "ready" ? run.data.actions.filter((action) => !action.hidden) : [];
	const runActive = run.state === "ready" && run.data.running.length > 0;
	const showPorts = run.state === "ready" && run.data.detectedPorts.length > 0;
	const starting =
		workspace.state === "ready" && workspace.data.state === "initializing"
			? true
			: workspace.state === "loading";
	const fallback: ScriptsPanelTabId =
		starting || runActions.length === 0 ? { kind: "setup" } : { kind: "run" };

	const chosen = picked ?? fallback;
	const active: ScriptsPanelTabId =
		chosen.kind === "terminal" && !interactive.some((terminal) => terminal.id === chosen.terminalId)
			? fallback
			: chosen.kind === "ports" && !showPorts
				? fallback
				: chosen;

	const setupStatus =
		setup.state !== "ready"
			? "idle"
			: setup.data.state === "running" || setup.data.state === "detecting"
				? "running"
				: setup.data.state === "failed"
					? "failed"
					: setup.data.state === "completed"
						? "completed"
						: "idle";

	const newTerminal = (): void => {
		void (async () => {
			const created = await actions.terminals.create(workspaceId);
			if (!created.ok) {
				toastError("Couldn't open a terminal", created.error);
				return;
			}
			setPicked({ kind: "terminal", terminalId: created.value.id });
		})();
	};

	const closeTerminal = (terminalId: TerminalId): void => {
		const next = nextTerminalAfterClose(
			terminalTabs.map((terminal) => terminal.id),
			terminalId,
		);
		void (async () => {
			const closed = await actions.terminals.close(terminalId);
			if (!closed.ok) {
				toastError("Couldn't close the terminal", closed.error);
				return;
			}
			setPicked(next === null ? fallback : { kind: "terminal", terminalId: next });
		})();
	};

	if (workspace.state === "error") {
		return (
			<EmptyState title="Scripts are unavailable" body={workspace.error.message} tone="failed" />
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-[var(--color-sheet-surface)]">
			<ScriptsPanelTabs
				active={active}
				terminals={terminalTabs}
				setupStatus={setupStatus}
				runActive={runActive}
				showPorts={showPorts}
				terminalLimit={limit}
				collapsed={collapsed}
				onSelect={setPicked}
				onNewTerminal={newTerminal}
				onCloseTerminal={closeTerminal}
				onToggleCollapsed={() => setCollapsed((value) => !value)}
			/>
			<div className={collapsed ? "hidden" : "min-h-0 flex-1"}>
				<div className={active.kind === "setup" ? "h-full" : "hidden"}>
					<SetupTab workspaceId={workspaceId} />
				</div>
				<div className={active.kind === "run" ? "h-full" : "hidden"}>
					<RunTab workspaceId={workspaceId} />
				</div>
				{showPorts ? (
					<div className={active.kind === "ports" ? "h-full" : "hidden"}>
						<PortsTab workspaceId={workspaceId} />
					</div>
				) : null}
				{interactive.map((terminal) => (
					<TerminalTabBody
						key={terminal.id}
						workspaceId={workspaceId}
						terminalId={terminal.id}
						visible={active.kind === "terminal" && active.terminalId === terminal.id}
						onClose={() => closeTerminal(terminal.id)}
						onNewTerminal={newTerminal}
						canStartNew={!atLimit}
						terminalLimit={limit}
					/>
				))}
			</div>
		</div>
	);
}
