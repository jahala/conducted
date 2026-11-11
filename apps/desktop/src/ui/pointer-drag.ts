/**
 * @feature Every in-app drag
 * Owns: the one pointer-driven drag gesture used by the sidebar, tabs, queue, favourites and Kanban:
 * the movement threshold, the target under the pointer, the release, Escape, and the click guard.
 * Behaviour: issue #529 and Conductor's own drags (renderApp's Loadout, tab panel, sidebar, queue
 * and kanban) are pointer driven: a press starts a drag only after the pointer moves 4px, each move
 * hit-tests the caller's targets, releasing drops on the target under the pointer, Escape or a
 * cancelled pointer changes nothing, and the click that ends a drag is not also a click. A pointer
 * drag is what works in the app's window, where Tauri's drag-drop handler answers every HTML5 drag's
 * dragover and drop for file drops.
 * Must handle: a press that never moves stays a click; a drag released outside every target calls
 * `onCancel`; the handlers are removed on release, Escape and unmount.
 * Our design choice: the caller supplies `targetAt`, so each screen keeps its own geometry and drop
 * rules; this module owns only the gesture and the click guard.
 * Test first: a press that never moves stays a click.
 */

import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

/** How far the pointer moves before a press becomes a drag, in pixels (Conductor's Loadout). */
export const POINTER_DRAG_THRESHOLD = 4;

export interface PointerDragPoint {
	x: number;
	y: number;
}

/** What `targetAt` returns: the caller's target and the element whose rectangle holds the pointer. */
export interface PointerDragHit<T> {
	target: T;
	element: Element;
}

export interface PointerDragState<P, T> {
	payload: P;
	dx: number;
	dy: number;
	point: PointerDragPoint;
	target: T | undefined;
	targetElement: Element | null;
}

export interface PointerDragOptions<P, T> {
	threshold?: number;
	/** The caller's target under the point, or undefined when the point is outside every target. */
	targetAt(point: PointerDragPoint): PointerDragHit<T> | undefined;
	onDrop(payload: P, target: T, point: PointerDragPoint): void;
	/** A drag cancelled with Escape or by the pointer. */
	onCancel?(payload: P): void;
	/** A drag released outside every target; a cancelled drag calls `onCancel` instead. */
	onReleaseOutside?(payload: P): void;
}

/** The part of a click this module reads to swallow the click that ends a drag. */
export interface PointerDragClick {
	detail: number;
	preventDefault(): void;
	stopPropagation(): void;
}

export interface PointerDrag<P, T> {
	drag: PointerDragState<P, T> | null;
	start(event: ReactPointerEvent, payload: P): void;
	cancel(): void;
	/** True when this click ends a drag: it is swallowed and the flag cleared. */
	consumeClick(event: PointerDragClick): boolean;
	/** Clears the click guard, so a press on a control that cannot drag starts a fresh question. */
	resetClick(): void;
	isDragging: boolean;
}

export function usePointerDrag<P, T>(options: PointerDragOptions<P, T>): PointerDrag<P, T> {
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const [drag, setDrag] = useState<PointerDragState<P, T> | null>(null);
	const stop = useRef<(() => void) | null>(null);
	const active = useRef(false);
	const payloadRef = useRef<P | null>(null);
	const clickAfterDrag = useRef(false);

	const finish = useCallback(() => {
		stop.current?.();
		stop.current = null;
		active.current = false;
		payloadRef.current = null;
		delete document.documentElement.dataset.pointerDrag;
	}, []);

	const cancel = useCallback(() => {
		const payload = payloadRef.current;
		const wasActive = active.current;
		finish();
		setDrag(null);
		if (wasActive && payload !== null) optionsRef.current.onCancel?.(payload);
	}, [finish]);

	useEffect(
		() => () => {
			finish();
		},
		[finish],
	);

	const start = useCallback(
		(event: ReactPointerEvent, payload: P) => {
			if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
			// A link inside the source would otherwise start the browser's own drag of the link.
			event.preventDefault();
			finish();
			clickAfterDrag.current = false;
			const startX = event.clientX;
			const startY = event.clientY;
			const pointerId = event.pointerId;
			const threshold = optionsRef.current.threshold ?? POINTER_DRAG_THRESHOLD;

			const moved = (moveEvent: PointerEvent): void => {
				if (moveEvent.pointerId !== pointerId) return;
				const dx = moveEvent.clientX - startX;
				const dy = moveEvent.clientY - startY;
				if (!active.current && Math.hypot(dx, dy) < threshold) return;
				if (!active.current) {
					active.current = true;
					payloadRef.current = payload;
					clickAfterDrag.current = true;
					document.documentElement.dataset.pointerDrag = "";
				}
				const point = { x: moveEvent.clientX, y: moveEvent.clientY };
				const hit = optionsRef.current.targetAt(point);
				setDrag({
					payload,
					dx,
					dy,
					point,
					target: hit?.target,
					targetElement: hit?.element ?? null,
				});
			};

			const ended = (endEvent: PointerEvent): void => {
				if (endEvent.pointerId !== pointerId) return;
				const wasActive = active.current;
				const current = payloadRef.current ?? payload;
				finish();
				setDrag(null);
				if (!wasActive) return;
				const point = { x: endEvent.clientX, y: endEvent.clientY };
				const hit = optionsRef.current.targetAt(point);
				if (hit === undefined) {
					const outside = optionsRef.current.onReleaseOutside;
					if (outside === undefined) optionsRef.current.onCancel?.(current);
					else outside(current);
					return;
				}
				optionsRef.current.onDrop(current, hit.target, point);
			};

			const cancelled = (cancelEvent: PointerEvent): void => {
				if (cancelEvent.pointerId !== pointerId) return;
				cancel();
			};

			const keyed = (keyEvent: KeyboardEvent): void => {
				if (keyEvent.key !== "Escape") return;
				if (!active.current) return;
				keyEvent.preventDefault();
				cancel();
			};

			const clean = (): void => {
				document.removeEventListener("pointermove", moved);
				document.removeEventListener("pointerup", ended);
				document.removeEventListener("pointercancel", cancelled);
				document.removeEventListener("keydown", keyed);
				if (stop.current === clean) stop.current = null;
			};
			document.addEventListener("pointermove", moved);
			document.addEventListener("pointerup", ended);
			document.addEventListener("pointercancel", cancelled);
			document.addEventListener("keydown", keyed);
			stop.current = clean;
		},
		[cancel, finish],
	);

	const consumeClick = useCallback((event: PointerDragClick): boolean => {
		if (!clickAfterDrag.current) return false;
		clickAfterDrag.current = false;
		if (event.detail === 0) return false;
		event.preventDefault();
		event.stopPropagation();
		return true;
	}, []);

	const resetClick = useCallback(() => {
		clickAfterDrag.current = false;
	}, []);

	return { drag, start, cancel, consumeClick, resetClick, isDragging: drag !== null };
}
