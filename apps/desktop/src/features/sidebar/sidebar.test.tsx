import { appError } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Repo, Workspace } from "../../core/model.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { UnreadDot } from "./UnreadDot.tsx";

const hooks = vi.hoisted(() => ({
	repos: { state: "loading" } as Loadable<Repo[]>,
	workspaces: { state: "loading" } as Loadable<Workspace[]>,
}));

vi.mock("../../core/hooks.ts", () => ({
	useRepos: () => hooks.repos,
	useWorkspaces: () => hooks.workspaces,
}));

// The grouped list is built later; this test is about which state the list region picks.
vi.mock("./GroupedWorkspaces.tsx", () => ({
	GroupedWorkspaces: () => <p>grouped list</p>,
}));

vi.mock("./AddProjectButton.tsx", () => ({
	AddProjectButton: () => <button type="button">Add a project</button>,
}));

const { WorkspaceList } = await import("./WorkspaceList.tsx");
const { SidebarEmptyState } = await import("./SidebarEmptyState.tsx");

afterEach(cleanup);

const repo = { id: "r1", name: "app" } as unknown as Repo;
const workspace = { id: "w1" } as unknown as Workspace;

describe("NAV-03 WorkspaceList", () => {
	it("announces loading while projects load", () => {
		hooks.repos = { state: "loading" };
		render(<WorkspaceList />);
		expect(screen.getByRole("status", { name: "Loading workspaces" })).toBeTruthy();
	});

	it("shows the error with a way to see what failed", () => {
		hooks.repos = { state: "error", error: appError("db", "Database is locked") };
		render(<WorkspaceList />);
		expect(screen.getByText("Couldn't load projects")).toBeTruthy();
		expect(screen.getByText("Database is locked")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
	});

	it("invites the user to add a project when there is none", async () => {
		hooks.repos = { state: "ready", data: [] };
		hooks.workspaces = { state: "ready", data: [] };
		renderWithRouter(<WorkspaceList />);
		expect(await screen.findByText("No projects yet")).toBeTruthy();
	});

	it("invites the user to create a workspace when a project has none", async () => {
		hooks.repos = { state: "ready", data: [repo] };
		hooks.workspaces = { state: "ready", data: [] };
		renderWithRouter(<WorkspaceList />);
		expect(await screen.findByText("No workspaces yet")).toBeTruthy();
		expect(screen.getByRole("link", { name: "New workspace" }).getAttribute("href")).toBe(
			"/create",
		);
	});

	it("shows the list when there are workspaces", () => {
		hooks.repos = { state: "ready", data: [repo] };
		hooks.workspaces = { state: "ready", data: [workspace] };
		render(<WorkspaceList />);
		expect(screen.getByText("grouped list")).toBeTruthy();
	});
});

describe("SidebarEmptyState", () => {
	it("offers adding a project when none exists", async () => {
		renderWithRouter(<SidebarEmptyState kind="no-projects" />);
		expect(await screen.findByRole("heading", { name: "No projects yet" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add a project" })).toBeTruthy();
	});
});

describe("UnreadDot", () => {
	it("is named for screen readers when there is something unread", () => {
		render(<UnreadDot unread />);
		expect(screen.getByRole("img", { name: "Unread" })).toBeTruthy();
	});
	it("renders nothing otherwise", () => {
		const { container } = render(<UnreadDot unread={false} />);
		expect(container.firstChild).toBeNull();
	});
});
