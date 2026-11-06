/**
 * @feature RUN-01 Run tab
 * Owns: the Run tab body. The action picker with the Run or Stop button and Open button, and the
 * live output of the running action.
 * Behaviour: ui-map.md 3.7, "Run" paragraph; services-map.md 5A.1.3 and 5A.1.4 (concurrent or
 * exclusive run mode). The button's words come from run-button-label.ts.
 * Data: useRunState (actions, running, detectedPorts), useWorkspace (archived check, port and repo
 * id), useRepoConfig (the Preview URLs template), useActions().run, useUrlOpeners.
 * Children: RunToolbar with PreviewUrlMenu, RunEmptyState, terminal/TerminalView for the output.
 * RUN-03: the Open menu lists the Run tab URL, the detected ports and the repository template, and
 * the "Open localhost URL" shortcut (Cmd+Shift+B) opens the first one. Open uses the in-app browser
 * tab when "In-app browser preview" is on, else the system browser. A template entry that is not a
 * valid URL is named in a status line under the toolbar.
 * Must handle: no actions (empty state), loading, the picked action disappearing (falls back to the
 * default), a run starting while setup is running (button says Waiting for setup), a stop that is
 * not confirmed (the error is shown, the retained outcome stays in view, and the button returns to
 * Run), a saved history that could not be read (the reason is shown), a process that exits by itself
 * (output stays, button back to Run again), exclusive mode stopping another workspace's run (the
 * service does it), and an archived workspace.
 * Test first: with one action and no running process the toolbar shows "Run <label>".
 */
import type { RepoId, TerminalId, WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../../app/command-dispatcher.ts";
import { useServices } from "../../../core/context.tsx";
import { useActions, useRepoConfig, useRunState, useWorkspace } from "../../../core/hooks.ts";
import { defaultRunAction } from "../../../core/services/run-scripts.ts";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { TerminalView } from "../../terminal/TerminalView.tsx";
import { useUrlOpeners } from "../open-url.ts";
import { buildPreviewUrls } from "./preview-urls.ts";
import { RunEmptyState } from "./RunEmptyState.tsx";
import { RunToolbar, type RunToolbarProps } from "./RunToolbar.tsx";
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

interface RunPreviewProps
	extends Omit<RunToolbarProps, "urls" | "onOpenUrl" | "defaultUrl" | "onSetDefault"> {
	repoId: RepoId;
	workspaceId: WorkspaceId;
	workspacePort: number;
	runOutputUrl: string | null;
	detectedPorts: readonly number[];
}

/**
 * The toolbar over the repository template, the run output and the detected ports (RUN-03). A
 * template entry that is not a valid URL is named under the toolbar, so a typo does not just
 * remove the URL. Open follows the in-app browser setting through `useUrlOpeners`.
 */
function RunPreview({
	repoId,
	workspaceId,
	workspacePort,
	runOutputUrl,
	detectedPorts,
	...toolbar
}: RunPreviewProps) {
	const config = useRepoConfig(repoId);
	const open = useUrlOpeners(workspaceId);
	const template = config.state === "ready" ? config.data.previewUrlTemplate : null;
	const { urls, problems } = buildPreviewUrls({
		runOutputUrl,
		detectedPorts,
		template,
		workspacePort,
	});

	useCommandHandler("terminal.openLocalhost", "area", () => {
		const target = urls[0];
		if (target === undefined) return false;
		open.preview(target.url);
		return true;
	});

	return (
		<>
			<RunToolbar
				{...toolbar}
				urls={urls}
				onOpenUrl={open.preview}
				defaultUrl={urls[0]?.url ?? null}
			/>
			{[...new Set(problems)].map((problem) => (
				<p
					key={problem}
					role="status"
					className="shrink-0 border-b border-separator px-3 py-2 text-xs text-fg-muted"
				>
					{problem}
				</p>
			))}
		</>
	);
}

export function RunTab({ workspaceId }: RunTabProps) {
	const run = useRunState(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const actions = useActions();
	const navigate = useNavigate();
	const runService = useServices().services.runScripts;
	const storedPhase = useStore(runService.store, (state) => state.phases[workspaceId]);
	const history = useStore(runService.store, (state) => state.history[workspaceId]) ?? [];
	const outcome = useStore(runService.store, (state) => state.outcomes[workspaceId]);
	const historyError = useStore(runService.store, (state) => state.historyError);
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
			if (!result.ok) {
				toastError(
					effect === "stop" || effect === "stop_spotlight"
						? "Couldn't stop the action"
						: "Couldn't run the action",
					result.error,
				);
			}
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
			{outcome === "stop-unconfirmed" ? (
				<p
					role="status"
					className="shrink-0 border-b border-separator px-3 py-2 text-xs text-fg-muted"
				>
					The last action may still be running.
				</p>
			) : historyError !== null ? (
				<p
					role="status"
					className="shrink-0 border-b border-separator px-3 py-2 text-xs text-fg-muted"
				>
					{historyError.message}
				</p>
			) : null}
			<RunPreview
				repoId={workspace.data.repoId}
				workspaceId={workspaceId}
				workspacePort={workspace.data.port}
				runOutputUrl={active?.url ?? null}
				detectedPorts={run.data.detectedPorts.map((entry) => entry.port)}
				actions={available.map((entry) => ({ id: entry.id, label: entry.label }))}
				selectedActionId={selected.id}
				onSelectAction={setSelectedId}
				button={button}
				onButtonClick={click}
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
