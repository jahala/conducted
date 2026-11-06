/**
 * @feature NAV-01 App shell
 * Owns: the window layout under the title bar: a resizable, collapsible left sidebar and the centre area where
 * the current route renders. The workspace route adds its own right panel (see features/workspace/WorkspaceLayout).
 * Behaviour: ui-map.md 1.1 (three regions; the right panel belongs to the workspace route, which holds the
 * horizontal group "right-panel-layout"), 4 (sidebar), 1.3 (status areas), 5.4 (Cmd+A selects only inside text
 * fields, never the whole UI).
 * The sidebar is sized in pixels with Conductor's sizes (default 256, min 192, max 480; ui-dimensions.md 3, in
 * ui/layout-sizes.ts) and keeps its width when the window resizes.
 * Our design choice: the centre has a minimum width so the chat stays usable. The window uses an overlay title
 * bar, so the top 40px of the sidebar is an empty drag strip under the floating window controls. The sidebar's
 * open state and width are kept in the settings table (`left_panel_visible`, `left_panel_width`), in pixels, so
 * a restart restores both. Workspace panel groups keep their own layout through layout-persistence.ts, and the
 * shell removes a workspace's saved layout when the workspace is deleted or archived.
 * Must handle: the saved sidebar state is applied only after the settings have loaded (the shell shows an empty
 * surface until then); collapsed sidebar (the `--shell-left-inset` variable tells headers to leave room for the
 * controls); sidebar and centre fail separately, each inside <NotBuiltYet>, and a route change clears the
 * centre's; the sidebar stays mounted while collapsed so its state survives; a saved layout for panels that no
 * longer exist is ignored; Cmd+A outside an editable field is stopped before it selects the whole UI.
 * Test first: rendering the shell with unbuilt features shows "Not built yet" in the sidebar and still shows the
 * centre empty state.
 */
import type { WorkspaceId } from "@conducted/shared";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../core/context.tsx";
import { useSetting } from "../core/hooks.ts";
import { Sidebar } from "../features/sidebar/Sidebar.tsx";
import { appShellGroupId, centreMinSize, sidebarSize } from "../ui/layout-sizes.ts";
import { NotBuiltYet } from "../ui/not-built-yet.tsx";
import {
	PanelLayoutProvider,
	type PanelLayoutStore,
	ResizableGroup,
	ResizablePanel,
	ResizeHandle,
	usePanelRef,
} from "../ui/resizable.tsx";
import { setCurrentWorkspace, toastError } from "../ui/Toast.tsx";
import { isTextEntry } from "./command-dispatcher.ts";
import {
	clearLayoutsOfClosedWorkspaces,
	loadPanelLayout,
	savePanelLayout,
	saveShellSidebar,
	shellSidebarWidth,
} from "./layout-persistence.ts";
import { ShellControls } from "./ShellControls.tsx";
import { XcodeLicenseNotice } from "./xcode-license-notice.ts";

/**
 * Draws the shell once the saved settings are loaded. The sidebar panel takes its open state and width when it
 * mounts, so mounting it earlier would use the defaults and never apply what the user saved.
 */
export function AppShell() {
	const { settings } = useServices().services;
	const settingsLoaded = useStore(settings.store, (state) => state.loaded);
	if (!settingsLoaded) {
		return <div data-tauri-drag-region className="h-full bg-surface" />;
	}
	return <LoadedShell />;
}

function LoadedShell() {
	const sidebarRef = usePanelRef();
	const { settings, workspace } = useServices().services;
	const savedVisible = useSetting<boolean>("left_panel_visible");
	const [sidebarOpen, setSidebarOpen] = useState(savedVisible);
	const [initialSidebarWidth] = useState(() => shellSidebarWidth(settings));
	const workspaceId = useRouterState({
		select: (state) => {
			for (let index = state.matches.length - 1; index >= 0; index -= 1) {
				const params = state.matches[index]?.params as { workspaceId?: unknown } | undefined;
				if (typeof params?.workspaceId === "string") return params.workspaceId as WorkspaceId;
			}
			return null;
		},
	});
	const routeKey = useRouterState({ select: (state) => state.location.pathname });
	const layoutStore = useMemo<PanelLayoutStore>(
		() => ({
			load: (groupId, knownPanels) => loadPanelLayout(groupId, knownPanels),
			save: (groupId, layout) => savePanelLayout(groupId, layout),
		}),
		[],
	);

	/** Writes the sidebar's state to the settings table. A failed write is shown, not lost. */
	const saveSidebar = (size: { inPixels: number }) => {
		void saveShellSidebar(settings, size).then((saved) => {
			if (!saved.ok) toastError("Couldn't save the sidebar layout", saved.error);
		});
	};

	const persistSidebar = () => {
		const panel = sidebarRef.current;
		if (!panel) return;
		saveSidebar(panel.getSize());
	};

	const toggleSidebar = () => {
		const panel = sidebarRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) {
			const width = shellSidebarWidth(settings);
			panel.resize(`${width}px`);
			saveSidebar({ inPixels: width });
		} else {
			panel.collapse();
			saveSidebar({ inPixels: 0 });
		}
	};

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
			if (event.key.toLowerCase() !== "a") return;
			if (event.target instanceof Element && isTextEntry(event.target)) return;
			event.preventDefault();
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, []);

	useEffect(() => {
		setCurrentWorkspace(workspaceId);
	}, [workspaceId]);

	// A deleted or archived workspace's panel sizes are never read again.
	useEffect(() => clearLayoutsOfClosedWorkspaces(workspace.store), [workspace.store]);

	const style = {
		"--shell-left-inset": sidebarOpen ? "0px" : "var(--shell-controls-width)",
	} as CSSProperties;

	return (
		<div className="relative h-full bg-surface" style={style}>
			<XcodeLicenseNotice />
			<ShellControls sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
			<PanelLayoutProvider store={layoutStore}>
				<ResizableGroup
					id={appShellGroupId}
					orientation="horizontal"
					className="h-full w-full"
					persist={false}
					onLayoutChanged={persistSidebar}
				>
					<ResizablePanel
						id="sidebar"
						panelRef={sidebarRef}
						defaultSize={sidebarOpen ? `${initialSidebarWidth}px` : sidebarSize.collapsed}
						minSize={sidebarSize.min}
						maxSize={sidebarSize.max}
						collapsible
						collapsedSize={sidebarSize.collapsed}
						groupResizeBehavior="preserve-pixel-size"
						onResize={(size) => setSidebarOpen(size.inPixels > 0)}
					>
						<aside aria-label="Sidebar" className="flex h-full min-w-0 flex-col bg-surface">
							<div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
							<div className="min-h-0 flex-1">
								<NotBuiltYet area="Sidebar">
									<Sidebar />
								</NotBuiltYet>
							</div>
						</aside>
					</ResizablePanel>
					<ResizeHandle />
					<ResizablePanel id="main-content" minSize={centreMinSize}>
						<main className="flex h-full min-w-0 flex-col bg-canvas">
							<NotBuiltYet area="Centre" resetKey={routeKey}>
								<Outlet />
							</NotBuiltYet>
						</main>
					</ResizablePanel>
				</ResizableGroup>
			</PanelLayoutProvider>
		</div>
	);
}
