/**
 * @feature NAV-10 Tab item
 * Owns: tests for one tab: middle click, the close button's name and the active mark.
 * Test first: Middle click calls onClose; the close button's name includes the tab title.
 */
import type { SessionId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { TabItem } from "./TabItem.tsx";
import type { TabDescriptor } from "./tab-layout.ts";

afterEach(cleanup);

const tab: TabDescriptor = {
	kind: "session",
	ref: "session:one",
	title: "Fix login",
	sessionId: "one" as SessionId,
};

describe("NAV-10 TabItem", () => {
	it("closes on a middle click", () => {
		const onClose = vi.fn();
		render(<TabItem tab={tab} active={false} onSelect={vi.fn()} onClose={onClose} />);
		fireEvent(
			screen.getByRole("tab", { name: "Fix login" }),
			new MouseEvent("auxclick", { bubbles: true, button: 1 }),
		);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("names the close button after the tab", () => {
		const onClose = vi.fn();
		render(<TabItem tab={tab} active onSelect={vi.fn()} onClose={onClose} />);
		fireEvent.click(screen.getByRole("button", { name: "Close Fix login" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("marks the active tab with aria-selected", () => {
		render(<TabItem tab={tab} active onSelect={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByRole("tab", { name: "Fix login" }).getAttribute("aria-selected")).toBe(
			"true",
		);
	});

	it("shows an unread dot for a chat", () => {
		render(
			<TabItem
				tab={{ ...tab, unread: true }}
				active={false}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByRole("img", { name: "Unread" })).toBeTruthy();
	});

	it("selects on Enter and Space when the tab itself has focus", () => {
		const onSelect = vi.fn();
		render(<TabItem tab={tab} active={false} onSelect={onSelect} onClose={vi.fn()} />);
		const item = screen.getByRole("tab", { name: "Fix login" });
		fireEvent.keyDown(item, { key: "Enter" });
		fireEvent.keyDown(item, { key: " " });
		expect(onSelect).toHaveBeenCalledTimes(2);
	});

	it("leaves Enter on the close button to the button, so it can close the tab", () => {
		const onSelect = vi.fn();
		render(<TabItem tab={tab} active={false} onSelect={onSelect} onClose={vi.fn()} />);
		// fireEvent returns false when a handler called preventDefault, which would cancel the click.
		const notPrevented = fireEvent.keyDown(
			screen.getByRole("button", { name: "Close Fix login" }),
			{
				key: "Enter",
			},
		);
		expect(notPrevented).toBe(true);
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("shows the full title as a tooltip and reports a drag", () => {
		const onDragStart = vi.fn();
		render(
			<TabItem
				tab={tab}
				active={false}
				onSelect={vi.fn()}
				onClose={vi.fn()}
				onDragStart={onDragStart}
			/>,
		);
		const item = screen.getByRole("tab", { name: "Fix login" });
		expect(item.getAttribute("title")).toBe("Fix login");
		expect(item.getAttribute("draggable")).toBe("true");
		fireEvent.dragStart(item);
		expect(onDragStart).toHaveBeenCalledTimes(1);
	});
});
