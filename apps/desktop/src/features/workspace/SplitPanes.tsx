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
 * moves there; a tab dropped on a group's content splits that group at the nearest edge. The drag
 * is the shared pointer drag, and a ghost of the dragged tab follows the pointer, as in Conductor.
 * Must handle: dropping on any edge (left, right, top, bottom); Cmd+D with fewer than two tabs
 * refuses without claiming the command; closing the split returns to one group; a workspace with
 * the setting off ignores any split; switching workspaces clears the split.
 * Test first: Dropping a tab on the right edge of a group makes two groups with the tab alone in
 * the new one.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useSessions, useSetting, useTerminals, useWorkspace } from "../../core/hooks.ts";
import type { DiffComment } from "../../core/model.ts";
import { CloseIcon } from "../../ui/icons.tsx";
import { type PointerDragHit, usePointerDrag } from "../../ui/pointer-drag.ts";
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

/** Where a dragged tab lands: among a group's tabs, at its end, or on an edge that splits it. */
type TabDropTarget =
	| { kind: "tabs"; groupId: string; index: number }
	| { kind: "center"; groupId: string }
	| { kind: "edge"; groupId: string; edge: Edge };

const MAIN_GROUP = "group-main";
const NO_COMMENTS: readonly DiffComment[] = [];
/** Conductor's edge band: a point within 15% of a group's width or height splits there. */
const EDGE_BAND = 0.15;

function contains(rect: DOMRect, point: { x: number; y: number }): boolean {
	return (
		point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
	);
}

/** The nearest edge when the point is within the edge band, else undefined (Conductor's centre). */
function edgeAt(point: { x: number; y: number }, rect: DOMRect): Edge | undefined {
	if (rect.width === 0 && rect.height === 0) return "right";
	const x = (point.x - rect.left) / rect.width;
	const y = (point.y - rect.top) / rect.height;
	const distances: { edge: Edge; distance: number }[] = [
		{ edge: "left", distance: x },
		{ edge: "right", distance: 1 - x },
		{ edge: "top", distance: y },
		{ edge: "bottom", distance: 1 - y },
	];
	distances.sort((left, right) => left.distance - right.distance);
	const nearest = distances[0];
	return nearest !== undefined && nearest.distance <= EDGE_BAND ? nearest.edge : undefined;
}

/**
 * The tab target under the point, as Conductor finds it: a strip's tab at the pointer's half, the
 * strip's end past the tabs, or a group's body at an edge (split) or its centre (move to the end).
 */
function tabTargetAt(
	root: HTMLElement | null,
	point: { x: number; y: number },
): PointerDragHit<TabDropTarget> | undefined {
	if (root === null) return undefined;
	for (const strip of root.querySelectorAll<HTMLElement>("[data-tab-strip]")) {
		const rect = strip.getBoundingClientRect();
		if (!contains(rect, point)) continue;
		const groupId = strip.dataset.tabStrip ?? MAIN_GROUP;
		const nodes = [...strip.querySelectorAll<HTMLElement>("[data-tab-ref]")];
		let index = nodes.length;
		let element: Element = strip;
		for (const [position, node] of nodes.entries()) {
			const tabRect = node.getBoundingClientRect();
			if (!contains(tabRect, point)) continue;
			index = point.x < tabRect.left + tabRect.width / 2 ? position : position + 1;
			element = node;
			break;
		}
		return { target: { kind: "tabs", groupId, index }, element };
	}
	const bodies = [root, ...root.querySelectorAll<HTMLElement>("[data-tab-group]")].filter(
		(element) => element.matches("[data-tab-group]"),
	);
	for (const body of bodies) {
		const rect = body.getBoundingClientRect();
		if (!contains(rect, point)) continue;
		const groupId = body.dataset.tabGroup ?? MAIN_GROUP;
		const edge = edgeAt(point, rect);
		return {
			target: edge === undefined ? { kind: "center", groupId } : { kind: "edge", groupId, edge },
			element: body,
		};
	}
	return undefined;
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
	const centreRef = useRef<HTMLDivElement | null>(null);

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
	const mainOrder =
		effective === null
			? undefined
			: listGroups(effective)
					.find((group) => group.id === MAIN_GROUP)
					?.tabs.map((tab) => tab.ref);

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

	const move = (tab: TabDescriptor, toGroupId: string, index?: number): boolean => {
		const base = currentTree();
		const source = findTabGroup(base, tab.ref);
		const target = listGroups(base).find((group) => group.id === toGroupId);
		if (source === null || target === undefined) return false;
		const sameGroup = source.id === toGroupId;
		const from = source.tabs.findIndex((candidate) => candidate.ref === tab.ref);
		// Conductor removes the tab before inserting it, so a move to the right lands one place left.
		const at =
			index === undefined
				? target.tabs.length
				: sameGroup && from !== -1 && from < index
					? index - 1
					: index;
		const next = applyTabAction({
			layout: base,
			action: { type: "move", ref: tab.ref, toGroupId, index: at },
		});
		if (next === base) return false;
		setLayout(next);
		if (!sameGroup) moveAwayFromActive(tab.ref);
		return true;
	};

	useCommandHandler("tab.split", "base", () => {
		if (!splitEnabled || active === null || hiddenRefs.has(active.ref)) return false;
		return split(active, "right");
	});

	const tabPointer = usePointerDrag<TabDescriptor, TabDropTarget>({
		targetAt: (point) => tabTargetAt(centreRef.current, point),
		onDrop: (tab, target) => {
			if (target.kind === "edge") split(tab, target.edge, target.groupId);
			else move(tab, target.groupId, target.kind === "tabs" ? target.index : undefined);
		},
	});

	const mainPaneBody = (
		<div className="flex h-full min-h-0 flex-col">
			<TabStrip
				workspaceId={workspaceId}
				search={search}
				onSearchChange={onSearchChange}
				excludeRefs={hiddenRefs}
				pointer={tabPointer}
				group={MAIN_GROUP}
				order={mainOrder}
			/>
			<div className="min-h-0 flex-1">
				<TabContent workspaceId={workspaceId} search={search} onSearchChange={onSearchChange} />
			</div>
		</div>
	);

	const singleGroup = !splitEnabled || effective === null || splitGroups.length === 0;

	const mainPane = splitEnabled ? (
		<div
			ref={singleGroup ? centreRef : undefined}
			data-testid="split-centre"
			data-tab-group={MAIN_GROUP}
			className="flex h-full min-w-0 flex-1 flex-col"
		>
			{mainPaneBody}
		</div>
	) : (
		// h-full as well as flex-1: with one group the parent (WorkspaceLayout) is a block, not a flex row.
		<div
			ref={singleGroup ? centreRef : undefined}
			data-tab-group={MAIN_GROUP}
			className="flex h-full min-w-0 flex-1 flex-col"
		>
			{mainPaneBody}
		</div>
	);

	const renderGroup = (group: TabGroup): ReactNode => {
		if (group.id === MAIN_GROUP) return mainPane;
		const tab = descriptorFor(group);
		if (tab === null) return null;
		return (
			<section
				aria-label={`Split pane: ${tab.title}`}
				data-tab-group={group.id}
				className="flex min-w-0 flex-1 flex-col border-l border-separator"
			>
				<div
					data-testid={`split-group-${group.id}`}
					data-tab-strip={group.id}
					className="flex h-10 shrink-0 items-center gap-1 border-b border-separator bg-surface px-2"
				>
					<TabItem
						tab={tab}
						active
						data-tab-ref={tab.ref}
						onSelect={() => {}}
						onClose={() => {
							const base = currentTree();
							setLayout(closeGroup(base, group.id));
						}}
						onPointerDown={(event) => tabPointer.start(event, tab)}
						onClickCapture={tabPointer.consumeClick}
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
			<div
				ref={node === effective ? centreRef : undefined}
				className={direction}
				data-direction={node.direction}
			>
				{node.children.map((child) => (
					<div key={child.id} className="flex min-h-0 min-w-0 flex-1">
						{renderNode(child)}
					</div>
				))}
			</div>
		);
	};

	const body = singleGroup ? mainPane : renderNode(effective);

	const dragGhost =
		tabPointer.drag === null ? null : (
			<div
				data-testid="center-panel-drag-ghost"
				className="pointer-events-none fixed z-50 rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg shadow-dialog"
				style={{ left: tabPointer.drag.point.x + 8, top: tabPointer.drag.point.y + 8 }}
			>
				{tabPointer.drag.payload.title}
			</div>
		);

	return (
		<NewTabProvider>
			{body}
			{dragGhost}
		</NewTabProvider>
	);
}
