import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsNav } from "./SettingsNav.tsx";

afterEach(cleanup);

describe("SET-02 SettingsNav", () => {
	it("marks only the active page with aria-current", () => {
		render(
			<SettingsNav
				active={{ kind: "user", page: "general" }}
				repos={[]}
				onNavigate={() => undefined}
				onBack={() => undefined}
				searchSlot={null}
			/>,
		);

		expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe(
			"page",
		);
		expect(screen.getByRole("button", { name: "Account" }).getAttribute("aria-current")).toBeNull();
	});

	it("puts the groups in Conductor's order, with Connections in More after Advanced", () => {
		render(
			<SettingsNav
				active={{ kind: "user", page: "general" }}
				repos={[{ id: "repo-1", name: "Alpha" }]}
				onNavigate={() => undefined}
				onBack={() => undefined}
				searchSlot={null}
			/>,
		);

		const headings = ["Personal", "Agents & environment", "Repositories", "More"].map((name) =>
			screen.getByText(name),
		);
		expect(headings).toHaveLength(4);
		for (let index = 1; index < headings.length; index++) {
			const before = headings[index - 1] as HTMLElement;
			const after = headings[index] as HTMLElement;
			expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		}
		const advanced = screen.getByRole("button", { name: "Advanced" });
		const connections = screen.getByRole("button", { name: "Connections" });
		expect(
			advanced.compareDocumentPosition(connections) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("lists each repository and opens its pages", () => {
		const onNavigate = vi.fn();
		render(
			<SettingsNav
				active={{ kind: "user", page: "general" }}
				repos={[
					{ id: "repo-1", name: "Alpha" },
					{ id: "repo-2", name: "Beta" },
				]}
				onNavigate={onNavigate}
				onBack={() => undefined}
				searchSlot={null}
			/>,
		);

		// As in Conductor, every repository is its own entry; a click opens its first page.
		fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
		expect(onNavigate).toHaveBeenCalledWith({ kind: "repo", repoId: "repo-1", page: "scripts" });
	});

	it("shows the open repository's pages under it", () => {
		const onNavigate = vi.fn();
		render(
			<SettingsNav
				active={{ kind: "repo", repoId: "repo-1" as never, page: "scripts" }}
				repos={[
					{ id: "repo-1", name: "Alpha" },
					{ id: "repo-2", name: "Beta" },
				]}
				onNavigate={onNavigate}
				onBack={() => undefined}
				searchSlot={null}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Actions" }));
		expect(onNavigate).toHaveBeenCalledWith({ kind: "repo", repoId: "repo-1", page: "actions" });
	});

	it("says when no project can be edited yet", () => {
		render(
			<SettingsNav
				active={{ kind: "user", page: "general" }}
				repos={[]}
				onNavigate={() => undefined}
				onBack={() => undefined}
				searchSlot={null}
			/>,
		);
		expect(screen.getByText(/No projects yet/)).toBeTruthy();
	});
});
