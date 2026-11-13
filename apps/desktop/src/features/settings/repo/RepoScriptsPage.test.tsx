import { appError, err, ok } from "@conducted/shared";
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
import { RepoScriptsPage } from "./RepoScriptsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	test?.close();
	test = undefined;
});

const config = (changes: Partial<RepoConfig> = {}): RepoConfig => ({
	setupScript: "pnpm install",
	runScripts: [],
	runMode: "concurrent",
	archiveScript: "pnpm clean",
	copyFiles: [".env"],
	previewUrls: [],
	spotlightTesting: false,
	autoRunAfterSetup: false,
	remoteName: null,
	prompts: {
		general: null,
		codeReview: null,
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
			<RepoScriptsPage repoId={repo.id} />
		</ServicesProvider>,
	);
	await screen.findByLabelText("Setup script");
	return { updateConfig, repoId: repo.id };
}

describe("SET-07 RepoScriptsPage", () => {
	it("saves the new setup script with every other field unchanged", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);

		const setup = screen.getByLabelText("Setup script");
		fireEvent.change(setup, { target: { value: "pnpm setup" } });
		fireEvent.blur(setup);

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toEqual({
			...initial,
			setupScript: "pnpm setup",
		});
	});

	it("keeps text typed in the archive field when the setup script is saved", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);

		fireEvent.change(screen.getByLabelText("Setup script"), {
			target: { value: "pnpm setup" },
		});
		fireEvent.change(screen.getByLabelText("Archive script"), {
			target: { value: "pnpm archive" },
		});
		fireEvent.blur(screen.getByLabelText("Setup script"));

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({
			setupScript: "pnpm setup",
			archiveScript: "pnpm archive",
			runMode: "concurrent",
			autoRunAfterSetup: false,
		});
	});

	it("clears a script that is emptied and does not save an unchanged field", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);

		const setup = screen.getByLabelText("Setup script");
		fireEvent.blur(setup);
		expect(updateConfig).not.toHaveBeenCalled();

		fireEvent.change(setup, { target: { value: "   " } });
		fireEvent.blur(setup);

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({ setupScript: null });
	});

	it("keeps the text and shows the failure when the save fails", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);
		updateConfig.mockResolvedValue(
			err(appError("settings_save_failed", "The settings file is read-only.")),
		);

		const setup = screen.getByLabelText("Setup script");
		fireEvent.change(setup, { target: { value: "pnpm setup" } });
		fireEvent.blur(setup);

		expect((await screen.findByRole("alert")).textContent).toContain(
			"The settings file is read-only.",
		);
		expect((setup as HTMLTextAreaElement).value).toBe("pnpm setup");
	});

	it("saves the auto-run switch", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);

		fireEvent.click(screen.getByRole("switch", { name: "Start the default action after setup" }));

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({ autoRunAfterSetup: true });
	});

	it("saves the run mode", async () => {
		const initial = config();
		const { updateConfig } = await renderPage(initial);

		fireEvent.keyDown(screen.getByRole("combobox", { name: "Run mode" }), { key: "Enter" });
		const oneAtATime = await screen.findByRole("option", { name: "One at a time" });
		fireEvent.keyDown(oneAtATime, { key: "Enter" });

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({ runMode: "exclusive" });
	});

	it("names the variables the app gives a script", async () => {
		await renderPage(config());

		expect(screen.getByText(/CONDUCTED_WORKSPACE_PATH/)).toBeTruthy();
		expect(screen.getByText(/CONDUCTED_PORT/)).toBeTruthy();
	});

	// Conductor saves a script through its settings writer, whose failed-save toast offers
	// "Overwrite file" for an invalid file (Uz, main @389730; mutateSettingsFile, @415335). The
	// page's own "Failed to save script" is only for a save that throws (renderApp @11025079,
	// Oja @10903526). Ours said "Couldn't save the scripts" (issue #654).
	it("offers Overwrite file when the local settings file does not parse, and pressing it saves the script", async () => {
		test = createTestContainer();
		const { container } = test;
		const repo = await seedRepo(container);
		const file = await seedInvalidLocalSettings(test, repo);
		render(
			<ServicesProvider container={container}>
				<RepoScriptsPage repoId={repo.id} />
				<Toaster />
			</ServicesProvider>,
		);

		const setup = await screen.findByLabelText("Setup script");
		fireEvent.change(setup, { target: { value: "pnpm setup" } });
		fireEvent.blur(setup);
		const shown = await waitFor(() => {
			const element = document.querySelector("[data-sonner-toast]");
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		expect(shown.querySelector("[data-title]")?.textContent).toBe(
			"Can't save setting because your settings file is invalid",
		);
		fireEvent.click(within(shown).getByRole("button", { name: "Overwrite file" }));

		await waitFor(async () => {
			const read = await container.services.settings.readSettingsFile(file);
			expect(read.ok && read.value.values).toMatchObject({
				archive_on_merge: true,
				setup_script: "pnpm setup",
			});
		});
	});
});
