/**
 * @feature RUN-03 Ports tab
 * Owns: the list of local ports the workspace's processes are listening on, with open actions.
 * Behaviour: ui-map.md 3.7 ("Ports" special tab; empty text "No local servers running. Start your
 * dev server and it'll show up here."; "Open localhost URL" Cmd+Shift+B). Port forwarding to a
 * cloud machine is left out.
 * Data: useRunState (detectedPorts), useWorkspace (the workspace's own port), useSetting (in-app
 * browser preview), useActions (system browser, clipboard and app activation), and the run
 * service's port errors.
 * Children: DetectedPortRow.
 * Must handle: no ports (designed empty state), a port that closes while listed (row disappears
 * without flicker), the workspace's reserved port marked, and ports owned by other workspaces
 * (not listed).
 * Test first: with detectedPorts [3000, 5173] two rows render in ascending order.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "zustand";
import { useServices } from "../../../core/context.tsx";
import { useActions, useRunState, useSetting, useWorkspace } from "../../../core/hooks.ts";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { DetectedPortRow } from "./DetectedPortRow.tsx";

export interface PortsTabProps {
	workspaceId: WorkspaceId;
}

export function PortsTab({ workspaceId }: PortsTabProps) {
	const run = useRunState(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const inAppPreview = useSetting<boolean>("experimental_in_app_browser_preview");
	const actions = useActions();
	const navigate = useNavigate();
	const runService = useServices().services.runScripts;
	const portError = useStore(runService.store, (state) => state.portErrors[workspaceId]);

	if (run.state === "loading" || workspace.state === "loading") {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner label="Loading the Ports tab" />
			</div>
		);
	}
	if (run.state === "error") {
		return <EmptyState title="Ports are unavailable" body={run.error.message} tone="failed" />;
	}
	if (workspace.state === "error") {
		return (
			<EmptyState title="Ports are unavailable" body={workspace.error.message} tone="failed" />
		);
	}

	if (portError !== undefined) {
		return <EmptyState title="Ports are unavailable" body={portError.message} tone="failed" />;
	}

	const workspacePort = workspace.data.port;
	const ports = [...run.data.detectedPorts].sort((left, right) => left.port - right.port);

	const openInBrowser = (port: number): void => {
		void (async () => {
			const opened = await actions.app.openUrl(`http://localhost:${port}`);
			if (!opened.ok) toastError("Couldn't open the URL", opened.error);
		})();
	};

	const openInPreview = (port: number): void => {
		if (!inAppPreview) return;
		const url = `http://localhost:${port}`;
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: workspace.data.repoId, workspaceId },
			search: (previous) => ({ ...previous, tab: "browser", browserUrl: url }),
		});
	};

	const copyUrl = (port: number): void => {
		void (async () => {
			const copied = await actions.app.copyText(`http://localhost:${port}`);
			if (!copied.ok) toastError("Couldn't copy the URL", copied.error);
		})();
	};

	const activateApp = (port: number): void => {
		void (async () => {
			const activated = await actions.run.activateApp(workspaceId, port);
			if (!activated.ok) toastError("Couldn't activate the app", activated.error);
		})();
	};

	if (ports.length === 0) {
		return (
			<EmptyState
				title="No local servers running"
				body="Start your dev server and it'll show up here."
			/>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			{ports.map((entry) => (
				<DetectedPortRow
					key={`${entry.pid}:${entry.port}`}
					port={entry.port}
					isWorkspacePort={entry.port === workspacePort}
					inAppPreviewEnabled={Boolean(inAppPreview)}
					processName={entry.processName}
					appName={entry.appName}
					onOpenInBrowser={() => openInBrowser(entry.port)}
					onOpenInPreview={() => openInPreview(entry.port)}
					onCopyUrl={() => copyUrl(entry.port)}
					onActivateApp={entry.appName === null ? undefined : () => activateApp(entry.port)}
				/>
			))}
		</div>
	);
}
