/**
 * @feature NAV-04 Workspace drag and drop
 * Owns: the one pointer drag shared by Pinned, the user's sections and the main list, so a workspace
 * dragged out of one list lands in another.
 * Behaviour: issue #529 and ui-map.md 4 (a workspace drags into Pinned or a section; rows and section
 * headers reorder). The app's window answers every HTML5 drag for file drops, so the sidebar drags
 * with pointer events and hit-tests each list's own rectangles.
 * Must handle: a drag started in one list is seen by every other list's hit test; the smallest
 * element under the pointer wins, so a row beats the list behind it; Escape or a cancelled pointer
 * changes nothing; the click that ends a drag is not also a click.
 * Our design choice: each list registers its own hit test and keeps its own drop rule, so the hook
 * beside it (use-workspace-drag.ts) stays the one home of the rule. The registry and the smallest-
 * element rule are the shared `usePointerDropTargets`.
 * Test first: a row dropped after another row in manual order calls the order action.
 */
import type { RepoId, SectionId, WorkspaceId } from "@conducted/shared";
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
	type PointerDragPoint,
	type PointerDragState,
	type PointerDropHit,
	usePointerDropTargets,
} from "../../ui/pointer-drag.ts";

/** What a sidebar drag carries. */
export type WorkspaceDragPayload =
	| { kind: "workspace"; id: WorkspaceId }
	| { kind: "section"; id: SectionId }
	| { kind: "repo"; id: RepoId };

/** One list's target under the pointer, with the drop it performs. */
export interface WorkspaceDragHit extends PointerDropHit<WorkspaceDragPayload> {
	key: string;
}

export type WorkspaceHitTest = (point: PointerDragPoint) => WorkspaceDragHit | undefined;

export interface WorkspaceDragController {
	drag: PointerDragState<WorkspaceDragPayload, WorkspaceDragHit> | null;
	start(event: ReactPointerEvent, payload: WorkspaceDragPayload): void;
	cancel(): void;
	consumeClick(event: PointerDragClick): boolean;
	register(hitTest: WorkspaceHitTest): () => void;
}

const WorkspaceDragContext = createContext<WorkspaceDragController | null>(null);

export function WorkspaceDragProvider({ children }: { children: ReactNode }) {
	const { pointer, register } = usePointerDropTargets<WorkspaceDragPayload, WorkspaceDragHit>();
	// While any sidebar drag runs the cursor is grabbing and links ignore the pointer, as Conductor's.
	useEffect(() => {
		if (pointer.drag === null) return;
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
	}, [pointer.drag]);

	const value = useMemo<WorkspaceDragController>(
		() => ({
			drag: pointer.drag,
			start: pointer.start,
			cancel: pointer.cancel,
			consumeClick: pointer.consumeClick,
			register,
		}),
		[pointer.drag, pointer.start, pointer.cancel, pointer.consumeClick, register],
	);
	return <WorkspaceDragContext.Provider value={value}>{children}</WorkspaceDragContext.Provider>;
}

export function useWorkspaceDragController(): WorkspaceDragController {
	const value = useContext(WorkspaceDragContext);
	if (value === null) throw new Error("A sidebar drag must sit inside WorkspaceDragProvider.");
	return value;
}

/** Registers this list's hit test for as long as it is mounted. */
export function useWorkspaceHitTest(hitTest: WorkspaceHitTest): void {
	const { register } = useWorkspaceDragController();
	const current = useRef(hitTest);
	current.current = hitTest;
	useEffect(() => register((point) => current.current(point)), [register]);
}
