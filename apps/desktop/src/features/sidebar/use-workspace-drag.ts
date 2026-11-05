/**
 * @feature NAV-04 Workspace drag and drop
 * Owns: The drag and drop behaviour for sidebar rows: dragging a workspace into Pinned or a
 * section, and reordering when manual order is on.
 * Behaviour: ui-map.md 4 ('Drag and drop: workspaces drag into sections, Pinned, or reorder when
 * Arrange workspaces manually is on'; while dragging the cursor is 'grabbing' and link pointer
 * events are off).
 * Our design choice: No drag and drop library is installed. This hook starts on the browser's
 * native drag events and turns a drop into one of the caller's actions. The caller names the
 * action for each target, so the same hook serves Pinned, a user section and the main list.
 * Must handle: Escape cancels a drag; a drop outside any target changes nothing; a drop on the
 * row being dragged changes nothing; a row dropped from another list lands at that row's
 * position; only the newest drop reports its failure; the grabbing cursor and the disabled link
 * pointer events exist only while a drag runs.
 * Test first: Dropping row A after row B in manual order calls the order action with A after B
 * and not before.
 */
import type { Result, SectionId, WorkspaceId } from "@conducted/shared";
import { type DragEvent, useCallback, useEffect, useState } from "react";
import { fireAndForget } from "../../core/async/fire-and-forget.ts";
import { createLatestWins } from "../../core/async/latest-wins.ts";

/** The data a drag carries, so a drop target in another list can name the workspace. */
export const WORKSPACE_DRAG_MIME = "application/x-conducted-workspace";

/** A section header drag uses its own type, so workspace drop targets can ignore it. */
export const SECTION_DRAG_MIME = "application/x-conducted-section";

/** The section id a header drag carries, or null when the drag is not a section. */
export function draggedSection(event: DragEvent): string | null {
	const value = event.dataTransfer?.getData(SECTION_DRAG_MIME) ?? "";
	return value === "" ? null : value;
}

/**
 * The workspace id a drag carries. `fallback` names the row being dragged when the browser gives
 * no data, which jsdom and some drop targets do.
 */
export function draggedWorkspace(
	event: DragEvent,
	fallback: WorkspaceId | null = null,
): WorkspaceId | null {
	const value =
		event.dataTransfer?.getData(WORKSPACE_DRAG_MIME) ||
		event.dataTransfer?.getData("text/plain") ||
		fallback ||
		"";
	return value === "" ? null : (value as WorkspaceId);
}

export interface WorkspaceDragState {
	draggingId: WorkspaceId | null;
	overTarget: string | null;
}

export interface WorkspaceDragCallbacks {
	/** The ids in this list's visible order, used for a manual reorder. */
	order?: readonly WorkspaceId[];
	/** The section this list belongs to. Null or absent: the main list. */
	sectionId?: SectionId | null;
	/** Only a manual-order list reorders its rows; without this, a drop between rows does nothing. */
	manualOrder?: boolean;
	/** Drop onto Pinned. */
	pin?(workspaceId: WorkspaceId): Promise<Result<unknown>> | undefined;
	/** Put the workspace in a section, or out of every section with null, at a position. */
	place?(
		workspaceId: WorkspaceId,
		sectionId: SectionId | null,
		position: number,
	): Promise<Result<unknown>> | undefined;
	/** Save a new manual order. */
	reorder?(orderedIds: readonly WorkspaceId[]): Promise<Result<unknown>> | undefined;
	/** Report a failed action with the toast title the caller wants. */
	onError?(title: string, error: { message: string }): void;
}

export interface WorkspaceDragHandlers {
	state: WorkspaceDragState;
	startDrag: (id: WorkspaceId) => void;
	/** Marks the target under the pointer, for its hover style. */
	dragOver: (target: string | null) => void;
	/** `workspaceId` lets a target in another list receive a drag started elsewhere. */
	dropOn: (target: string, position: number, workspaceId?: WorkspaceId) => void;
	cancel: () => void;
}

const REORDER_TITLE = "Couldn't reorder the workspaces";
const MOVE_TITLE = "Couldn't move workspace";
const PIN_TITLE = "Couldn't pin the workspace";

export function useWorkspaceDrag(callbacks: WorkspaceDragCallbacks = {}): WorkspaceDragHandlers {
	const [state, setState] = useState<WorkspaceDragState>({
		draggingId: null,
		overTarget: null,
	});
	const [drops] = useState(() => createLatestWins<"drop">());

	const { pin, place, reorder, onError, order, sectionId, manualOrder = false } = callbacks;

	const run = useCallback(
		(title: string, action: () => Promise<Result<unknown>> | undefined) => {
			const ticket = drops.begin("drop");
			fireAndForget(
				async () => {
					const result = await Promise.resolve(action());
					if (result === undefined || !drops.isLatest(ticket)) {
						drops.settle(ticket);
						return;
					}
					drops.settle(ticket);
					if (!result.ok) onError?.(title, result.error);
				},
				(cause: unknown) => {
					drops.settle(ticket);
					const message = cause instanceof Error ? cause.message : String(cause);
					onError?.(title, { message });
				},
			);
		},
		[drops, onError],
	);

	const startDrag = useCallback((id: WorkspaceId) => {
		setState({ draggingId: id, overTarget: null });
	}, []);

	const dragOver = useCallback((target: string | null) => {
		setState((current) =>
			current.overTarget === target ? current : { ...current, overTarget: target },
		);
	}, []);

	const cancel = useCallback(() => {
		setState({ draggingId: null, overTarget: null });
	}, []);

	const dropOn = useCallback(
		(target: string, position: number, carriedId?: WorkspaceId) => {
			const draggingId = carriedId ?? state.draggingId;
			setState({ draggingId: null, overTarget: null });
			if (draggingId === null) return;

			if (target === "pinned") {
				if (pin === undefined) return;
				run(PIN_TITLE, () => pin(draggingId));
				return;
			}

			if (target === "main") {
				if (place === undefined) return;
				run(MOVE_TITLE, () => place(draggingId, null, position));
				return;
			}

			if (target.startsWith("section:")) {
				if (place === undefined) return;
				const targetSectionId = target.slice("section:".length) as SectionId;
				run(MOVE_TITLE, () => place(draggingId, targetSectionId, position));
				return;
			}

			if (target.startsWith("row:")) {
				const targetId = target.slice("row:".length) as WorkspaceId;
				if (targetId === draggingId) return;
				const fromThisList = order?.includes(draggingId) ?? false;
				const targetIndex = order?.indexOf(targetId) ?? -1;
				const index = Math.max(
					0,
					targetIndex < 0 ? position : position > 0 ? targetIndex + 1 : targetIndex,
				);

				if (fromThisList) {
					// Reordering inside one list only happens when manual order is on.
					if (!manualOrder || order === undefined) return;
					const without = order.filter((id) => id !== draggingId);
					const targetWithout = without.indexOf(targetId);
					const nextIndex = Math.max(0, position > 0 ? targetWithout + 1 : targetWithout);
					if (reorder !== undefined) {
						const next = [...without.slice(0, nextIndex), draggingId, ...without.slice(nextIndex)];
						run(REORDER_TITLE, () => reorder(next));
						return;
					}
					if (place !== undefined) {
						run(MOVE_TITLE, () => place(draggingId, sectionId ?? null, nextIndex));
					}
					return;
				}

				// A row from another list goes into this list at the row's position.
				if (place === undefined) return;
				run(MOVE_TITLE, () => place(draggingId, sectionId ?? null, index));
			}
		},
		[manualOrder, order, pin, place, reorder, run, sectionId, state.draggingId],
	);

	// Escape cancels a drag, as the browser's own drag does.
	useEffect(() => {
		if (state.draggingId === null) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			cancel();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [state.draggingId, cancel]);

	// While a drag runs the cursor is grabbing and links ignore the pointer, so only the drop
	// targets react. The style element is removed when the drag ends or the list unmounts.
	useEffect(() => {
		if (state.draggingId === null) return;
		const style = document.createElement("style");
		style.dataset.workspaceDrag = "";
		style.textContent =
			'html{cursor:grabbing!important}html[data-workspace-drag] a,html[data-workspace-drag] [role="link"]{pointer-events:none!important}';
		document.documentElement.dataset.workspaceDrag = "";
		document.head.appendChild(style);
		return () => {
			style.remove();
			delete document.documentElement.dataset.workspaceDrag;
		};
	}, [state.draggingId]);

	return { state, startDrag, dragOver, dropOn, cancel };
}
