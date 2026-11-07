import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { GitPage } from "./GitPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function renderPage() {
	test = createTestContainer();
	await test.container.services.settings.start();
	render(
		<ServicesProvider container={test.container}>
			<GitPage />
		</ServicesProvider>,
	);
	return test;
}

describe("SET-02 GitPage", () => {
	it("puts the Open pull requests in picker under its title, as Conductor does", async () => {
		await renderPage();
		const row = document.querySelector('[data-setting-key="pull_request_open_target"]');
		if (!(row instanceof HTMLElement)) throw new Error("no Open pull requests in row");
		const picker = within(row).getByRole("combobox", { name: "Open pull requests in" });
		// The first is the row's title; the fieldset's hidden legend repeats it.
		const [title] = within(row).getAllByText("Open pull requests in");
		if (title === undefined) throw new Error("no title");
		expect((title.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(
			true,
		);
		expect(row.querySelector("[data-stacked='true']")).not.toBeNull();
	});

	it("links to GitHub's branch deletion setting and warns while archive deletes the branch", async () => {
		const container = (await renderPage()).container;
		const openUrl = vi.spyOn(container.actions.app, "openUrl").mockResolvedValue(ok(undefined));
		const row = document.querySelector('[data-setting-key="delete_branch_on_archive"]');
		if (!(row instanceof HTMLElement)) throw new Error("no Delete branch on archive row");

		expect(
			within(row).getByText("Delete the local branch when archiving a workspace."),
		).toBeTruthy();
		fireEvent.click(within(row).getByRole("link", { name: "configure it on GitHub" }));
		await waitFor(() =>
			expect(openUrl).toHaveBeenCalledWith(
				"https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches",
			),
		);

		expect(
			within(row).queryByText("Warning: archived workspaces will be unrecoverable"),
		).toBeNull();
		fireEvent.click(within(row).getByRole("switch", { name: "Delete branch on archive" }));
		expect(
			await within(row).findByText("Warning: archived workspaces will be unrecoverable"),
		).toBeTruthy();
	});

	// Conductor's Git page (renderApp, the git tab): the branch prefix is three radios, and the
	// custom one opens a field with a preview of a workspace named "tokyo".
	it("previews a custom branch prefix", async () => {
		const container = (await renderPage()).container;

		fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
		await waitFor(() =>
			expect(container.services.settings.store.getState().values.branch_prefix_type).toBe("custom"),
		);
		const prefix = await screen.findByPlaceholderText("e.g. feature/ or myname-");
		fireEvent.change(prefix, { target: { value: "feature/" } });
		fireEvent.blur(prefix);

		await waitFor(() =>
			expect(container.services.settings.store.getState().values.branch_prefix_custom).toBe(
				"feature/",
			),
		);
		expect(await screen.findByText("Preview: feature/tokyo")).toBeTruthy();
	});

	it("lists Conductor's rows in its order, with no repository-only row", async () => {
		await renderPage();
		const titles = [...document.querySelectorAll("[data-setting-key]")].map((row) =>
			row.getAttribute("data-setting-key"),
		);
		expect(titles.slice(0, 3)).toEqual([
			"pull_request_open_target",
			"include_workspace_link_in_pr",
			"branch_prefix_type",
		]);
		// The remote is the repository's (its Misc page), and the custom text belongs to the radio.
		expect(titles).not.toContain("remote_name");
		expect(titles).not.toContain("branch_prefix_custom");
		expect(screen.getByRole("radio", { name: "GitHub username" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "None" })).toBeTruthy();
	});
});
