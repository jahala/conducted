/**
 * @feature NAV-10 Workspace layout
 * Owns: the workspace screen's frame: the header row, the centre content, and the right panel with the Git
 * panel over the Scripts panel. The header, centre and panels are slots, so each can fail on its own.
 * Behaviour: ui-map.md 1.1 (horizontal group "right-panel-layout": main-content default 70, min 30; right-panel
 * default 35, min 30, collapsible; right panel is a vertical group "workspace-right-panels-<localId>": git-panel
 * default 50, min 0, over scripts-panel default 50, min 20, collapsible).
 * Our design choice: sizes are 65/35 so they add up to 100. The group ids carry the workspace id so each
 * workspace can keep its own layout once sizes are saved (layout-persistence.ts, NAV-01). The group is keyed by
 * the workspace id so switching workspaces gives a fresh layout state. The centre owns its tab strip, so the
 * frame does not need a separate strip slot.
 * The header slot sits in a title-bar-height row that is a window drag region and starts with the title bar
 * inset, so the header component only fills the row.
 * Must handle: right panel collapsed (the header's toggle button reopens it; the header receives
 * `rightPanelOpen` and `toggleRightPanel`); the right panel and scripts panel starting collapsed from their
 * saved state; the scripts panel collapsing to its 32px tab row (ui/layout-sizes.ts). The right and scripts
 * panels register with app/zen-mode.ts, so Cmd+Alt+B, Cmd+J and zen mode reach them, and the right panel
 * reports each change of its open state there (a divider drag too), which the shell saves. A window narrower
 * than both minimums is left to the resizable group.
 * Test first: renders all three slots; toggleRightPanel hides and shows the right panel.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type ReactNode, useEffect, useState } from "react";
import { useZenModeControls, useZenPanel } from "../../app/zen-mode.ts";
import {
	scriptsPanelCollapsedSize,
	workspaceLayoutGroupId,
	workspaceRightPanelsGroupId,
} from "../../ui/layout-sizes.ts";
import { ResizableGroup, ResizablePanel, ResizeHandle, usePanelRef } from "../../ui/resizable.tsx";
import { TitleBarInset } from "../../ui/TitleBarInset.tsx";

export interface RightPanelControls {
	rightPanelOpen: boolean;
	toggleRightPanel: () => void;
}

export interface WorkspaceLayoutProps {
	workspaceId: WorkspaceId;
	header: (controls: RightPanelControls) => ReactNode;
	content: ReactNode;
	gitPanel: ReactNode;
	scriptsPanel: ReactNode;
}

export function WorkspaceLayout({
	workspaceId,
	header,
	content,
	gitPanel,
	scriptsPanel,
}: WorkspaceLayoutProps) {
	const rightRef = usePanelRef();
	const scriptsRef = usePanelRef();
	const zen = useZenModeControls();
	const [initialRightOpen] = useState(() => zen?.initiallyOpen("right") ?? true);
	const [rightPanelOpen, setRightPanelOpen] = useState(initialRightOpen);
	const [scriptsPanelOpen, setScriptsPanelOpen] = useState(true);

	useEffect(() => {
		if (initialRightOpen) return;
		rightRef.current?.collapse();
	}, [initialRightOpen, rightRef]);

	const rightPanelIsOpen = () => rightPanelOpen;

	const applyRightOpen = (open: boolean) => {
		setRightPanelOpen(open);
		const panel = rightRef.current;
		if (panel === null) return;
		if (open && panel.isCollapsed()) panel.expand();
		else if (!open && !panel.isCollapsed()) panel.collapse();
	};

	const toggleRightPanel = () => {
		if (zen !== null) {
			zen.togglePanel("right");
			return;
		}
		applyRightOpen(!rightPanelIsOpen());
	};

	const applyScriptsOpen = (open: boolean) => {
		setScriptsPanelOpen(open);
		const panel = scriptsRef.current;
		if (panel === null) return;
		if (open && panel.isCollapsed()) panel.expand();
		else if (!open && !panel.isCollapsed()) panel.collapse();
	};

	useZenPanel("right", { isOpen: rightPanelIsOpen, setOpen: applyRightOpen });
	// Every change of the right panel's open state is reported, a divider drag included, so the
	// shell saves what the screen shows.
	useEffect(() => {
		zen?.panelOpenChanged("right", rightPanelOpen);
	}, [zen, rightPanelOpen]);
	useZenPanel("terminal", {
		isOpen: () => scriptsPanelOpen,
		setOpen: applyScriptsOpen,
	});

	return (
		<ResizableGroup
			key={workspaceId}
			id={workspaceLayoutGroupId(workspaceId)}
			orientation="horizontal"
			className="h-full w-full"
		>
			<ResizablePanel id="main-content" defaultSize="65%" minSize="30%">
				<div className="flex h-full min-w-0 flex-col">
					<div
						data-tauri-drag-region
						className="flex h-(--titlebar-height) shrink-0 items-center border-b border-border"
					>
						<TitleBarInset />
						<div className="min-w-0 flex-1">{header({ rightPanelOpen, toggleRightPanel })}</div>
					</div>
					<div className="min-h-0 flex-1">{content}</div>
				</div>
			</ResizablePanel>
			<ResizeHandle />
			<ResizablePanel
				id="right-panel"
				panelRef={rightRef}
				defaultSize={initialRightOpen ? "35%" : "0%"}
				minSize="30%"
				collapsible
				collapsedSize="0%"
				onResize={(size) => setRightPanelOpen(size.inPixels > 0)}
			>
				<aside
					aria-label="Changes and scripts"
					data-right-panel-open={rightPanelOpen}
					className="h-full bg-surface"
				>
					<ResizableGroup
						id={workspaceRightPanelsGroupId(workspaceId)}
						orientation="vertical"
						className="h-full w-full"
					>
						<ResizablePanel id="git-panel" defaultSize="50%" minSize="15%">
							<div className="h-full min-h-0">{gitPanel}</div>
						</ResizablePanel>
						<ResizeHandle />
						<ResizablePanel
							id="scripts-panel"
							panelRef={scriptsRef}
							defaultSize="50%"
							minSize="20%"
							collapsible
							collapsedSize={scriptsPanelCollapsedSize}
							onResize={(size) =>
								setScriptsPanelOpen(size.inPixels > Number.parseFloat(scriptsPanelCollapsedSize))
							}
						>
							<div className="h-full min-h-0" data-scripts-panel-open={scriptsPanelOpen}>
								{scriptsPanel}
							</div>
						</ResizablePanel>
					</ResizableGroup>
				</aside>
			</ResizablePanel>
		</ResizableGroup>
	);
}
