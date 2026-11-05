/**
 * @feature RUN-01 Run tab
 * Owns: the Run tab body. The action picker with the Run or Stop button and Open button, and the
 * live output of the running action.
 * Behaviour: ui-map.md 3.7, "Run" paragraph; services-map.md 5A.1.3 and 5A.1.4 (concurrent or
 * exclusive run mode). The button's words come from run-button-label.ts.
 * Data: useRunState (actions, running), useWorkspace (archived check and repo id), useActions().run.
 * Children: RunToolbar, RunEmptyState, terminal/TerminalView for the output.
 * Must handle: no actions (empty state), loading, the picked action disappearing (falls back to the
 * default), a run starting while setup is running (button says Waiting for setup), a stop that is
 * not confirmed (the error is shown and the button returns to Run), a process that exits by itself
 * (output stays, button back to Run again), exclusive mode stopping another workspace's run (the
 * service does it), and an archived workspace.
 * Test first: with one action and no running process the toolbar shows "Run <label>".
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../../app/command-dispatcher.ts";
import { useServices } from "../../../core/context.tsx";
import { useActions, useRunState, useWorkspace } from "../../../core/hooks.ts";
import { defaultRunAction } from "../../../core/services/run-scripts.ts";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { TerminalView } from "../../terminal/TerminalView.tsx";
import { RunEmptyState } from "./RunEmptyState.tsx";
import { RunToolbar } from "./RunToolbar.tsx";
import { type RunPhase, runButtonModel } from "./run-button-label.ts";

export interface RunTabProps {
	workspaceId: WorkspaceId;
}

/** The phase the button shows for the selected action. Another action's run does not own it. */
function phaseFor(
	phase: RunPhase,
	activeActionId: string | null,
	selectedActionId: string | null,
): RunPhase {
	if (phase === "starting" || phase === "waiting_for_setup" || phase === "stopping") return phase;
	if (activeActionId !== null && selectedActionId !== null && activeActionId === selectedActionId) {
		return "running";
	}
	return "stopped";
}

export function RunTab({ workspaceId }: RunTabProps) {
	const run = useRunState(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const actions = useActions();
	const navigate = useNavigate();
	const runService = useServices().services.runScripts;
	const storedPhase = useStore(runService.store, (state) => state.phases[workspaceId]);
	const history = useStore(runService.store, (state) => state.history[workspaceId]) ?? [];
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [lastTerminal, setLastTerminal] = useState<TerminalId | null>(null);

	const available = run.state === "ready" ? run.data.actions.filter((entry) => !entry.hidden) : [];
	const selected =
		available.find((entry) => entry.id === selectedId) ??
		defaultRunAction(available) ??
		available[0] ??
		null;
	const running = run.state === "ready" ? run.data.running : [];
	const active = running.find((entry) => entry.actionId === selected?.id) ?? running[0];
	const phase = phaseFor(storedPhase ?? "stopped", active?.actionId ?? null, selected?.id ?? null);
	const button = runButtonModel(
		{ id: selected?.id ?? "", label: selected?.label ?? "", isSpotlight: false },
		phase,
		selected === null ? false : history.includes(selected.id),
	);
	const urls =
		active?.url === null || active?.url === undefined
			? []
			: [{ label: "Local server", url: active.url }];

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new workspace starts on its default action.
	useEffect(() => {
		setSelectedId(null);
		setLastTerminal(null);
	}, [workspaceId]);

	useEffect(() => {
		if (active === undefined) return;
		setLastTerminal(active.terminalId);
	}, [active]);

	const openSettings = (page: "actions" | "scripts"): void => {
		if (workspace.state !== "ready") return;
		void navigate({
			to: "/settings/repos/$repoId/$page",
			params: { repoId: workspace.data.repoId, page },
		});
	};

	const click = (): void => {
		if (selected === null || button.click === null) return;
		const effect = button.click;
		const actionId = selected.id;
		void (async () => {
			const result =
				effect === "start"
					? await actions.run.start(workspaceId, actionId)
					: effect === "stop"
						? await actions.run.stop(workspaceId, actionId)
						: effect === "start_spotlight"
							? await actions.run.startSpotlight(workspaceId)
							: await actions.run.stopSpotlight(workspaceId);
			if (!result.ok) toastError("Couldn't run the action", result.error);
		})();
	};

	useCommandHandler("workspace.toggleRun", "area", () => {
		if (button.click === null) return false;
		click();
		return true;
	});

	if (run.state === "loading" || workspace.state === "loading") {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner label="Loading the Run tab" />
			</div>
		);
	}
	if (run.state === "error") {
		return <EmptyState title="Run is unavailable" body={run.error.message} tone="failed" />;
	}
	if (workspace.state === "error") {
		return <EmptyState title="Run is unavailable" body={workspace.error.message} tone="failed" />;
	}
	if (workspace.data.state === "archived" || workspace.data.state === "archiving") {
		return (
			<EmptyState
				title="This workspace is archived."
				body="Unarchive it to run its actions again."
			/>
		);
	}
	if (available.length === 0 || selected === null) {
		return (
			<RunEmptyState
				canAskAgent={false}
				onAskAgent={() => toast("Ask an agent in a chat to add a run action.")}
				onAddAction={() => openSettings("actions")}
				onConfigure={() => openSettings("scripts")}
			/>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<RunToolbar
				actions={available.map((entry) => ({ id: entry.id, label: entry.label }))}
				selectedActionId={selected.id}
				onSelectAction={setSelectedId}
				button={button}
				onButtonClick={click}
				urls={urls}
				onOpenUrl={(url) => {
					void (async () => {
						const opened = await actions.app.openUrl(url);
						if (!opened.ok) toastError("Couldn't open the URL", opened.error);
					})();
				}}
			/>
			<div className="min-h-0 flex-1">
				{lastTerminal === null ? (
					<div className="flex h-full items-center justify-center px-6 text-center">
						<p className="text-sm text-fg-muted">
							{phase === "waiting_for_setup"
								? "Waiting for the setup script to finish."
								: "Run output appears here."}
						</p>
					</div>
				) : (
					<TerminalView terminalId={lastTerminal} workspaceId={workspaceId} visible />
				)}
			</div>
		</div>
	);
}
