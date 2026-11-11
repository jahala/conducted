/**
 * @feature NAV-10 Tab drags between the centre and the bottom panel
 * Owns: the one pointer drag that the centre's tab strips and split panes share with the bottom
 * panel's terminal tabs, so a terminal tab dragged out of one strip lands in the other (issue
 * #527), and the ghost of the dragged tab that follows the pointer.
 * Behaviour: ui-map.md 3.2 (a drag ghost follows the cursor; a terminal drags between the right
 * panel and the centre). Conductor's drag carries where it started: a centre tab is "center-tab",
 * a right-panel terminal tab is "right-terminal" with the label "Terminal" (renderApp @4993207).
 * Must handle: a drag started in one strip is seen by the other strip's hit test; Escape or a
 * cancelled pointer changes nothing; the click that ends a drag is not also a click.
 * Our design choice: each strip registers its own hit test and drop, as the sidebar's lists do, so
 * each strip keeps its own rule. The strip that takes a tab calls the payload's `onMovedOut` once
 * the move is done, so the strip it left picks the tab it shows next.
 * Test first: a panel terminal's tab dragged onto the centre strip moves it there.
 */
import {
	createContext,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import {
	type PointerDragClick,
	type PointerDragState,
	type PointerDropHit,
	type PointerHitTest,
	usePointerDropTargets,
} from "../../ui/pointer-drag.ts";
import type { TabDescriptor } from "./tab-layout.ts";

/** Where a tab drag started, in Conductor's words. */
export type TabDragSource = "center-tab" | "right-terminal";

/** What a tab drag carries. */
export interface TabDragPayload {
	tab: TabDescriptor;
	source: TabDragSource;
	/** The ghost's text. */
	label: string;
	/** Called by the strip that takes the tab, once it has moved there. */
	onMovedOut?: () => void;
}

export type TabDropHit = PointerDropHit<TabDragPayload>;

export interface TabDragController {
	drag: PointerDragState<TabDragPayload, TabDropHit> | null;
	start(event: ReactPointerEvent, payload: TabDragPayload): void;
	consumeClick(event: PointerDragClick): boolean;
	register(hitTest: PointerHitTest<TabDragPayload, TabDropHit>): () => void;
}

const TabDragContext = createContext<TabDragController | null>(null);

export function TabDragProvider({ children }: { children: ReactNode }) {
	const { pointer, register } = usePointerDropTargets<TabDragPayload, TabDropHit>();
	const value = useMemo<TabDragController>(
		() => ({
			drag: pointer.drag,
			start: pointer.start,
			consumeClick: pointer.consumeClick,
			register,
		}),
		[pointer.drag, pointer.start, pointer.consumeClick, register],
	);
	const ghost =
		pointer.drag === null ? null : (
			<div
				data-testid="center-panel-drag-ghost"
				className="pointer-events-none fixed z-50 rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg shadow-dialog"
				style={{ left: pointer.drag.point.x + 8, top: pointer.drag.point.y + 8 }}
			>
				{pointer.drag.payload.label}
			</div>
		);
	return (
		<TabDragContext.Provider value={value}>
			{children}
			{ghost}
		</TabDragContext.Provider>
	);
}

export function useTabDrag(): TabDragController {
	const value = useContext(TabDragContext);
	if (value === null) throw new Error("A tab drag must sit inside TabDragProvider.");
	return value;
}

/** Registers this strip's hit test for as long as it is mounted. */
export function useTabDropTarget(hitTest: PointerHitTest<TabDragPayload, TabDropHit>): void {
	const { register } = useTabDrag();
	const current = useRef(hitTest);
	current.current = hitTest;
	useEffect(() => register((point, payload) => current.current(point, payload)), [register]);
}
