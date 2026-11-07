import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig } from "../../../core/model.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../../../test/container.ts";
import { RepoPromptsPage } from "./RepoPromptsPage.tsx";

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
	previewUrlTemplate: null,
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
			<RepoPromptsPage repoId={repo.id} />
		</ServicesProvider>,
	);
	await screen.findByLabelText("Review");
	return { updateConfig };
}

describe("SET-07 RepoPromptsPage", () => {
	it("stores null, not an empty string, when the Review field is cleared", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);

		const review = screen.getByLabelText("Review");
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

		fireEvent.change(screen.getByLabelText("Create PR"), {
			target: { value: "Write a short description." },
		});
		fireEvent.change(screen.getByLabelText("Review"), {
			target: { value: "Check the tests first." },
		});
		fireEvent.blur(screen.getByLabelText("Review"));

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

		const resetButtons = screen.getAllByRole("button", { name: "Reset" });
		const reviewReset = resetButtons[1];
		if (reviewReset === undefined) throw new Error("Review reset button was not found.");
		fireEvent.click(reviewReset);

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]?.prompts.codeReview).toBeNull();
		expect((screen.getByLabelText("Review") as HTMLTextAreaElement).value).toBe("");
	});

	it("shows a field for every prompt the app sends", async () => {
		await renderPage(config());

		for (const label of [
			"General preferences",
			"Review",
			"Create PR",
			"Fix errors",
			"Resolve conflicts",
			"Rename branch",
		]) {
			expect(screen.getByLabelText(label)).toBeTruthy();
		}
	});

	it("warns when the instructions are very long", async () => {
		await renderPage(config());

		fireEvent.change(screen.getByLabelText("Review"), {
			target: { value: "a".repeat(4_001) },
		});

		expect(screen.getByText(/These instructions are long/)).toBeTruthy();
	});
});
