import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { SidebarEmptyState } from "./SidebarEmptyState.tsx";

afterEach(cleanup);

describe("APP-04 SidebarEmptyState", () => {
	it("invites the user to add a project when there are none", async () => {
		renderWithRouter(<SidebarEmptyState kind="no-projects" />);
		// Conductor's empty list is one sentence; our heading and button are gone (D098).
		expect(screen.queryByRole("heading", { name: "No projects yet" })).toBeNull();
		expect(await screen.findByText("Add a project to get started.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Add a project" })).toBeNull();
	});

	it("links to the new-workspace page when projects have no workspaces", async () => {
		renderWithRouter(<SidebarEmptyState kind="no-workspaces" />);
		expect(await screen.findByRole("heading", { name: "No workspaces yet" })).toBeTruthy();
		const link = screen.getByRole("link", { name: "New workspace" });
		expect(link.getAttribute("href")).toBe("/create");
	});
});
