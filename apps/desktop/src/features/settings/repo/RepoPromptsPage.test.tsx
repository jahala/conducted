import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig } from "../../../core/model.ts";
import {
	createTestContainer,
	seedInvalidLocalSettings,
	seedRepo,
	type TestContainer,
} from "../../../test/container.ts";
import { Toaster, toast } from "../../../ui/Toast.tsx";
import { RepoPromptSettings } from "./RepoPromptsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
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

	// Conductor saves a prompt through its settings writer, whose failed-save toast offers
	// "Overwrite file" for an invalid file (Uz, main @389730). The row's own "Failed to save custom
	// prompt" is only for a save that throws (renderApp @10909187, Oja @10903526). Ours said
	// "Couldn't save the instructions" (issue #654).
	it("offers Overwrite file when a prompt meets an invalid local settings file, and pressing it saves", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const file = await seedInvalidLocalSettings(test, repo);
		render(
			<ServicesProvider container={test.container}>
				<RepoPromptSettings repoId={repo.id} />
				<Toaster />
			</ServicesProvider>,
		);
		await screen.findByText("Code review preferences");

		const review = openField("Code review preferences");
		fireEvent.change(review, { target: { value: "Check the tests first." } });
		fireEvent.blur(review);
		const shown = await waitFor(() => {
			const element = document.querySelector("[data-sonner-toast]");
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		expect(shown.querySelector("[data-title]")?.textContent).toBe(
			"Can't save setting because your settings file is invalid",
		);
		fireEvent.click(within(shown).getByRole("button", { name: "Overwrite file" }));

		const settings = test.container.services.settings;
		await waitFor(async () => {
			const read = await settings.readSettingsFile(file);
			expect(read.ok && read.value.values).toMatchObject({
				archive_on_merge: true,
				custom_prompt_code_review: "Check the tests first.",
			});
		});
	});
});
