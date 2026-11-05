import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Repo, Workspace } from "../../core/model.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";

const hooks = vi.hoisted(() => {
	// A zustand store returns the same snapshot until state changes; a fresh object here
	// makes useSyncExternalStore loop forever.
	const snapshot = { loaded: true, sections: [] };
	return {
		repos: { state: "ready", data: [] } as Loadable<Repo[]>,
		workspaces: { state: "ready", data: [] } as Loadable<Workspace[]>,
		sectionsStore: {
			getState: () => snapshot,
			getInitialState: () => snapshot,
			subscribe: () => () => {},
			setState: () => {},
		},
	};
});

vi.mock("../../core/hooks.ts", () => ({
	useRepos: () => hooks.repos,
	useWorkspaces: () => hooks.workspaces,
	useSetting: () => false,
	useLiveShortcut: () => null,
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({
		services: {
			repo: { start: vi.fn() },
			workspace: { start: vi.fn() },
			sections: { store: hooks.sectionsStore },
		},
	}),
}));

vi.mock("./AddProjectButton.tsx", () => ({
	AddProjectButton: () => <button type="button">Add a project</button>,
}));

const { Sidebar } = await import("./Sidebar.tsx");

afterEach(cleanup);

describe("NAV-03 Sidebar", () => {
	it("shows the navigation rows and the no-projects empty state", async () => {
		renderWithRouter(<Sidebar />);
		expect(await screen.findByRole("link", { name: /Home/ })).toBeTruthy();
		expect(screen.getByRole("link", { name: /Create/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Search/ })).toBeTruthy();
		expect(await screen.findByText("No projects yet")).toBeTruthy();
	});

	it("makes Settings reachable from the footer", async () => {
		renderWithRouter(<Sidebar />);
		const settings = await screen.findByRole("link", { name: /Settings/ });
		expect(settings.getAttribute("href")).toBe("/settings");
	});
});
