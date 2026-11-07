import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
	// Conductor's Git page (renderApp, the git tab): the branch prefix is three radios, and the
	// custom one opens a field with a preview of a workspace named "tokyo".
	it("previews a custom branch prefix", async () => {
		const container = (await renderPage()).container;

		fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
		await waitFor(() =>
			expect(container.services.settings.store.getState().values.branch_prefix_type).toBe(
				"custom",
			),
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
