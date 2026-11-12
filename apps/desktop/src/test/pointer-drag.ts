/**
 * @feature Every in-app drag
 * Owns: the test helpers that give jsdom the rectangles it lacks and drive a real pointer: a drag,
 * or a click with the press a browser sends before it.
 * Behaviour: issue #529; a drag is a pointer press, a move past the 4px threshold and a release, as
 * the shared pointer drag reads it. Issue #609; a click is a press, a release and the click.
 * Test first: not applicable; the drags that use it are tested where they are built.
 */
import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

export interface TestBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface TestPoint {
	x: number;
	y: number;
}

/** A DOMRect for an element's place in the test's layout. */
export function boxOf({ left, top, width, height }: TestBox): DOMRect {
	return {
		x: left,
		y: top,
		width,
		height,
		top,
		left,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	};
}

/** Gives an element a rectangle, since jsdom has no layout. */
export function layOut(element: Element, box: TestBox): void {
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue(boxOf(box));
}

/** The point at the middle of a box. */
export function middleOf(box: TestBox): TestPoint {
	return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** A pointer drag from a press at `from` to a release at `to`. */
export function dragPointer(
	source: Element,
	to: TestPoint,
	from: TestPoint = { x: 0, y: 0 },
): void {
	fireEvent.pointerDown(source, {
		button: 0,
		pointerId: 1,
		clientX: from.x,
		clientY: from.y,
	});
	fireEvent.pointerMove(document, { pointerId: 1, clientX: to.x, clientY: to.y });
	fireEvent.pointerUp(document, { pointerId: 1, clientX: to.x, clientY: to.y });
}

/**
 * A mouse click as a browser sends it: the press, the release, then the click. `fireEvent.click`
 * alone skips the press, and a Radix popover reads the press to know the user went outside it. Without
 * one, a popover closed by the app's state hands focus back to its trigger a tick later, and that
 * focus closes a popover the click just opened (issue #609). No focus moves, as in the app's
 * WebKit view, where a button does not take focus on a click.
 */
export function clickPointer(target: Element): void {
	const press = { button: 0, pointerId: 1, pointerType: "mouse" };
	fireEvent.pointerDown(target, press);
	fireEvent.mouseDown(target, { button: 0 });
	fireEvent.pointerUp(target, press);
	fireEvent.mouseUp(target, { button: 0 });
	fireEvent.click(target, { button: 0 });
}
