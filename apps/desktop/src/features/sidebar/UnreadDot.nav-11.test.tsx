/**
 * @feature NAV-11 Unread dot
 * Owns: the tests for the dot that marks a workspace or chat with something new.
 * Behaviour: ui-map.md 3.2, 4.
 * Test first: renders an element named "Unread" when unread is true and nothing otherwise.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UnreadDot } from "./UnreadDot.tsx";

afterEach(cleanup);

describe("NAV-11 UnreadDot", () => {
	it("renders an element named Unread when there is something new", () => {
		render(<UnreadDot unread />);
		expect(screen.getByRole("img", { name: "Unread" })).toBeTruthy();
	});

	it("renders nothing when everything is read", () => {
		const { container } = render(<UnreadDot unread={false} />);
		expect(container.firstChild).toBeNull();
	});
});
