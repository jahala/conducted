/**
 * @feature NAV-12 Zen mode and panel toggles
 * Owns: closing both side panels at once (zen mode), bringing them back to what they were before, and the
 * panel registry the shell's view commands call.
 * Behaviour: ui-map.md 1.1 (left and right panel open state are two settings, toggled by Cmd+B and Cmd+Alt+B;
 * zen mode closes both), 5.4 (view shortcuts: toggle left sidebar, right sidebar, terminal panel, zen mode).
 * Our design choice: each panel registers a small handle while it is mounted, so zen mode reaches the real
 * sidebar, right panel and scripts panel without either panel knowing about the other. The provider owns the
 * zen snapshot and the panel handles; the shell registers Cmd+B, Cmd+Alt+B, Cmd+J and Cmd+. against it.
 * Leaving zen mode restores each panel to its earlier open or closed state, not to "open". Toggling a panel
 * while zen mode is on leaves zen mode first, restores the other panel, and toggles the requested one from its
 * current (closed) state. A screen with no right panel only closes the sidebar.
 * Must handle: no right panel (null right state), no terminal panel, and a panel that unmounts while it is
 * registered.
 * Test first: entering zen mode closes both panels and leaving it reopens only the ones that were open.
 */
import type { ReactNode } from "react";
import {
	createContext,
	createElement,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
/** A panel whose open state zen mode can read and change. */
export interface ShellPanelHandles {
	isSidebarOpen(): boolean;
	setSidebarOpen(open: boolean): void;
	/** Null on screens without a right panel. */
	isRightPanelOpen(): boolean | null;
	setRightPanelOpen(open: boolean): void;
}

/** What the user's panels looked like when zen mode started, so it can put them back. */
export interface ZenModeSnapshot {
	active: boolean;
	leftWasOpen: boolean;
	rightWasOpen: boolean | null;
}

export const zenModeOff: ZenModeSnapshot = {
	active: false,
	leftWasOpen: true,
	rightWasOpen: null,
};

/** Closes both side panels and records which ones were open. */
export function enterZenMode(panels: ShellPanelHandles): ZenModeSnapshot {
	const leftWasOpen = panels.isSidebarOpen();
	const rightWasOpen = panels.isRightPanelOpen();
	panels.setSidebarOpen(false);
	if (rightWasOpen !== null) panels.setRightPanelOpen(false);
	return { active: true, leftWasOpen, rightWasOpen };
}

/** Puts each panel back to the state it had before zen mode started. */
export function leaveZenMode(
	snapshot: ZenModeSnapshot,
	panels: ShellPanelHandles,
): ZenModeSnapshot {
	if (!snapshot.active) return zenModeOff;
	panels.setSidebarOpen(snapshot.leftWasOpen);
	if (snapshot.rightWasOpen !== null) panels.setRightPanelOpen(snapshot.rightWasOpen);
	return zenModeOff;
}

/** Turns zen mode on or off, depending on its current state. */
export function toggleZenMode(
	panels: ShellPanelHandles,
	snapshot: ZenModeSnapshot = zenModeOff,
): ZenModeSnapshot {
	return snapshot.active ? leaveZenMode(snapshot, panels) : enterZenMode(panels);
}

/** One mounted panel as zen mode and the view commands see it. */
export interface ZenPanelHandle {
	isOpen(): boolean;
	setOpen(open: boolean): void;
}

export type ZenPanelSide = "left" | "right" | "terminal";

export interface ZenModeControls {
	/** Registers a panel while it is mounted. Returns the function that removes it. */
	registerPanel(side: ZenPanelSide, handle: ZenPanelHandle): () => void;
	/** Toggles one panel. It leaves zen mode first when zen mode is on. */
	togglePanel(side: ZenPanelSide): void;
	/** Turns zen mode on or off. */
	toggleZen(): void;
	/** The open state a panel starts with, before it has registered. */
	initiallyOpen(side: ZenPanelSide): boolean;
}

const ZenModeContext = createContext<ZenModeControls | null>(null);

/** The controls when a provider is above, or null when a panel is drawn on its own. */
export function useZenModeControls(): ZenModeControls | null {
	return useContext(ZenModeContext);
}

/**
 * Registers a panel with the zen-mode provider while the calling component is mounted. A component drawn
 * without the provider keeps working; it just cannot be reached by the view commands.
 */
export function useZenPanel(side: ZenPanelSide, handle: ZenPanelHandle): void {
	const controls = useContext(ZenModeContext);
	const latest = useRef(handle);
	latest.current = handle;
	useEffect(() => {
		if (controls === null) return;
		return controls.registerPanel(side, {
			isOpen: () => latest.current.isOpen(),
			setOpen: (open) => latest.current.setOpen(open),
		});
	}, [controls, side]);
}

export interface ZenModeProviderProps {
	/** The saved right panel state, used before a workspace registers its right panel. */
	rightInitialOpen?: boolean;
	/** Reports each change the provider makes to the right panel, for the settings table. */
	onRightOpenChange?: (open: boolean) => void;
	children?: ReactNode;
}

/**
 * Holds the zen-mode snapshot and the handles of the mounted panels. It sits above the shell so both the
 * sidebar and the workspace's right panel can register with it.
 */
export function ZenModeProvider({
	rightInitialOpen = true,
	onRightOpenChange,
	children,
}: ZenModeProviderProps) {
	const panels = useRef(new Map<ZenPanelSide, ZenPanelHandle>());
	const zen = useRef<ZenModeSnapshot>(zenModeOff);
	const options = useRef({ rightInitialOpen, onRightOpenChange });
	options.current = { rightInitialOpen, onRightOpenChange };

	const setPanel = useCallback((side: ZenPanelSide, open: boolean): void => {
		const handle = panels.current.get(side);
		if (handle === undefined) return;
		handle.setOpen(open);
		if (side === "right") options.current.onRightOpenChange?.(open);
	}, []);

	const shellHandles = useCallback(
		(): ShellPanelHandles => ({
			isSidebarOpen: () => panels.current.get("left")?.isOpen() ?? false,
			setSidebarOpen: (open) => setPanel("left", open),
			isRightPanelOpen: () => panels.current.get("right")?.isOpen() ?? null,
			setRightPanelOpen: (open) => setPanel("right", open),
		}),
		[setPanel],
	);

	const controls = useMemo<ZenModeControls>(
		() => ({
			registerPanel(side, handle) {
				panels.current.set(side, handle);
				return () => {
					if (panels.current.get(side) === handle) panels.current.delete(side);
				};
			},
			togglePanel(side) {
				if (zen.current.active) {
					const snapshot = zen.current;
					zen.current = zenModeOff;
					if (side !== "left") setPanel("left", snapshot.leftWasOpen);
					if (side !== "right" && snapshot.rightWasOpen !== null) {
						setPanel("right", snapshot.rightWasOpen);
					}
				}
				const handle = panels.current.get(side);
				if (handle === undefined) return;
				setPanel(side, !handle.isOpen());
			},
			toggleZen() {
				zen.current = toggleZenMode(shellHandles(), zen.current);
			},
			initiallyOpen(side) {
				return side === "right" ? options.current.rightInitialOpen : true;
			},
		}),
		[setPanel, shellHandles],
	);

	return createElement(ZenModeContext.Provider, { value: controls }, children);
}
