/**
 * @feature NAV-01 Window controls
 * Owns: the three buttons at the top left of the window, next to the macOS traffic lights: show or hide the
 * left sidebar, go back, go forward.
 * Behaviour: ui-map.md 1.1 (the toggle buttons shift right of the traffic lights by a CSS variable), 4 item 1
 * ("Toggle left sidebar", "Go back", "Go forward").
 * Our design choice: the buttons float over the window at a fixed spot, so they stay in place when the sidebar
 * closes. Headers that can reach the left edge start with <TitleBarInset> to stay clear of them.
 * Must handle: back is disabled at the start of history; the toggle label says what a click does; the cluster is
 * a window drag region, the buttons themselves are not.
 * Test first: the sidebar button is named "Hide sidebar" while open and "Show sidebar" while closed.
 */
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { IconButton } from "../ui/IconButton.tsx";
import { ArrowLeftIcon, ArrowRightIcon, SidebarLeftIcon } from "../ui/icons.tsx";

export interface ShellControlsProps {
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
}

export function ShellControls({ sidebarOpen, onToggleSidebar }: ShellControlsProps) {
	const router = useRouter();
	const canGoBack = useCanGoBack();
	return (
		<div
			data-tauri-drag-region
			className="absolute left-0 top-0 z-30 flex h-(--titlebar-height) items-center gap-0.5 pl-(--traffic-lights-clearance)"
		>
			<IconButton
				label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
				icon={<SidebarLeftIcon />}
				onClick={onToggleSidebar}
			/>
			<IconButton
				label="Go back"
				icon={<ArrowLeftIcon />}
				disabled={!canGoBack}
				onClick={() => router.history.back()}
			/>
			<IconButton
				label="Go forward"
				icon={<ArrowRightIcon />}
				onClick={() => router.history.forward()}
			/>
		</div>
	);
}
