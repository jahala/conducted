import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSearch } from "./SettingsSearch.tsx";
import type { SearchableSetting } from "./settings-search.ts";

afterEach(cleanup);

const setting = (key: string, title: string): SearchableSetting => ({
	key,
	title,
	description: "",
	keywords: [],
	page: "general",
});

describe("SET-02 SettingsSearch", () => {
	it("lists the zoom setting first and opens it on Enter", () => {
		const onOpen = vi.fn();
		render(
			<SettingsSearch
				index={[setting("zoom", "App zoom"), setting("theme", "Code theme")]}
				onOpen={onOpen}
			/>,
		);

		const input = screen.getByRole("searchbox", { name: "Search settings" });
		fireEvent.change(input, { target: { value: "zoom" } });

		const results = within(
			screen.getByRole("list", { name: "Settings search results" }),
		).getAllByRole("button");
		expect(results[0]?.textContent).toContain("App zoom");
		fireEvent.keyDown(input, { key: "Enter" });

		expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "zoom" }));
	});

	it("clamps the arrow-key selection at both ends and opens the highlighted result", () => {
		const onOpen = vi.fn();
		render(
			<SettingsSearch
				index={[setting("one", "One setting"), setting("two", "Two setting")]}
				onOpen={onOpen}
			/>,
		);
		const input = screen.getByRole("searchbox", { name: "Search settings" });
		fireEvent.change(input, { target: { value: "setting" } });

		// Conductor clamps at both ends (renderApp: Math.min(Math.max(i + d, 0), n - 1)), and empties
		// the query after a pick, so each case is its own search.
		fireEvent.keyDown(input, { key: "ArrowUp" });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "one" }));

		expect((input as HTMLInputElement).value).toBe("");
		fireEvent.change(input, { target: { value: "setting" } });
		fireEvent.keyDown(input, { key: "ArrowDown" });
		fireEvent.keyDown(input, { key: "ArrowDown" });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ key: "two" }));
	});

	it("clears the query on Escape without leaving", () => {
		render(<SettingsSearch index={[setting("zoom", "App zoom")]} onOpen={() => undefined} />);
		const input = screen.getByRole("searchbox", { name: "Search settings" }) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "zoom" } });
		fireEvent.keyDown(input, { key: "Escape" });

		expect(input.value).toBe("");
		expect(screen.queryAllByRole("button")).toEqual([]);
	});

	it("says when no setting matches", () => {
		render(<SettingsSearch index={[setting("zoom", "App zoom")]} onOpen={() => undefined} />);
		fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), {
			target: { value: "nothing" },
		});
		// Conductor's words: No settings match "<query>".
		expect(screen.getByText('No settings match "nothing"')).toBeTruthy();
	});
});

describe("SET-02 SettingsSearch field and popover", () => {
	it("sizes the field the way Conductor does and keeps the results outside the sidebar", () => {
		render(<SettingsSearch index={[setting("zoom", "App zoom")]} onOpen={() => undefined} />);
		const input = screen.getByRole("searchbox", { name: "Search settings" });
		const field = input.parentElement as HTMLElement;
		expect(field.className).toContain("relative");
		expect(field.className).toContain("w-full");
		expect(field.className).toContain("min-w-0");
		expect(input.className).toContain("h-7");
		expect(input.className).not.toContain("h-8");
		expect(input.className).toContain("pl-8");
		expect(input.className).toContain("pr-10");
		expect(input.className).toContain("w-full");
		expect(input.getAttribute("spellcheck")).toBe("false");

		fireEvent.change(input, { target: { value: "zoom" } });
		const list = screen.getByRole("list", { name: "Settings search results" });
		expect(field.contains(list)).toBe(false);
	});

	it("hides the shortcut hint while the query is typed", () => {
		render(
			<SettingsSearch
				index={[setting("zoom", "App zoom")]}
				onOpen={() => undefined}
				searchShortcut="⌘F"
			/>,
		);
		const input = screen.getByRole("searchbox", { name: "Search settings" });
		expect(screen.getByLabelText("Search settings shortcut")).toBeTruthy();
		fireEvent.change(input, { target: { value: "z" } });
		expect(screen.queryByLabelText("Search settings shortcut")).toBeNull();
	});
});

describe("SET-02 SettingsSearch controls", () => {
	it("names the shortcut and clears the query with Conductor's controls", () => {
		render(
			<SettingsSearch
				index={[setting("zoom", "App zoom")]}
				onOpen={() => undefined}
				searchShortcut="⌘F"
			/>,
		);
		expect(screen.getByLabelText("Search settings shortcut")).toBeTruthy();
		const input = screen.getByRole("searchbox", { name: "Search settings" }) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "zoom" } });
		fireEvent.click(screen.getByRole("button", { name: "Clear settings search" }));
		expect(input.value).toBe("");
	});
});
