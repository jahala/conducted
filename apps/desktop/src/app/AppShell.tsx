/**
 * @feature NAV-01 App shell
 * Owns: the window layout under the title bar: a resizable, collapsible left sidebar and the centre area where
 * the current route renders. The workspace route adds its own right panel (see features/workspace/WorkspaceLayout).
 * Behaviour: ui-map.md 1.1 (three regions; the right panel belongs to the workspace route, which holds the
 * horizontal group "right-panel-layout"), 4 (sidebar), 1.3 (status areas).
 * Our design choice: the sidebar is sized in pixels (default 280, min 220, max 420) and keeps its width when the
 * window resizes. The centre has a minimum width so the chat stays usable. The window uses an overlay title bar,
 * so the top 44px of the sidebar is an empty drag strip under the floating window controls.
 * Must handle: collapsed sidebar (the `--shell-left-inset` variable tells headers to leave room for the
 * controls); sidebar and centre fail separately, each inside <NotBuiltYet>; the sidebar stays mounted while
 * collapsed so its state survives; panel sizes are not yet saved (layout-persistence.ts, NAV-01).
 * Test first: rendering the shell with unbuilt features shows "Not built yet" in the sidebar and still shows the
 * centre empty state.
 */
import { Outlet } from "@tanstack/react-router";
import { type CSSProperties, useState } from "react";
import { Sidebar } from "../features/sidebar/Sidebar.tsx";
import { NotBuiltYet } from "../ui/not-built-yet.tsx";
import { ResizableGroup, ResizablePanel, ResizeHandle, usePanelRef } from "../ui/resizable.tsx";
import { ShellControls } from "./ShellControls.tsx";

export function AppShell() {
	const sidebarRef = usePanelRef();
	const [sidebarOpen, setSidebarOpen] = useState(true);

	const toggleSidebar = () => {
		const panel = sidebarRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) panel.expand();
		else panel.collapse();
	};

	const style = {
		"--shell-left-inset": sidebarOpen ? "0px" : "var(--shell-controls-width)",
	} as CSSProperties;

	return (
		<div className="relative h-full bg-surface" style={style}>
			<ShellControls sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
			<ResizableGroup id="app-shell" orientation="horizontal" className="h-full w-full">
				<ResizablePanel
					id="sidebar"
					panelRef={sidebarRef}
					defaultSize="280px"
					minSize="220px"
					maxSize="420px"
					collapsible
					collapsedSize="0px"
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
				<ResizablePanel id="main-content" minSize="480px">
					<main className="flex h-full min-w-0 flex-col bg-canvas">
						<Outlet />
					</main>
				</ResizablePanel>
			</ResizableGroup>
		</div>
	);
}
