/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * @feature RUN-01 ScriptsPanel
 * Owns: right panel, bottom half. Tabs Setup, Run, the terminals made in this panel and Ports, a
 * collapse control, and the active tab. Entry point embedded by the workspace screen.
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
 * Moves (issue #527), with Split tabs on, as in Conductor's right panel (renderApp @4993207,
 * @5024021): a terminal tab drags to the centre, and the active one gives way to the terminal
 * before it (the next one when it was first). While a centre terminal tab is dragged, the whole
 * panel shows a drop zone; dropping there moves it here and opens it, unless the panel already
 * holds the most terminals allowed ("Maximum N terminals allowed").
 * Test first: with run state "running" the Run tab shows the Stop button for that action.
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import { useRef, useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import {
	LOCAL_TERMINAL_UNAVAILABLE_LABEL,
	localTerminalDescription,
	WORKSPACE_NOT_READY_DESCRIPTION,
} from "../../core/file-sync-view.ts";
import {
	useActions,
	useFileSyncStatus,
	useRunState,
	useSetting,
	useSetupState,
	useTerminals,
	useWorkspace,
} from "../../core/hooks.ts";
import { terminalLimit } from "../../core/terminals.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import {
	TERMINAL_SETTINGS_MESSAGES,
	terminalSettingsProblem,
} from "../terminal/terminal-settings.ts";
import { tabRef } from "../workspace/active-tab.ts";
import { type TabDragPayload, useTabDrag, useTabDropTarget } from "../workspace/tab-drag.tsx";
import { PortsTab } from "./ports/PortsTab.tsx";
import { RunTab } from "./run/RunTab.tsx";
import { type ScriptsPanelTabId, ScriptsPanelTabs } from "./ScriptsPanelTabs.tsx";
import { SetupTab } from "./setup/SetupTab.tsx";
import {
	nextTerminalAfterClose,
	TerminalTabBody,
	terminalAfterMoveOut,
} from "./terminals/TerminalTabBody.tsx";

/** A drag this panel takes: a centre terminal tab (Conductor's right panel drop, renderApp @4395873). */
const takesDrag = (payload: TabDragPayload): boolean =>
	payload.source === "center-tab" && payload.tab.kind === "terminal";

export function ScriptsPanel({ workspaceId }: { workspaceId: WorkspaceId }) {
	const workspace = useWorkspace(workspaceId);
	const terminals = useTerminals(workspaceId);
	const setup = useSetupState(workspaceId);
	const run = useRunState(workspaceId);
	const fileSync = useFileSyncStatus(workspaceId);
	const tabFreakMode = useSetting<boolean>("experimental_tab_freak_mode");
	const splitTabs = useSetting<boolean>("experimental_configurable_center_panel") === true;
	const tabDrag = useTabDrag();
	const rootRef = useRef<HTMLDivElement | null>(null);
	const actions = useActions();
	const services = useServices().services;
	const runService = services.runScripts;
	const portError = useStore(runService.store, (state) => state.portErrors[workspaceId]);
	const [picked, setPicked] = useState<ScriptsPanelTabId | null>(null);
	const [collapsed, setCollapsed] = useState(false);

	const all = terminals.state === "ready" ? terminals.data : [];
	const allInteractive = all.filter((terminal) => terminal.kind === "terminal");
	// A terminal made in the centre is listed there; only the panel's own are its tabs (#482).
	const interactive = allInteractive.filter((terminal) => terminal.placement === "panel");
	// Only a cloud workspace shows a host beside each terminal's name (CLOUD-09).
	const cloudWorkspace = workspace.state === "ready" && workspace.data.host.kind === "cloud";
	const terminalTabs = interactive.map((terminal) => ({
		id: terminal.id,
		title: terminal.title,
		ended: terminal.endedAt !== null,
		...(cloudWorkspace ? { hostKind: terminal.hostKind } : {}),
	}));
	const limit = terminalLimit(Boolean(tabFreakMode));
	// The service's limit counts every interactive terminal of the workspace, in either strip.
	const atLimit = allInteractive.length >= limit;

	const runActions =
		run.state === "ready" ? run.data.actions.filter((action) => !action.hidden) : [];
	const runActive = run.state === "ready" && run.data.running.length > 0;
	// A cloud workspace always offers Ports: Start forwarding and the shared preview URL live there,
	// before the sandbox has reported a listening port (CLOUD-09, CLOUD-10).
	const showPorts =
		cloudWorkspace ||
		(run.state === "ready" && (run.data.detectedPorts.length > 0 || portError !== undefined));
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

	const newTerminal = (hostKind?: "local" | "cloud"): void => {
		void (async () => {
			const problem = terminalSettingsProblem(services.settings.store.getState());
			if (problem !== null) {
				if (problem === "loading") toast.warning(TERMINAL_SETTINGS_MESSAGES.loading);
				else toast.error(TERMINAL_SETTINGS_MESSAGES.failed);
				return;
			}
			if (hostKind === "local" && workspace.state === "ready" && workspace.data.state !== "ready") {
				toastError(LOCAL_TERMINAL_UNAVAILABLE_LABEL, {
					message: WORKSPACE_NOT_READY_DESCRIPTION,
				});
				return;
			}
			const created = await actions.terminals.create(workspaceId, {
				placement: "panel",
				...(hostKind === undefined ? {} : { hostKind }),
			});
			if (!created.ok) {
				if (created.error.code === "run_local_mirror_unavailable") {
					toastError(LOCAL_TERMINAL_UNAVAILABLE_LABEL, {
						message: localTerminalDescription(fileSync),
					});
					return;
				}
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

	/** A centre terminal dropped here moves to this panel and opens, as Conductor's does. */
	const moveInFromCentre = async (payload: TabDragPayload): Promise<void> => {
		const terminalId = payload.tab.terminalId;
		if (terminalId === undefined) return;
		if (interactive.length >= limit) {
			toast.error(`Maximum ${limit} terminals allowed`);
			return;
		}
		const moved = await actions.terminals.move(workspaceId, terminalId, "panel");
		if (!moved.ok) {
			toastError("Couldn't move the terminal", moved.error);
			return;
		}
		setPicked({ kind: "terminal", terminalId });
		payload.onMovedOut?.();
	};

	useTabDropTarget((point, payload) => {
		const root = rootRef.current;
		if (!splitTabs || root === null || !takesDrag(payload)) return undefined;
		const rect = root.getBoundingClientRect();
		const inside =
			point.x >= rect.left &&
			point.x <= rect.right &&
			point.y >= rect.top &&
			point.y <= rect.bottom;
		if (!inside) return undefined;
		return { element: root, drop: (dropped) => void moveInFromCentre(dropped) };
	});

	/** A terminal moved to the centre: the active one gives way to the terminal before it. */
	const leave = (ids: readonly TerminalId[], terminalId: TerminalId): void => {
		setPicked((current) => {
			if (current?.kind !== "terminal" || current.terminalId !== terminalId) return current;
			const next = terminalAfterMoveOut(ids, terminalId);
			return next === null ? null : { kind: "terminal", terminalId: next };
		});
	};

	const startTerminalDrag = (
		event: Parameters<typeof tabDrag.start>[0],
		terminalId: TerminalId,
	): void => {
		const terminal = terminalTabs.find((candidate) => candidate.id === terminalId);
		if (terminal === undefined) return;
		const ids = terminalTabs.map((candidate) => candidate.id);
		tabDrag.start(event, {
			tab: {
				kind: "terminal",
				ref: tabRef({ kind: "terminal", terminalId }) ?? "",
				title: terminal.title,
				terminalId,
				...(terminal.hostKind === undefined ? {} : { hostKind: terminal.hostKind }),
			},
			source: "right-terminal",
			label: "Terminal",
			onMovedOut: () => leave(ids, terminalId),
		});
	};

	const dropZone = splitTabs && tabDrag.drag !== null && takesDrag(tabDrag.drag.payload);

	if (workspace.state === "error") {
		return (
			<EmptyState title="Scripts are unavailable" body={workspace.error.message} tone="failed" />
		);
	}

	return (
		<div
			ref={rootRef}
			className="relative flex h-full min-h-0 flex-col bg-[var(--color-sheet-surface)]"
		>
			<ScriptsPanelTabs
				active={active}
				terminals={terminalTabs}
				setupStatus={setupStatus}
				runActive={runActive}
				showPorts={showPorts}
				terminalLimit={limit}
				terminalCount={allInteractive.length}
				collapsed={collapsed}
				fileSync={fileSync}
				cloudWorkspace={cloudWorkspace}
				onSelect={setPicked}
				onNewTerminal={newTerminal}
				onCloseTerminal={closeTerminal}
				onToggleCollapsed={() => setCollapsed((value) => !value)}
				onTerminalPointerDown={splitTabs ? startTerminalDrag : undefined}
				onTerminalClickCapture={splitTabs ? tabDrag.consumeClick : undefined}
			/>
			{/* The hidden attribute, not a class: the bodies stay mounted and a test can tell which one shows. */}
			<div hidden={collapsed} className="min-h-0 flex-1">
				<div hidden={active.kind !== "setup"} className="h-full">
					<SetupTab workspaceId={workspaceId} />
				</div>
				<div hidden={active.kind !== "run"} className="h-full">
					<RunTab workspaceId={workspaceId} />
				</div>
				{showPorts ? (
					<div hidden={active.kind !== "ports"} className="h-full">
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
			{dropZone ? (
				<div data-testid="panel-terminal-drop-zone" aria-hidden className="absolute inset-0 z-40">
					<div className="pointer-events-none absolute inset-2 rounded border border-focus bg-well" />
				</div>
			) : null}
		</div>
	);
}
