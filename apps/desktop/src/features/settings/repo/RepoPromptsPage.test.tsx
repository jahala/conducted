import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig } from "../../../core/model.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../../../test/container.ts";
import { RepoPromptSettings } from "./RepoPromptsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

const config = (changes: Partial<RepoConfig> = {}): RepoConfig => ({
	setupScript: null,
	runScripts: [],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [".env*"],
	previewUrls: [],
	spotlightTesting: false,
	autoRunAfterSetup: false,
	remoteName: null,
	prompts: {
		general: "Noted.",
		codeReview: "Review the change.",
		createPr: null,
		fixErrors: null,
		resolveConflicts: null,
		renameBranch: null,
	},
	...changes,
});

async function renderPage(initial: RepoConfig) {
	test = createTestContainer();
	const repo = await seedRepo(test.container);
	test.container.services.repo.store.setState((state) => ({
		...state,
		configs: { ...state.configs, [repo.id]: initial },
	}));
	const updateConfig = vi
		.spyOn(test.container.actions.projects, "updateConfig")
		.mockResolvedValue(ok(undefined));
	render(
		<ServicesProvider container={test.container}>
			<RepoPromptSettings repoId={repo.id} />
		</ServicesProvider>,
	);
	await screen.findByText("Code review preferences");
	return { updateConfig };
}

/** Opens one of Conductor's closed rows and gives its field. */
function openField(label: string): HTMLTextAreaElement {
	fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
	return screen.getByLabelText(`${label} prompt`) as HTMLTextAreaElement;
}

describe("SET-07 RepoPromptSettings", () => {
	it("stores null, not an empty string, when the Review field is cleared", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);

		const review = openField("Code review preferences");
		fireEvent.change(review, { target: { value: "" } });
		fireEvent.blur(review);

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]?.prompts).toEqual({
			general: "Noted.",
			codeReview: null,
			createPr: null,
			fixErrors: null,
			resolveConflicts: null,
			renameBranch: null,
		});
	});

	it("saves the other fields as they are shown when one is edited", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);

		fireEvent.change(openField("Create PR preferences"), {
			target: { value: "Write a short description." },
		});
		const review = openField("Code review preferences");
		fireEvent.change(review, {
			target: { value: "Check the tests first." },
		});
		fireEvent.blur(review);

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]?.prompts).toMatchObject({
			general: "Noted.",
			codeReview: "Check the tests first.",
			createPr: "Write a short description.",
		});
	});

	it("resets one field to the built-in instructions", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);

		const review = openField("Code review preferences");
		fireEvent.click(screen.getByRole("button", { name: "Reset" }));

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]?.prompts.codeReview).toBeNull();
		expect(review.value).toBe("");
	});

	// Conductor's rows, in its order, closed until opened; a row holding text says "Customized".
	it("shows a row for every prompt the app sends, in Conductor's order and words", async () => {
		await renderPage(config());

		const labels = [
			"Code review preferences",
			"Create PR preferences",
			"Fix errors preferences",
			"Resolve conflicts preferences",
			"Branch rename preferences",
			"General preferences",
		];
		const rows = screen.getAllByRole("button", { name: /preferences/ });
		expect(rows.map((row) => row.querySelector(".font-medium")?.textContent)).toEqual(labels);
		expect(screen.queryByLabelText("Code review preferences prompt")).toBeNull();
		expect(rows[0]?.textContent).toContain("Customized");
		expect(rows[1]?.textContent).not.toContain("Customized");
		for (const label of labels) {
			expect(openField(label)).toBeTruthy();
		}
	});

	it("warns when the instructions are very long", async () => {
		await renderPage(config());

		fireEvent.change(openField("Code review preferences"), {
			target: { value: "a".repeat(4_001) },
		});

		expect(screen.getByText(/These instructions are long/)).toBeTruthy();
	});
});
