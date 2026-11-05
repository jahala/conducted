import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { SidebarEmptyState } from "./SidebarEmptyState.tsx";

vi.mock("./AddProjectButton.tsx", () => ({
	AddProjectButton: () => <button type="button">Add a project</button>,
}));

afterEach(cleanup);

describe("APP-04 SidebarEmptyState", () => {
	it("invites the user to add a project when there are none", async () => {
		renderWithRouter(<SidebarEmptyState kind="no-projects" />);
		expect(await screen.findByRole("heading", { name: "No projects yet" })).toBeTruthy();
		expect(screen.getByText("Add a project to get started.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add a project" })).toBeTruthy();
	});

	it("links to the new-workspace page when projects have no workspaces", async () => {
		renderWithRouter(<SidebarEmptyState kind="no-workspaces" />);
		expect(await screen.findByRole("heading", { name: "No workspaces yet" })).toBeTruthy();
		const link = screen.getByRole("link", { name: "New workspace" });
		expect(link.getAttribute("href")).toBe("/create");
	});
});
