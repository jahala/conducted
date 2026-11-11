/**
 * @feature NAV-10 Tab item
 * Owns: tests for one tab: middle click, the close button's name and the active mark.
 * Test first: Middle click calls onClose; the close button's name includes the tab title.
 */
import type { SessionId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

	it("draws no icon on an idle chat tab, as Conductor's chat tabs do", () => {
		render(<TabItem tab={tab} active onSelect={vi.fn()} onClose={vi.fn()} />);
		const close = screen.getByRole("button", { name: "Close Fix login" });
		const icons = [...screen.getByRole("tab").querySelectorAll("svg")];
		expect(icons.filter((icon) => !close.contains(icon))).toHaveLength(0);
	});

	it("puts a chat's unread dot before its title", () => {
		render(
			<TabItem
				tab={{ ...tab, unread: true }}
				active={false}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const dot = screen.getByRole("img", { name: "Unread" });
		const title = screen.getByText("Fix login");
		expect(dot.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

	it("shows a cloud host icon on a cloud workspace's terminal tab", () => {
		const { container } = render(
			<TabItem
				tab={{ kind: "terminal", ref: "terminal:t1", title: "Terminal 1", hostKind: "cloud" }}
				active={false}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(container.querySelector('[data-host="cloud"]')).not.toBeNull();
		expect(container.querySelector('[data-host="local"]')).toBeNull();
	});

	it("shows a laptop host icon on a cloud workspace's local terminal tab", () => {
		const { container } = render(
			<TabItem
				tab={{ kind: "terminal", ref: "terminal:t1", title: "Terminal 1", hostKind: "local" }}
				active={false}
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		expect(container.querySelector('[data-host="local"]')).not.toBeNull();
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

describe("NAV-10 file tab icon", () => {
	it("shows the file's language icon, as Conductor's file tabs do", () => {
		const fileTab: TabDescriptor = {
			kind: "file",
			ref: "src/main.rs",
			title: "src/main.rs",
		};
		render(<TabItem tab={fileTab} active onSelect={vi.fn()} onClose={vi.fn()} />);
		expect(document.querySelector("[data-file-icon]")?.getAttribute("data-kind")).toBe("rust");
	});
});
