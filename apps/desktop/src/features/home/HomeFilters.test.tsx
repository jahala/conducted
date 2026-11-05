import type { RepoId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Repo } from "../../core/model.ts";
import { HomeFilters, SEARCH_PAUSE_MS } from "./HomeFilters.tsx";
import type { HomeDisplay, HomeFilterState } from "./home-query.ts";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const FILTERS: HomeFilterState = {
	search: "",
	projects: [],
	archivedOnly: false,
	sortBy: "updated",
};

const DISPLAY: HomeDisplay = new Set(["repository", "lastActive"]);

function repo(id: string, name: string): Repo {
	return {
		id: id as RepoId,
		name,
		rootPath: `/repos/${id}`,
		remoteUrl: null,
		defaultBranch: "main",
		icon: null,
		displayOrder: 0,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
	};
}

function renderFilters(
	overrides: {
		repos?: Repo[];
		display?: HomeDisplay;
		onChange?: (filters: HomeFilterState) => void;
		onDisplayChange?: (display: HomeDisplay) => void;
	} = {},
) {
	const onChange = overrides.onChange ?? vi.fn();
	const onDisplayChange = overrides.onDisplayChange ?? vi.fn();
	render(
		<HomeFilters
			filters={FILTERS}
			repos={overrides.repos ?? []}
			display={overrides.display ?? DISPLAY}
			onChange={onChange}
			onDisplayChange={onDisplayChange}
		/>,
	);
	return { onChange, onDisplayChange };
}

describe("NAV-05 HomeFilters", () => {
	it("calls onChange once with the search after the pause", () => {
		vi.useFakeTimers();
		const { onChange } = renderFilters();
		const input = screen.getByRole("searchbox", { name: "Search workspaces" });
		fireEvent.change(input, { target: { value: "a" } });
		fireEvent.change(input, { target: { value: "au" } });
		fireEvent.change(input, { target: { value: "aut" } });
		fireEvent.change(input, { target: { value: "auth" } });
		expect(onChange).not.toHaveBeenCalled();
		act(() => {
			vi.advanceTimersByTime(SEARCH_PAUSE_MS);
		});
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: "auth" }));
	});

	it("clears the search at once on Escape", () => {
		const { onChange } = renderFilters();
		const input = screen.getByRole("searchbox", { name: "Search workspaces" });
		fireEvent.change(input, { target: { value: "auth" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: "" }));
		expect((input as HTMLInputElement).value).toBe("");
	});

	it("filters to one project", async () => {
		const { onChange } = renderFilters({ repos: [repo("app", "app"), repo("api", "api")] });
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter by project" }), {
			key: "Enter",
		});
		const option = await screen.findByRole("option", { name: "api" });
		fireEvent.keyDown(option, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ projects: ["api" as RepoId] }));
	});

	it("switches the active or archived toggle", () => {
		const { onChange } = renderFilters();
		fireEvent.click(screen.getByRole("radio", { name: "Archived" }));
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ archivedOnly: true }));
	});

	it("changes the sort order", async () => {
		const { onChange } = renderFilters();
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Sort workspaces" }), {
			key: "Enter",
		});
		const option = await screen.findByRole("option", { name: "Created" });
		fireEvent.keyDown(option, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sortBy: "created" }));
	});

	it("turns a card field off from the Display menu", async () => {
		const { onDisplayChange } = renderFilters();
		const trigger = screen.getByRole("button", { name: "Display" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		const item = await screen.findByRole("menuitemcheckbox", { name: "Repository" });
		fireEvent.click(item);
		expect(onDisplayChange).toHaveBeenCalledWith(new Set(["lastActive"]));
	});
});
