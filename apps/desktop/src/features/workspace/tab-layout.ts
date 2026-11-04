/**
 * @feature NAV-10 Tab layout model
 * Owns: The pure model of the centre: which tabs exist, which group holds them, and the operations
 * on it (open, close, move, split).
 * Behaviour: ui-map.md 3.2 and 8 (a tree layout store with ensureCenterPanelLayout,
 * moveCenterPanelTab, splitCenterPanelGroup, setCenterPanelSplitSize; terminals can also be dragged
 * from the right panel into the centre).
 * Our design choice: Plain functions over an immutable tree, no store inside. The service layer
 * saves the tree per workspace. The shape here is ours; Conductor's is not verified.
 * Must handle: Closing the active tab picks its right neighbour, else its left; moving a tab to its
 * own group is a no-op; splitting a group with one tab is refused; the same tab is never in two
 * groups; reopening the last closed tab restores its group.
 * Test first: closeTab on the middle of three tabs makes the third tab active.
 */

import type { SessionId, TerminalId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { WorkspaceTabKind } from "./workspace-search.ts";

export interface TabDescriptor {
	kind: WorkspaceTabKind;
	/** Stable id of the thing the tab shows: session id, terminal id, file path, comment id, URL. */
	ref: string;
	title: string;
	sessionId?: SessionId;
	terminalId?: TerminalId;
}

export type TabGroupNode =
	| { kind: "group"; id: string; tabs: TabDescriptor[]; activeRef: string | null }
	| {
			kind: "split";
			id: string;
			direction: "row" | "column";
			sizes: number[];
			children: TabGroupNode[];
	  };

export type TabAction =
	| { type: "open"; tab: TabDescriptor; groupId: string }
	| { type: "close"; ref: string }
	| { type: "move"; ref: string; toGroupId: string; index: number }
	| { type: "split"; ref: string; groupId: string; edge: "left" | "right" | "top" | "bottom" };

export function applyTabAction(_props: { layout: TabGroupNode; action: TabAction }): TabGroupNode {
	return notImplemented("NAV-10");
}
