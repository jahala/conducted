/**
 * @feature RUN-01 Run tab
 * Owns: the Run tab body. The action picker with the Run or Stop button and Open button, and the
 * live output of the running action.
 * Behaviour: ui-map.md 3.7, "Run" paragraph; services-map.md 5A.1.3 and 5A.1.4 (concurrent or
 * exclusive run mode). The button's words come from run-button-label.ts.
 * Data: useRunState (actions, running), useWorkspace (archived check, port and repo id),
 * useRepoConfig (the ordered Preview URLs list), useActions().run, useUrlOpeners.
 * Children: RunToolbar with PreviewUrlMenu, RunEmptyState, and the output's RunTerminalSlot: the app
 * shell's surface layer draws the terminal over it, so it stays mounted across workspace switches and
 * the workspace's last output shows again (NAV-15, app/surface-registry.tsx).
 * CLOUD-09: in a cloud workspace an action that can run in both places appears twice, under the
 * "Cloud" and "Local" groups, and the cloud variant is the default (services-map 5A.1.6).
 * RUN-03: the Open menu lists the repository's Preview URLs in order (the first is Open). When
 * none are set, it lists the run-output URL instead; detected ports are on the Ports tab, not
 * here. The "Open localhost URL" shortcut (Cmd+Shift+B) opens the first URL. Open uses the in-app
 * browser tab when "In-app browser preview" is on, else the system browser. A template entry that
 * is not a valid URL is named in a status line under the toolbar.
 * Must handle: no actions (empty state), loading, the picked action disappearing (falls back to the
 * default), a run starting while setup is running (button says Waiting for setup), a stop that is
 * not confirmed (the error is shown, the retained outcome stays in view, and the button returns to
 * Run), a saved history that could not be read (the reason is shown), a process that exits by itself
 * (output stays, button back to Run again), exclusive mode stopping another workspace's run (the
 * service does it), and an archived workspace.
 * RUN-02: with "Use spotlight testing" on, the list has the synthetic Spotlight entry and it is
 * picked first, so the button reads "Start spotlight" or "Stop spotlight"; while Spotlight runs a
 * line says the root's branch points at the workspace's changes, and a failed restore of the root
 * is named in a line above the toolbar.
 * Test first: with one action and no running process the toolbar shows "Run <label>".
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../../app/command-dispatcher.ts";
import { RunTerminalSlot, useRunSurfaceTerminal } from "../../../app/surface-registry.tsx";
import { useServices } from "../../../core/context.tsx";
import { PREVIEW_MIRROR_UNAVAILABLE_MESSAGE } from "../../../core/file-sync-view.ts";
import { useActions, useRepoConfig, useRunState, useWorkspace } from "../../../core/hooks.ts";
import { defaultRunAction } from "../../../core/run-scripts.ts";
import { SPOTLIGHT_ACTION_ID, SPOTLIGHT_BRANCH_NOTICE } from "../../../core/spotlight.ts";
import { isArchivedWorkspace } from "../../../core/status/archived.ts";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
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
	/** True when the picked action is a cloud workspace's Local variant (CLOUD-11). */
	localVariant: boolean;
}

/**
 * The toolbar over the repository's Preview URLs, or the run-output URL when none are set
 * (RUN-03). A template entry that is not a valid URL is named under the toolbar, so a typo does
 * not just remove the URL. Open follows the in-app browser setting through `useUrlOpeners`.
 */
function RunPreview({
	repoId,
	workspaceId,
	workspacePort,
	runOutputUrl,
	localVariant,
	...toolbar
}: RunPreviewProps) {
	const config = useRepoConfig(repoId);
	const open = useUrlOpeners(workspaceId);
	const cloudFileSync = useServices().services.cloudFileSync;
	const openPreview = (url: string): void => {
		void (async () => {
			if (localVariant && !(await cloudFileSync.mirrorReady(workspaceId))) {
				toast(PREVIEW_MIRROR_UNAVAILABLE_MESSAGE);
				return;
			}
			open.preview(url);
		})();
	};
	const templates = config.state === "ready" ? config.data.previewUrls : [];
	const { urls, problems } = buildPreviewUrls({
		runOutputUrl,
		templates,
		workspacePort,
	});

	useCommandHandler("terminal.openLocalhost", "area", () => {
		const target = urls[0];
		if (target === undefined) return false;
		openPreview(target.url);
		return true;
	});

	return (
		<>
			<RunToolbar
				{...toolbar}
				urls={urls}
				onOpenUrl={openPreview}
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
	const services = useServices().services;
	const runService = services.runScripts;
	const storedPhase = useStore(runService.store, (state) => state.phases[workspaceId]);
	const history = useStore(runService.store, (state) => state.history[workspaceId]) ?? [];
	const outcome = useStore(runService.store, (state) => state.outcomes[workspaceId]);
	const historyError = useStore(runService.store, (state) => state.historyError);
	const spotlightProblem = useStore(
		services.spotlight.store,
		(state) => state.problems[workspaceId],
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [spotlightBusy, setSpotlightBusy] = useState(false);
	const lastRunTerminal = useRunSurfaceTerminal(workspaceId);

	const available = run.state === "ready" ? run.data.actions.filter((entry) => !entry.hidden) : [];
	// With "Use spotlight testing" on, Spotlight replaces Run, so its entry is picked first.
	const spotlightEntry = available.find((entry) => entry.id === SPOTLIGHT_ACTION_ID);
	const selected =
		available.find((entry) => entry.id === selectedId) ??
		spotlightEntry ??
		defaultRunAction(available) ??
		available[0] ??
		null;
	const isSpotlight = selected?.id === SPOTLIGHT_ACTION_ID;
	const spotlight =
		run.state === "ready" ? run.data.spotlight : { active: false, terminalId: null };
	const running = run.state === "ready" ? run.data.running : [];
	const active = running.find((entry) => entry.actionId === selected?.id) ?? running[0];
	// While a Spotlight start or stop runs, the button is disabled, so a second press cannot
	// restart it.
	const spotlightPhase: RunPhase = spotlightBusy
		? spotlight.active
			? "stopping"
			: "starting"
		: spotlight.active
			? "running"
			: "stopped";
	const phase: RunPhase = isSpotlight
		? spotlightPhase
		: phaseFor(storedPhase ?? "stopped", active?.actionId ?? null, selected?.id ?? null);
	const button = runButtonModel(
		{ id: selected?.id ?? "", label: selected?.label ?? "", isSpotlight },
		phase,
		selected === null ? false : history.includes(selected.id),
	);
	const outputTerminal = isSpotlight ? spotlight.terminalId : (active?.terminalId ?? null);
	// The output stays after the process ends, and after a workspace switch: the shell's surface
	// registry keeps the workspace's last run terminal (NAV-15).
	const shownTerminal = outputTerminal ?? lastRunTerminal;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new workspace starts on its default action.
	useEffect(() => {
		setSelectedId(null);
	}, [workspaceId]);

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
			const forSpotlight = effect === "start_spotlight" || effect === "stop_spotlight";
			if (forSpotlight) setSpotlightBusy(true);
			const result =
				effect === "start"
					? await actions.run.start(workspaceId, actionId)
					: effect === "stop"
						? await actions.run.stop(workspaceId, actionId)
						: effect === "start_spotlight"
							? await actions.run.startSpotlight(workspaceId)
							: await actions.run.stopSpotlight(workspaceId);
			if (forSpotlight) setSpotlightBusy(false);
			if (!result.ok) {
				const title =
					effect === "start_spotlight"
						? "Couldn't start Spotlight"
						: effect === "stop_spotlight"
							? "Couldn't stop Spotlight"
							: effect === "stop"
								? "Couldn't stop the action"
								: "Couldn't run the action";
				toastError(title, result.error);
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
	if (isArchivedWorkspace(workspace.data) || workspace.data.state === "archiving") {
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
			{spotlightProblem !== undefined ? (
				<p
					role="status"
					className="shrink-0 border-b border-separator px-3 py-2 text-xs text-warning"
				>
					{spotlightProblem.message}
				</p>
			) : null}
			{spotlight.active ? (
				<p
					role="status"
					className="shrink-0 border-b border-separator px-3 py-2 text-xs text-fg-muted"
				>
					{SPOTLIGHT_BRANCH_NOTICE}
				</p>
			) : null}
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
				localVariant={selected.runAvailability === "local" && workspace.data.host.kind === "cloud"}
				actions={available.map((entry) => ({
					id: entry.id,
					label: entry.label,
					// A cloud workspace groups the action's cloud and local-mirror variants (CLOUD-09).
					...(workspace.data.host.kind === "cloud" && entry.runAvailability !== undefined
						? { group: entry.runAvailability === "cloud" ? "Cloud" : "Local" }
						: {}),
				}))}
				selectedActionId={selected.id}
				onSelectAction={setSelectedId}
				button={button}
				onButtonClick={click}
			/>
			<div className="min-h-0 flex-1">
				{shownTerminal === null ? (
					<div className="flex h-full items-center justify-center px-6 text-center">
						<p className="text-sm text-fg-muted">
							{phase === "waiting_for_setup"
								? "Waiting for the setup script to finish."
								: "Run output appears here."}
						</p>
					</div>
				) : (
					<RunTerminalSlot workspaceId={workspaceId} terminalId={shownTerminal} />
				)}
			</div>
		</div>
	);
}
