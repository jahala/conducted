/**
 * @feature Every in-app drag
 * Owns: tests for the shared pointer drag: the movement threshold, the drop on the target under the
 * pointer, Escape and a cancelled pointer, and the click guard.
 * Test first: a press that never moves starts no drag and drops nothing.
 */
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PointerDragPoint, usePointerDrag } from "./pointer-drag.ts";

afterEach(cleanup);

const at = (point: PointerDragPoint | undefined) =>
	point === undefined ? undefined : { target: "slot", element: document.body };

/** A React pointer event as a handler would receive it, without a live DOM event behind it. */
const press = () =>
	({
		button: 0,
		pointerId: 1,
		clientX: 0,
		clientY: 0,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	}) as unknown as Parameters<ReturnType<typeof usePointerDrag<string, string>>["start"]>[0];

function setup(threshold?: number) {
	const onDrop = vi.fn();
	const onCancel = vi.fn();
	const { result } = renderHook(() =>
		usePointerDrag<string, string>({
			threshold,
			targetAt: (point) => at(point.x >= 50 ? point : undefined),
			onDrop,
			onCancel,
		}),
	);
	const start = () => {
		act(() => result.current.start(press(), "payload"));
	};
	return { result, onDrop, onCancel, start };
}

describe("usePointerDrag", () => {
	it("keeps a press that never moves a click", () => {
		const { result, onDrop, start } = setup();
		start();
		act(() => {
			fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 0 });
		});
		expect(result.current.drag).toBeNull();
		expect(onDrop).not.toHaveBeenCalled();
		expect(
			result.current.consumeClick({ detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() }),
		).toBe(false);
	});

	it("drops on the target under the pointer after the drag threshold", () => {
		const { result, onDrop, start } = setup();
		start();
		act(() => {
			fireEvent.pointerMove(document, { pointerId: 1, clientX: 60, clientY: 10 });
		});
		expect(result.current.drag?.target).toBe("slot");
		act(() => {
			fireEvent.pointerUp(document, { pointerId: 1, clientX: 60, clientY: 10 });
		});
		expect(onDrop).toHaveBeenCalledWith("payload", "slot", expect.anything());
	});

	it("moves only after the threshold", () => {
		const { result, onDrop, start } = setup(20);
		start();
		act(() => {
			fireEvent.pointerMove(document, { pointerId: 1, clientX: 10, clientY: 0 });
		});
		expect(result.current.drag).toBeNull();
		act(() => {
			fireEvent.pointerMove(document, { pointerId: 1, clientX: 60, clientY: 0 });
		});
		expect(result.current.drag).not.toBeNull();
		act(() => {
			fireEvent.pointerUp(document, { pointerId: 1, clientX: 60, clientY: 0 });
		});
		expect(onDrop).toHaveBeenCalledWith("payload", "slot", expect.anything());
	});

	it("cancels a released drag outside every target", () => {
		const { start, onDrop, onCancel } = setup();
		start();
		act(() => {
			fireEvent.pointerMove(document, { pointerId: 1, clientX: 60, clientY: 0 });
			fireEvent.pointerMove(document, { pointerId: 1, clientX: 10, clientY: 0 });
			fireEvent.pointerUp(document, { pointerId: 1, clientX: 10, clientY: 0 });
		});
		expect(onDrop).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledWith("payload");
	});

	it("cancels a drag with Escape", () => {
		const { result, start, onDrop, onCancel } = setup();
		start();
		act(() => {
			fireEvent.pointerMove(document, { pointerId: 1, clientX: 60, clientY: 0 });
			fireEvent.keyDown(document, { key: "Escape" });
		});
		expect(result.current.drag).toBeNull();
		act(() => {
			fireEvent.pointerUp(document, { pointerId: 1, clientX: 60, clientY: 0 });
		});
		expect(onDrop).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledWith("payload");
	});

	it("cancels a drag when the pointer is cancelled", () => {
		const { start, onDrop, onCancel } = setup();
		start();
		act(() => {
			fireEvent.pointerMove(document, { pointerId: 1, clientX: 60, clientY: 0 });
			fireEvent.pointerCancel(document, { pointerId: 1 });
		});
		expect(onDrop).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledWith("payload");
	});

	it("swallows the click that ends a drag, once", () => {
		const { result, start } = setup();
		start();
		act(() => {
			fireEvent.pointerMove(document, { pointerId: 1, clientX: 60, clientY: 0 });
			fireEvent.pointerUp(document, { pointerId: 1, clientX: 60, clientY: 0 });
		});
		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		expect(result.current.consumeClick({ detail: 1, preventDefault, stopPropagation })).toBe(true);
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(result.current.consumeClick({ detail: 1, preventDefault, stopPropagation })).toBe(false);
	});
});
