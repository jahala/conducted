/**
 * @feature NAV-10 Split panes
 * Owns: The centre as a tree of tab groups, so tabs can sit side by side or stacked.
 * Behaviour: ui-map.md 3.2 (with the setting 'Split tabs' the strip becomes a tree of groups; tabs
 * drag between groups or to an edge to split; Cmd+D splits the current tab; a drag ghost follows
 * the cursor).
 * Our design choice: Off by default, behind the experimental setting, as in Conductor. The pure
 * tree is in tab-layout.ts. The split panes read their tabs from the live chat and terminal stores,
 * so closing a chat removes its pane. The tabs a split pane owns are left out of the main strip.
 * Splitting the active tab moves the URL to its neighbour. A tab dropped on another group's strip
 * moves there; a tab dropped on a group's content splits that group at the nearest edge.
 * Must handle: dropping on any edge (left, right, top, bottom); Cmd+D with fewer than two tabs
 * refuses without claiming the command; closing the split returns to one group; a workspace with
 * the setting off ignores any split; switching workspaces clears the split.
 * Test first: Dropping a tab on the right edge of a group makes two groups with the tab alone in
 * the new one.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useSessions, useSetting, useTerminals, useWorkspace } from "../../core/hooks.ts";
import type { DiffComment } from "../../core/model.ts";
import { CloseIcon } from "../../ui/icons.tsx";
import { activeTabFromDescriptor, resolveActiveTab, searchPatchFor, tabRef } from "./active-tab.ts";
import { TabContent } from "./TabContent.tsx";
import { TabItem } from "./TabItem.tsx";
import { buildTabs, TabStrip } from "./TabStrip.tsx";
import {
	activeTabOf,
	applyTabAction,
	closeGroup,
	findTabGroup,
	listGroups,
	neighbourAfterClose,
	pruneLayout,
	type TabDescriptor,
	type TabGroup,
	type TabGroupNode,
	withGroup,
} from "./tab-layout.ts";
import { NewTabProvider } from "./useNewTab.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface SplitPanesProps {
	workspaceId: WorkspaceId;
	search: WorkspaceSearch;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

type Edge = "left" | "right" | "top" | "bottom";
type DragSource = "application/x-conducted-tab";

const DRAG_TYPE: DragSource = "application/x-conducted-tab";
const MAIN_GROUP = "group-main";
const NO_COMMENTS: readonly DiffComment[] = [];

function isDrag(event: DragEvent<HTMLDivElement>): boolean {
	return event.dataTransfer.types.includes(DRAG_TYPE);
}

/** The nearest edge of the drop target, or right when the target has no measured size. */
export function edgeFromEvent(event: DragEvent<HTMLElement>): Edge {
	const rect = event.currentTarget.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return "right";
	const x = (event.clientX - rect.left) / rect.width;
	const y = (event.clientY - rect.top) / rect.height;
	const distances: { edge: Edge; distance: number }[] = [
		{ edge: "left", distance: x },
		{ edge: "right", distance: 1 - x },
		{ edge: "top", distance: y },
		{ edge: "bottom", distance: 1 - y },
	];
	distances.sort((left, right) => left.distance - right.distance);
	return distances[0]?.edge ?? "right";
}

export function SplitPanes({ workspaceId, search, onSearchChange }: SplitPanesProps) {
	const splitEnabled = useSetting<boolean>("experimental_configurable_center_panel");
	const services = useServices();
	const sessions = useSessions(workspaceId);
	const terminals = useTerminals(workspaceId);
	const workspace = useWorkspace(workspaceId);
	const liveStates = useStore(services.services.sessions.store, (state) => state.liveStates);
	const cancelling = useStore(services.services.sessions.store, (state) => state.cancelling);
	const comments = useStore(
		services.services.review.store,
		(state) => state.byWorkspace[workspaceId] ?? NO_COMMENTS,
	);
	const [layout, setLayout] = useState<TabGroupNode | null>(null);
	const previousWorkspace = useRef(workspaceId);

	useEffect(() => {
		if (previousWorkspace.current === workspaceId) return;
		previousWorkspace.current = workspaceId;
		setLayout(null);
	}, [workspaceId]);

	const tabs = buildTabs({
		sessions: sessions.state === "ready" ? sessions.data : [],
		terminals: terminals.state === "ready" ? terminals.data : [],
		search,
		prNumber: workspace.state === "ready" ? workspace.data.prNumber : null,
		comments,
		liveStates,
		cancelling,
	});

	const activeRef = tabRef(resolveActiveTab(search));
	const active = tabs.find((tab) => tab.ref === activeRef) ?? null;
	// Chats and terminals come from their stores. A file-like tab is the tree's own descriptor, so
	// it stays live even after the URL points somewhere else.
	const liveRefs = new Set(tabs.map((tab) => tab.ref));
	if (layout !== null) {
		for (const group of listGroups(layout)) {
			for (const tab of group.tabs) {
				if (tab.kind !== "session" && tab.kind !== "terminal") liveRefs.add(tab.ref);
			}
		}
	}
	const effective = layout === null ? null : pruneLayout(layout, liveRefs, MAIN_GROUP);
	const splitGroups =
		effective === null ? [] : listGroups(effective).filter((group) => group.id !== MAIN_GROUP);
	const hiddenRefs = new Set(splitGroups.flatMap((group) => group.tabs.map((tab) => tab.ref)));

	/** The tab a split group shows. Chats and terminals must still exist; a file-like tab can stay. */
	const descriptorFor = (group: TabGroup): TabDescriptor | null => {
		const model = activeTabOf(group);
		if (model === null) return null;
		const live = tabs.find((tab) => tab.ref === model.ref);
		if (live !== undefined) return live;
		if (model.kind === "session" || model.kind === "terminal") return null;
		return model;
	};

	/** The tree with the main group's tabs brought up to date, so a move can find a new tab. */
	const currentTree = (): TabGroupNode => {
		const mainTabs = tabs.filter((tab) => !hiddenRefs.has(tab.ref));
		const base = effective ?? {
			kind: "group" as const,
			id: MAIN_GROUP,
			tabs: mainTabs,
			activeRef,
		};
		return withGroup(base, MAIN_GROUP, (group) => ({ ...group, tabs: mainTabs, activeRef }));
	};

	const moveAwayFromActive = (ref: string) => {
		if (ref !== activeRef) return;
		const visible = tabs.filter((tab) => !hiddenRefs.has(tab.ref));
		const neighbour = neighbourAfterClose(visible, ref);
		if (neighbour === null) return;
		onSearchChange(searchPatchFor(activeTabFromDescriptor(neighbour)));
	};

	const split = (tab: TabDescriptor, edge: Edge, groupId = MAIN_GROUP): boolean => {
		const base = currentTree();
		const next = applyTabAction({
			layout: base,
			action: { type: "split", ref: tab.ref, groupId, edge },
		});
		if (next === base) return false;
		setLayout(next);
		moveAwayFromActive(tab.ref);
		return true;
	};

	const move = (tab: TabDescriptor, toGroupId: string): boolean => {
		const base = currentTree();
		if (findTabGroup(base, tab.ref)?.id === toGroupId) return false;
		const next = applyTabAction({
			layout: base,
			action: { type: "move", ref: tab.ref, toGroupId, index: 0 },
		});
		if (next === base) return false;
		setLayout(next);
		moveAwayFromActive(tab.ref);
		return true;
	};

	useCommandHandler("tab.split", "base", () => {
		if (!splitEnabled || active === null || hiddenRefs.has(active.ref)) return false;
		return split(active, "right");
	});

	const dropOnGroup = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		const ref = event.dataTransfer.getData(DRAG_TYPE);
		const tab = tabs.find((candidate) => candidate.ref === ref);
		if (tab === undefined) return;
		split(tab, edgeFromEvent(event));
	};

	const dropOnStrip = (event: DragEvent<HTMLDivElement>, groupId: string) => {
		event.preventDefault();
		const ref = event.dataTransfer.getData(DRAG_TYPE);
		const tab = tabs.find((candidate) => candidate.ref === ref);
		if (tab === undefined) return;
		move(tab, groupId);
	};

	const dragStart = (tab: TabDescriptor) => (event: DragEvent<HTMLDivElement>) => {
		event.dataTransfer.setData(DRAG_TYPE, tab.ref);
		event.dataTransfer.effectAllowed = "move";
		if (typeof event.dataTransfer.setDragImage === "function") {
			event.dataTransfer.setDragImage(event.currentTarget, 0, 0);
		}
	};

	const mainPane = (
		// biome-ignore lint/a11y/noStaticElementInteractions: the group is the drop target for a tab dragged from its strip.
		<div
			data-testid="split-centre"
			className="flex min-w-0 flex-1 flex-col"
			onDragOver={(event) => {
				if (isDrag(event)) event.preventDefault();
			}}
			onDrop={dropOnGroup}
		>
			<div className="flex h-full min-h-0 flex-col">
				<TabStrip
					workspaceId={workspaceId}
					search={search}
					onSearchChange={onSearchChange}
					excludeRefs={hiddenRefs}
				/>
				<div className="min-h-0 flex-1">
					<TabContent workspaceId={workspaceId} search={search} onSearchChange={onSearchChange} />
				</div>
			</div>
		</div>
	);

	const renderGroup = (group: TabGroup): ReactNode => {
		if (group.id === MAIN_GROUP) return mainPane;
		const tab = descriptorFor(group);
		if (tab === null) return null;
		return (
			<section
				aria-label={`Split pane: ${tab.title}`}
				className="flex min-w-0 flex-1 flex-col border-l border-separator"
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: the strip is the drop target that moves a tab into this group. */}
				<div
					data-testid={`split-group-${group.id}`}
					className="flex h-10 shrink-0 items-center gap-1 border-b border-separator bg-surface px-2"
					onDragOver={(event) => {
						if (isDrag(event)) event.preventDefault();
					}}
					onDrop={(event) => dropOnStrip(event, group.id)}
				>
					<TabItem
						tab={tab}
						active
						onSelect={() => {}}
						onClose={() => {
							const base = currentTree();
							setLayout(closeGroup(base, group.id));
						}}
						onDragStart={dragStart(tab)}
					/>
					<button
						type="button"
						aria-label="Close split pane"
						onClick={() => {
							const base = currentTree();
							setLayout(closeGroup(base, group.id));
						}}
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
						tab={activeTabFromDescriptor(tab)}
					/>
				</div>
			</section>
		);
	};

	const renderNode = (node: TabGroupNode): ReactNode => {
		if (node.kind === "group") return renderGroup(node);
		const direction =
			node.direction === "row"
				? "flex h-full min-h-0 w-full"
				: "flex h-full min-h-0 w-full flex-col";
		return (
			<div className={direction} data-direction={node.direction}>
				{node.children.map((child) => (
					<div key={child.id} className="flex min-h-0 min-w-0 flex-1">
						{renderNode(child)}
					</div>
				))}
			</div>
		);
	};

	const body =
		!splitEnabled || effective === null || splitGroups.length === 0
			? mainPane
			: renderNode(effective);

	return <NewTabProvider>{body}</NewTabProvider>;
}
