import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { HomeEmptyState } from "./HomeEmptyState.tsx";

afterEach(cleanup);

describe("NAV-05 HomeEmptyState", () => {
	it("offers to clear filters when filters hide everything", async () => {
		const onClearFilters = vi.fn();
		renderWithRouter(
			<HomeEmptyState filtersActive archivedOnly={false} onClearFilters={onClearFilters} />,
		);
		expect(await screen.findByRole("heading", { name: "No matching workspaces" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
		expect(onClearFilters).toHaveBeenCalledTimes(1);
	});

	it("says nothing is archived when only archived workspaces were asked for", async () => {
		renderWithRouter(<HomeEmptyState filtersActive archivedOnly onClearFilters={() => {}} />);
		expect(await screen.findByRole("heading", { name: "Nothing is archived" })).toBeTruthy();
	});

	it("invites the user to create the first workspace", async () => {
		renderWithRouter(
			<HomeEmptyState filtersActive={false} archivedOnly={false} onClearFilters={() => {}} />,
		);
		const link = await screen.findByRole("link", { name: "Create a workspace" });
		expect(link.getAttribute("href")).toBe("/create");
	});
});
