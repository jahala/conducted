import type { RepoId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Repo } from "../../core/model.ts";
import type { SidebarView } from "./sidebar-view.ts";
import { ViewOptionsMenu } from "./ViewOptionsMenu.tsx";

afterEach(cleanup);

function repo(id: string): Repo {
	return {
		id: id as RepoId,
		name: id,
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

const baseView: SidebarView = {
	groupBy: "status",
	sortBy: "updated",
	manualOrder: false,
	projectFilter: [],
};

async function openMenu() {
	fireEvent.keyDown(screen.getByRole("button", { name: "Sort workspaces" }), { key: "Enter" });
	return screen.findByRole("menu");
}

describe("NAV-03 ViewOptionsMenu", () => {
	it("calls onChange with groupBy project when Project is chosen", async () => {
		const onChange = vi.fn();
		render(<ViewOptionsMenu view={baseView} repos={[repo("app")]} onChange={onChange} />);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "Project" }));
		expect(onChange).toHaveBeenCalledWith({ ...baseView, groupBy: "project" });
	});

	it("keeps Sort by visible until a saved manual order exists", async () => {
		render(
			<ViewOptionsMenu
				view={{ ...baseView, manualOrder: true }}
				repos={[repo("app")]}
				onChange={() => {}}
			/>,
		);
		await openMenu();
		expect(screen.getByText("Sort by")).toBeTruthy();
		expect(screen.getByText("Filter by project")).toBeTruthy();
	});

	it("changes the sort choice", async () => {
		const onChange = vi.fn();
		render(<ViewOptionsMenu view={baseView} repos={[repo("app")]} onChange={onChange} />);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "Created" }));
		expect(onChange).toHaveBeenCalledWith({ ...baseView, sortBy: "created" });
	});

	const openFilter = async () => {
		await openMenu();
		fireEvent.keyDown(await screen.findByRole("menuitem", { name: "Filter by project" }), {
			key: "ArrowRight",
		});
	};

	it("adds a project to the filter when it is checked", async () => {
		const onChange = vi.fn();
		render(
			<ViewOptionsMenu view={baseView} repos={[repo("app"), repo("api")]} onChange={onChange} />,
		);
		await openFilter();
		fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "api" }));
		expect(onChange).toHaveBeenCalledWith({ ...baseView, projectFilter: ["api"] });
	});

	it("drops a filter entry for a project that was removed when another is chosen", async () => {
		const onChange = vi.fn();
		render(
			<ViewOptionsMenu
				view={{ ...baseView, projectFilter: ["gone" as RepoId] }}
				repos={[repo("app"), repo("api")]}
				onChange={onChange}
			/>,
		);
		await openFilter();
		fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "api" }));
		expect(onChange).toHaveBeenCalledWith({ ...baseView, projectFilter: ["api"] });
	});

	it("offers a project search only from five projects and filters the list by it", async () => {
		const few = render(
			<ViewOptionsMenu view={baseView} repos={[repo("a1"), repo("a2")]} onChange={() => {}} />,
		);
		await openFilter();
		await screen.findByRole("menuitemcheckbox", { name: "a1" });
		expect(screen.queryByRole("textbox", { name: "Search projects" })).toBeNull();
		few.unmount();
		cleanup();

		const names = ["alpha", "beta", "gamma", "delta", "epsilon"];
		render(<ViewOptionsMenu view={baseView} repos={names.map(repo)} onChange={() => {}} />);
		await openFilter();
		fireEvent.change(await screen.findByRole("textbox", { name: "Search projects" }), {
			target: { value: "ga" },
		});
		expect(screen.getByRole("menuitemcheckbox", { name: "gamma" })).toBeTruthy();
		expect(screen.queryByRole("menuitemcheckbox", { name: "alpha" })).toBeNull();
	});
});
