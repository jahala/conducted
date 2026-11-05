/**
 * @feature NAV-10 Tab layout model
 * Owns: The pure model of the centre: which tabs exist, which group holds them, and the operations
 * on it (open, close, move, split).
 * Behaviour: ui-map.md 3.2 and 8 (the centre is a tree of tab groups; tabs drag between groups or
 * to an edge to split; the active tab picks its right neighbour on close, else its left).
 * Our design choice: Plain functions over an immutable tree, no store inside. The service layer
 * saves the tree per workspace. The shape here is ours; Conductor's is not verified.
 * Must handle: closing the active tab picks its right neighbour, else its left; moving a tab to its
 * own group is a no-op; splitting a group with one tab is refused; the same tab is never in two
 * groups; reopening the last closed tab restores its group.
 * Test first: closeTab on the middle of three tabs makes the third tab active.
 */

import type { SessionId, TerminalId } from "@conducted/shared";
import type { WorkspaceStatus } from "../../core/model.ts";
import type { WorkspaceTabKind } from "./workspace-search.ts";

export interface TabDescriptor {
	kind: WorkspaceTabKind;
	/** Stable id of the thing the tab shows: session id, terminal id, file path, comment id, URL. */
	ref: string;
	title: string;
	sessionId?: SessionId;
	terminalId?: TerminalId;
	/** A chat tab's unread dot. */
	unread?: boolean;
	/** A chat tab's status icon. */
	status?: WorkspaceStatus | null;
}

export interface TabGroup {
	kind: "group";
	id: string;
	tabs: TabDescriptor[];
	activeRef: string | null;
}

export interface SplitGroup {
	kind: "split";
	id: string;
	direction: "row" | "column";
	sizes: number[];
	children: TabGroupNode[];
}

export type TabGroupNode = TabGroup | SplitGroup;

export type TabAction =
	| { type: "open"; tab: TabDescriptor; groupId: string }
	| { type: "close"; ref: string }
	| { type: "move"; ref: string; toGroupId: string; index: number }
	| { type: "split"; ref: string; groupId: string; edge: "left" | "right" | "top" | "bottom" }
	| { type: "activate"; groupId: string; ref: string };

/** A layout with one empty group. The root is always a group or a split of groups. */
export function emptyLayout(groupId = "group-main"): TabGroup {
	return { kind: "group", id: groupId, tabs: [], activeRef: null };
}

/** Every group in the tree, left to right. */
export function listGroups(node: TabGroupNode): TabGroup[] {
	if (node.kind === "group") return [node];
	return node.children.flatMap(listGroups);
}

/** The group that holds a tab, or null. */
export function findTabGroup(node: TabGroupNode, ref: string): TabGroup | null {
	for (const group of listGroups(node)) {
		if (group.tabs.some((tab) => tab.ref === ref)) return group;
	}
	return null;
}

/** Every tab in reading order, with the group that holds it. */
export function allTabs(node: TabGroupNode): { tab: TabDescriptor; groupId: string }[] {
	return listGroups(node).flatMap((group) => group.tabs.map((tab) => ({ tab, groupId: group.id })));
}

/** The tab the group shows, or null when it is empty. */
export function activeTabOf(group: TabGroup): TabDescriptor | null {
	return group.tabs.find((tab) => tab.ref === group.activeRef) ?? null;
}

/** The tab that becomes active when `ref` closes: its right neighbour, else its left. */
export function neighbourAfterClose(
	tabs: readonly TabDescriptor[],
	ref: string,
): TabDescriptor | null {
	const index = tabs.findIndex((tab) => tab.ref === ref);
	if (index === -1) return tabs[0] ?? null;
	const remaining = tabs.filter((tab) => tab.ref !== ref);
	if (remaining.length === 0) return null;
	return remaining[Math.min(index, remaining.length - 1)] ?? null;
}

function withGroup(
	node: TabGroupNode,
	id: string,
	update: (group: TabGroup) => TabGroup,
): TabGroupNode {
	if (node.kind === "group") return node.id === id ? update(node) : node;
	let changed = false;
	const children = node.children.map((child) => {
		const next = withGroup(child, id, update);
		if (next !== child) changed = true;
		return next;
	});
	return changed ? { ...node, children } : node;
}

/** Removes an empty group. A split with one child collapses into that child. */
function removeGroup(node: TabGroupNode, id: string): TabGroupNode {
	if (node.kind === "group") return node;
	let changed = false;
	const kept: TabGroupNode[] = [];
	for (const child of node.children) {
		const next = child.kind === "group" && child.id === id ? null : removeGroup(child, id);
		if (next !== child) changed = true;
		if (next !== null) kept.push(next);
	}
	if (!changed) return node;
	if (kept.length === 0) return node;
	if (kept.length === 1) {
		const only = kept[0];
		if (only === undefined) return node;
		return only;
	}
	const sizes = kept.map(() => 1 / kept.length);
	return { ...node, children: kept, sizes };
}

/** Removes the given tab from its group and picks a neighbour when it was active. */
function removeTab(node: TabGroupNode, ref: string): TabGroupNode {
	const group = findTabGroup(node, ref);
	if (group === null) return node;
	const nextActive =
		group.activeRef === ref ? (neighbourAfterClose(group.tabs, ref)?.ref ?? null) : group.activeRef;
	const emptied = group.tabs.length === 1;
	const next = withGroup(node, group.id, (current) => ({
		...current,
		tabs: current.tabs.filter((tab) => tab.ref !== ref),
		activeRef: nextActive,
	}));
	return emptied ? removeGroup(next, group.id) : next;
}

function insertTab(group: TabGroup, tab: TabDescriptor, index: number): TabGroup {
	const at = Math.max(0, Math.min(index, group.tabs.length));
	const tabs = group.tabs.filter((current) => current.ref !== tab.ref);
	tabs.splice(at, 0, tab);
	return { ...group, tabs, activeRef: tab.ref };
}

function uniqueGroupId(node: TabGroupNode, ref: string): string {
	const taken = new Set(listGroups(node).map((group) => group.id));
	const base = `group-${ref}`;
	if (!taken.has(base)) return base;
	let suffix = 2;
	while (taken.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
}

function splitId(node: TabGroupNode, direction: "row" | "column"): string {
	const taken = new Set<string>();
	const visit = (current: TabGroupNode): void => {
		if (current.kind === "split") {
			taken.add(current.id);
			for (const child of current.children) visit(child);
		}
	};
	visit(node);
	const base = `split-${direction}`;
	if (!taken.has(base)) return base;
	let suffix = 2;
	while (taken.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
}

interface Inserted {
	node: TabGroupNode;
	done: boolean;
}

/** Puts `newGroup` beside the group `groupId` in the chosen direction. */
function insertBeside(
	node: TabGroupNode,
	groupId: string,
	newGroup: TabGroup,
	direction: "row" | "column",
	before: boolean,
): Inserted {
	if (node.kind === "split") {
		const index = node.children.findIndex(
			(child) => child.kind === "group" && child.id === groupId,
		);
		if (index !== -1) {
			const at = before ? index : index + 1;
			if (node.direction === direction) {
				const children = [...node.children];
				children.splice(at, 0, newGroup);
				const sizes = children.map(() => 1 / children.length);
				return { node: { ...node, children, sizes }, done: true };
			}
			const wrapped: SplitGroup = {
				kind: "split",
				id: splitId(node, direction),
				direction,
				sizes: [0.5, 0.5],
				children: before
					? [newGroup, node.children[index] as TabGroup]
					: [node.children[index] as TabGroup, newGroup],
			};
			const children = [...node.children];
			children[index] = wrapped;
			return { node: { ...node, children }, done: true };
		}
		for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
			const child = node.children[childIndex];
			if (child === undefined) continue;
			const inserted = insertBeside(child, groupId, newGroup, direction, before);
			if (!inserted.done) continue;
			const children = [...node.children];
			children[childIndex] = inserted.node;
			return { node: { ...node, children }, done: true };
		}
		return { node, done: false };
	}
	if (node.id !== groupId) return { node, done: false };
	return {
		node: {
			kind: "split",
			id: splitId(node, direction),
			direction,
			sizes: [0.5, 0.5],
			children: before ? [newGroup, node] : [node, newGroup],
		},
		done: true,
	};
}

/** Applies one operation, returning the same tree when the operation changes nothing. */
export function applyTabAction({
	layout,
	action,
}: {
	layout: TabGroupNode;
	action: TabAction;
}): TabGroupNode {
	switch (action.type) {
		case "open": {
			const existing = findTabGroup(layout, action.tab.ref);
			if (existing !== null) {
				return withGroup(layout, existing.id, (group) => ({
					...group,
					tabs: group.tabs.map((tab) => (tab.ref === action.tab.ref ? action.tab : tab)),
					activeRef: action.tab.ref,
				}));
			}
			const target = listGroups(layout).find((group) => group.id === action.groupId);
			if (target === undefined) return layout;
			return withGroup(layout, target.id, (group) =>
				insertTab(group, action.tab, group.tabs.length),
			);
		}
		case "close":
			return removeTab(layout, action.ref);
		case "activate":
			return withGroup(layout, action.groupId, (group) => {
				if (!group.tabs.some((tab) => tab.ref === action.ref)) return group;
				return { ...group, activeRef: action.ref };
			});
		case "move": {
			const source = findTabGroup(layout, action.ref);
			const target = listGroups(layout).find((group) => group.id === action.toGroupId);
			if (source === null || target === undefined) return layout;
			if (source.id === target.id) {
				const found = source.tabs.find((tab) => tab.ref === action.ref);
				if (found === undefined) return layout;
				return withGroup(layout, source.id, (group) => insertTab(group, found, action.index));
			}
			const tab = source.tabs.find((current) => current.ref === action.ref);
			if (tab === undefined) return layout;
			const removed = removeTab(layout, action.ref);
			return withGroup(removed, target.id, (group) => insertTab(group, tab, action.index));
		}
		case "split": {
			const group = listGroups(layout).find((current) => current.id === action.groupId);
			if (group === undefined) return layout;
			const tab = group.tabs.find((current) => current.ref === action.ref);
			if (tab === undefined) return layout;
			if (group.tabs.length < 2) return layout;
			const direction = action.edge === "left" || action.edge === "right" ? "row" : "column";
			const before = action.edge === "left" || action.edge === "top";
			const removed = removeTab(layout, action.ref);
			const newGroup: TabGroup = {
				kind: "group",
				id: uniqueGroupId(removed, action.ref),
				tabs: [tab],
				activeRef: action.ref,
			};
			const inserted = insertBeside(removed, action.groupId, newGroup, direction, before);
			return inserted.done ? inserted.node : layout;
		}
	}
}
