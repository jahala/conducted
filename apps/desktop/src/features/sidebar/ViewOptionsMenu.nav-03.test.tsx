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

const actions = { onNewSection: () => {}, onAddProject: () => {} };

async function openMenu() {
	fireEvent.keyDown(screen.getByRole("button", { name: "My workspaces actions" }), {
		key: "Enter",
	});
	return screen.findByRole("menu");
}

describe("NAV-03 ViewOptionsMenu", () => {
	it("ends with New section… and Add project…, as Conductor's list header menu does", async () => {
		const onNewSection = vi.fn();
		const onAddProject = vi.fn();
		render(
			<ViewOptionsMenu
				view={baseView}
				repos={[repo("app")]}
				onChange={() => {}}
				onNewSection={onNewSection}
				onAddProject={onAddProject}
			/>,
		);
		await openMenu();
		const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
		expect(items.slice(-2)).toEqual(["New section…", "Add project…"]);
		fireEvent.click(screen.getByRole("menuitem", { name: "Add project…" }));
		expect(onAddProject).toHaveBeenCalledTimes(1);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: "New section…" }));
		expect(onNewSection).toHaveBeenCalledTimes(1);
	});

	it("calls onChange with groupBy project when Project is chosen", async () => {
		const onChange = vi.fn();
		render(
			<ViewOptionsMenu {...actions} view={baseView} repos={[repo("app")]} onChange={onChange} />,
		);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "Project" }));
		expect(onChange).toHaveBeenCalledWith({ ...baseView, groupBy: "project" });
	});

	it("hides Sort by while manual order is on", async () => {
		render(
			<ViewOptionsMenu
				{...actions}
				view={{ ...baseView, manualOrder: true }}
				repos={[repo("app")]}
				onChange={() => {}}
			/>,
		);
		await openMenu();
		expect(screen.queryByText("Sort by")).toBeNull();
		expect(screen.getByText("Filter by project")).toBeTruthy();
	});

	it("changes the sort choice", async () => {
		const onChange = vi.fn();
		render(
			<ViewOptionsMenu {...actions} view={baseView} repos={[repo("app")]} onChange={onChange} />,
		);
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
			<ViewOptionsMenu
				{...actions}
				view={baseView}
				repos={[repo("app"), repo("api")]}
				onChange={onChange}
			/>,
		);
		await openFilter();
		fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "api" }));
		expect(onChange).toHaveBeenCalledWith({ ...baseView, projectFilter: ["api"] });
	});

	it("drops a filter entry for a project that was removed when another is chosen", async () => {
		const onChange = vi.fn();
		render(
			<ViewOptionsMenu
				{...actions}
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
			<ViewOptionsMenu
				{...actions}
				view={baseView}
				repos={[repo("a1"), repo("a2")]}
				onChange={() => {}}
			/>,
		);
		await openFilter();
		await screen.findByRole("menuitemcheckbox", { name: "a1" });
		expect(screen.queryByRole("textbox", { name: "Search projects" })).toBeNull();
		few.unmount();
		cleanup();

		const names = ["alpha", "beta", "gamma", "delta", "epsilon"];
		render(
			<ViewOptionsMenu {...actions} view={baseView} repos={names.map(repo)} onChange={() => {}} />,
		);
		await openFilter();
		fireEvent.change(await screen.findByRole("textbox", { name: "Search projects" }), {
			target: { value: "ga" },
		});
		expect(screen.getByRole("menuitemcheckbox", { name: "gamma" })).toBeTruthy();
		expect(screen.queryByRole("menuitemcheckbox", { name: "alpha" })).toBeNull();
	});
});
