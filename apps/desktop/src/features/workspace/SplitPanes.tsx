/**
 * @feature NAV-10 Split panes
 * Owns: The centre as a tree of tab groups, so tabs can sit side by side or stacked.
 * Behaviour: ui-map.md 3.2 (with the setting 'Split tabs' the strip becomes a tree of groups; tabs
 * drag between groups or to an edge to split; Cmd+D splits the current tab).
 * Our design choice: Off by default, behind the experimental setting, as in Conductor. The pure
 * tree is in tab-layout.ts. With the setting off the centre is one group and costs nothing. The
 * second group is shown beside the first; the tab is copied there rather than removed, because the
 * open chats and terminals still come from their own stores.
 * Must handle: Dropping a tab on the centre opens it in a second group; Cmd+D splits the current
 * tab; closing the split returns to one group; a workspace with the setting off ignores any split.
 * Test first: Dropping a tab on the right edge of a group makes two groups with the tab alone in
 * the new one.
 */
import type { CommentId, WorkspaceId } from "@conducted/shared";
import type { DragEvent } from "react";
import { useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useSessions, useSetting, useTerminals, useWorkspace } from "../../core/hooks.ts";
import { CloseIcon } from "../../ui/icons.tsx";
import { type ActiveTab, resolveActiveTab } from "./active-tab.ts";
import { TabContent } from "./TabContent.tsx";
import { TabItem } from "./TabItem.tsx";
import { buildTabs, TabStrip } from "./TabStrip.tsx";
import { applyTabAction, listGroups, type TabDescriptor, type TabGroupNode } from "./tab-layout.ts";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface SplitPanesProps {
	workspaceId: WorkspaceId;
	search: WorkspaceSearch;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

const DRAG_TYPE = "application/x-conducted-tab";

function activeFromDescriptor(tab: TabDescriptor): ActiveTab {
	switch (tab.kind) {
		case "session":
			return tab.sessionId === undefined
				? { kind: "none" }
				: { kind: "session", sessionId: tab.sessionId };
		case "terminal":
			return tab.terminalId === undefined
				? { kind: "none" }
				: { kind: "terminal", terminalId: tab.terminalId };
		case "file":
			return {
				kind: "file",
				path: tab.ref.slice("file:".length),
				mode: "diff",
				scope: { kind: "branch" },
				line: null,
			};
		case "comment":
			return { kind: "comment", commentId: tab.ref.slice("comment:".length) as CommentId };
		case "pr":
			return { kind: "pr" };
		case "browser":
			return { kind: "browser", url: tab.ref.slice("browser:".length) };
	}
}

function refOf(active: ActiveTab): string | null {
	switch (active.kind) {
		case "session":
			return `session:${active.sessionId}`;
		case "terminal":
			return `terminal:${active.terminalId}`;
		case "file":
			return `file:${active.path}`;
		case "comment":
			return `comment:${active.commentId}`;
		case "pr":
			return "pr";
		case "browser":
			return `browser:${active.url}`;
		case "none":
			return null;
	}
}

export function SplitPanes({ workspaceId, search, onSearchChange }: SplitPanesProps) {
	const splitEnabled = useSetting<boolean>("experimental_configurable_center_panel");
	const sessions = useSessions(workspaceId);
	const terminals = useTerminals(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const [layout, setLayout] = useState<TabGroupNode | null>(null);

	const tabs = buildTabs({
		sessions: sessions.state === "ready" ? sessions.data : [],
		terminals: terminals.state === "ready" ? terminals.data : [],
		search,
		prNumber: workspace.state === "ready" ? workspace.data.prNumber : null,
	});

	const activeRef = refOf(resolveActiveTab(search));
	const active = tabs.find((tab) => tab.ref === activeRef) ?? null;
	const splitTab =
		layout === null
			? null
			: (listGroups(layout).find((group) => group.id !== "group-main" && group.tabs.length > 0)
					?.tabs[0] ?? null);

	const split = (tab: TabDescriptor) => {
		const base: TabGroupNode = { kind: "group", id: "group-main", tabs, activeRef };
		setLayout(
			applyTabAction({
				layout: base,
				action: { type: "split", ref: tab.ref, groupId: "group-main", edge: "right" },
			}),
		);
	};

	useCommandHandler("tab.split", "base", () => {
		if (!splitEnabled || active === null) return false;
		split(active);
		return true;
	});

	const drop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		const ref = event.dataTransfer.getData(DRAG_TYPE);
		const tab = tabs.find((candidate) => candidate.ref === ref);
		if (tab === undefined) return;
		split(tab);
	};

	const centre = (
		<div className="flex h-full min-h-0 flex-col">
			<TabStrip workspaceId={workspaceId} search={search} onSearchChange={onSearchChange} />
			<div className="min-h-0 flex-1">
				<TabContent workspaceId={workspaceId} search={search} onSearchChange={onSearchChange} />
			</div>
		</div>
	);

	if (!splitEnabled) return centre;

	return (
		<div className="flex h-full min-h-0 w-full">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: the whole group is the drop target for a tab dragged from its strip. */}
			<div
				data-testid="split-centre"
				className="flex min-w-0 flex-1"
				onDragOver={(event) => {
					if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault();
				}}
				onDrop={drop}
			>
				{centre}
			</div>
			{splitTab === null ? null : (
				<section
					aria-label={`Split pane: ${splitTab.title}`}
					className="flex min-w-0 flex-1 flex-col border-l border-separator"
				>
					<div className="flex h-10 shrink-0 items-center gap-1 border-b border-separator bg-surface px-2">
						<TabItem tab={splitTab} active onSelect={() => {}} onClose={() => setLayout(null)} />
						<button
							type="button"
							aria-label="Close split pane"
							onClick={() => setLayout(null)}
							className="flex size-5 items-center justify-center rounded-sm text-fg-subtle hover:bg-active hover:text-fg"
						>
							<CloseIcon />
						</button>
					</div>
					<div className="min-h-0 flex-1">
						<TabContent
							workspaceId={workspaceId}
							search={search}
							onSearchChange={onSearchChange}
							tab={activeFromDescriptor(splitTab)}
						/>
					</div>
				</section>
			)}
		</div>
	);
}
