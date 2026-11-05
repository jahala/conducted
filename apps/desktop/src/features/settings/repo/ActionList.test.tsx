import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { ActionList, type ActionListItem } from "./ActionList.tsx";

afterEach(cleanup);

const item = (changes: Partial<ActionListItem> = {}): ActionListItem => ({
	id: "dev-server",
	label: "Dev server",
	command: "pnpm dev",
	icon: null,
	isDefault: false,
	source: "shared",
	hidden: false,
	...changes,
});

function renderList(items: ActionListItem[], onToggleHidden = vi.fn()) {
	const handlers = {
		onEdit: vi.fn(),
		onDelete: vi.fn(),
		onToggleHidden,
		onSetDefault: vi.fn(),
		onReset: vi.fn(),
	};
	render(<ActionList items={items} {...handlers} />);
	return handlers;
}

describe("SET-07 ActionList", () => {
	it("offers Hide but not Delete on a shared action", () => {
		renderList([item()]);
		const row = screen.getByRole("listitem", { name: "Dev server" });

		expect(within(row).getByRole("button", { name: "Hide" })).toBeTruthy();
		expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
	});

	it("offers Delete on a personal action", () => {
		renderList([item({ source: "personal", id: "docs", label: "Docs" })]);
		const row = screen.getByRole("listitem", { name: "Docs" });

		expect(within(row).getByRole("button", { name: "Delete" })).toBeTruthy();
	});

	it("offers Reset only when this Mac changed a shared action", () => {
		renderList([
			item({ id: "dev", label: "Dev", canReset: true }),
			item({ id: "test", label: "Test", canReset: false }),
		]);

		expect(
			within(screen.getByRole("listitem", { name: "Dev" })).getByRole("button", {
				name: "Reset",
			}),
		).toBeTruthy();
		expect(
			within(screen.getByRole("listitem", { name: "Test" })).queryByRole("button", {
				name: "Reset",
			}),
		).toBeNull();
	});

	it("toggles hidden and marks the default action", () => {
		const onToggleHidden = vi.fn();
		renderList([item({ isDefault: true })], onToggleHidden);
		const row = screen.getByRole("listitem", { name: "Dev server" });

		expect(within(row).getByText("Default")).toBeTruthy();
		fireEvent.click(within(row).getByRole("button", { name: "Hide" }));
		expect(onToggleHidden).toHaveBeenCalledWith("dev-server", true);
	});

	it("shows Show and the Hidden badge on a hidden action", () => {
		renderList([item({ hidden: true })]);
		const row = screen.getByRole("listitem", { name: "Dev server" });

		expect(within(row).getByRole("button", { name: "Show" })).toBeTruthy();
		expect(within(row).getByText("Hidden")).toBeTruthy();
	});
});
