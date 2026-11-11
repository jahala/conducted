/**
 * @feature Every in-app drag
 * Owns: the test helpers that give jsdom the rectangles it lacks and drive a real pointer drag.
 * Behaviour: issue #529; a drag is a pointer press, a move past the 4px threshold and a release, as
 * the shared pointer drag reads it.
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
