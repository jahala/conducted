/**
 * @feature NAV-12 Zen mode and panel toggles
 * Owns: closing both side panels at once (zen mode) and bringing them back to what they were before.
 * Behaviour: ui-map.md 1.1 (left and right panel open state are two settings, toggled by Cmd+B and Cmd+Alt+B;
 * zen mode closes both), 5.4 (view shortcuts: toggle left sidebar, right sidebar, terminal panel, zen mode).
 * Our design choice: the toggle buttons already work through each panel's own handle (AppShell for the sidebar,
 * WorkspaceLayout for the right panel). This file adds the shared part: zen mode, and the commands that the
 * command registry (NAV-07) binds to the shortcuts.
 * Must handle: leaving zen mode restores each panel to its earlier open or closed state, not to "open";
 * zen mode on a screen without a right panel only closes the sidebar; toggling a panel while in zen mode leaves
 * zen mode.
 * Test first: entering zen mode closes both panels and leaving it reopens only the ones that were open.
 */
import { notImplemented } from "@conducted/shared";

export interface ShellPanelHandles {
	isSidebarOpen(): boolean;
	setSidebarOpen(open: boolean): void;
	/** Null on screens without a right panel. */
	isRightPanelOpen(): boolean | null;
	setRightPanelOpen(open: boolean): void;
}

export function toggleZenMode(_panels: ShellPanelHandles): void {
	notImplemented("NAV-12");
}
