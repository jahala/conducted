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
 * bar, so the top 40px of the sidebar is an empty drag strip under the floating window controls. The shell's
 * panel sizes are saved under `app-shell` and restored on the next launch.
 * Must handle: collapsed sidebar (the `--shell-left-inset` variable tells headers to leave room for the
 * controls); sidebar and centre fail separately, each inside <NotBuiltYet>; the sidebar stays mounted while
 * collapsed so its state survives; a saved layout for panels that no longer exist is ignored; Cmd+A outside an
 * editable field is stopped before it selects the whole UI.
 * Test first: rendering the shell with unbuilt features shows "Not built yet" in the sidebar and still shows the
 * centre empty state.
 */
import type { WorkspaceId } from "@conducted/shared";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
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
import { setCurrentWorkspace } from "../ui/Toast.tsx";
import { loadPanelLayout, savePanelLayout } from "./layout-persistence.ts";
import { ShellControls } from "./ShellControls.tsx";

const APP_SHELL_PANELS = ["sidebar", "main-content"] as const;

const NON_TEXT_INPUT_TYPES = new Set([
	"button",
	"checkbox",
	"color",
	"file",
	"hidden",
	"image",
	"radio",
	"range",
	"reset",
	"submit",
]);

/** True when the key event belongs to a field that should keep its own select-all. */
function isTextEntry(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const field = target.closest("input, textarea, [contenteditable]");
	if (field === null) return false;
	if (field instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(field.type);
	if (field.getAttribute("contenteditable") === "false") return false;
	return true;
}

export function AppShell() {
	const sidebarRef = usePanelRef();
	const savedLayout = useMemo(() => loadPanelLayout(appShellGroupId, APP_SHELL_PANELS), []);
	const [sidebarOpen, setSidebarOpen] = useState(() => (savedLayout?.sidebar ?? 1) > 0);
	const workspaceId = useRouterState({
		select: (state) => {
			for (let index = state.matches.length - 1; index >= 0; index -= 1) {
				const params = state.matches[index]?.params as { workspaceId?: unknown } | undefined;
				if (typeof params?.workspaceId === "string") return params.workspaceId as WorkspaceId;
			}
			return null;
		},
	});
	const layoutStore = useMemo<PanelLayoutStore>(
		() => ({
			load: (groupId) => loadPanelLayout(groupId),
			save: (groupId, layout) => savePanelLayout(groupId, layout),
		}),
		[],
	);

	const toggleSidebar = () => {
		const panel = sidebarRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) panel.expand();
		else panel.collapse();
	};

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
			if (event.key.toLowerCase() !== "a") return;
			if (isTextEntry(event.target)) return;
			event.preventDefault();
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, []);

	useEffect(() => {
		setCurrentWorkspace(workspaceId);
	}, [workspaceId]);

	const style = {
		"--shell-left-inset": sidebarOpen ? "0px" : "var(--shell-controls-width)",
	} as CSSProperties;

	return (
		<div className="relative h-full bg-surface" style={style}>
			<ShellControls sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
			<PanelLayoutProvider store={layoutStore}>
				<ResizableGroup id={appShellGroupId} orientation="horizontal" className="h-full w-full">
					<ResizablePanel
						id="sidebar"
						panelRef={sidebarRef}
						defaultSize={sidebarSize.default}
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
							<Outlet />
						</main>
					</ResizablePanel>
				</ResizableGroup>
			</PanelLayoutProvider>
		</div>
	);
}
