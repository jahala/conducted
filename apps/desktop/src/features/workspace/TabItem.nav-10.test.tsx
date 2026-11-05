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
});
