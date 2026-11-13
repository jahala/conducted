import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig } from "../../../core/model.ts";
import {
	createTestContainer,
	seedInvalidLocalSettings,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../../test/container.ts";
import { Toaster, toast } from "../../../ui/Toast.tsx";
import { RepoMiscPage } from "./RepoMiscPage.tsx";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
}));

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.useRealTimers();
	vi.restoreAllMocks();
	navigate.mockReset();
	test?.close();
	test = undefined;
});

const config = (changes: Partial<RepoConfig> = {}): RepoConfig => ({
	setupScript: null,
	runScripts: [],
	runMode: "concurrent",
	archiveScript: null,
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

async function renderPage(
	workspaceCount = 0,
	changes: Partial<RepoConfig> = {},
	icon: string | null = null,
) {
	const testContainer = createTestContainer();
	test = testContainer;
	const container = testContainer.container;
	testContainer.memory.controls.scriptShell((command) => {
		if (
			command.program === "git" &&
			command.args.includes("branch") &&
			command.args.some((arg) => arg.startsWith("--format=%(refname:short)"))
		) {
			return ok({ stdout: "main\ndevelop\n", stderr: "", exitCode: 0 });
		}
		return null;
	});
	const repo = await seedRepo(container, { icon });
	for (let index = 0; index < workspaceCount; index += 1) {
		await seedWorkspace(container, { repoId: repo.id });
	}
	container.services.repo.store.setState((state) => ({
		...state,
		configs: { ...state.configs, [repo.id]: config(changes) },
	}));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>
				<RepoMiscPage repoId={repo.id} />
			</ServicesProvider>
		</QueryClientProvider>,
	);
	await screen.findByText("Root path");
	return { repo, container };
}

const nameInputs = () =>
	screen.getAllByRole("textbox", { name: /^Name \d+$/ }) as HTMLInputElement[];
const urlInputs = () =>
	screen.getAllByRole("textbox", { name: /^Preview URL \d+$/ }) as HTMLInputElement[];

/** Runs the 500 ms save debounce. */
async function advanceSave(): Promise<void> {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(500);
	});
}

describe("SET-07 RepoMiscPage", () => {
	it("asks for confirmation naming the workspace count before removing the repository", async () => {
		const { repo, container } = await renderPage(2);
		const remove = vi.spyOn(container.actions.projects, "remove").mockResolvedValue(ok(undefined));

		fireEvent.click(screen.getByRole("button", { name: "Remove repository" }));

		expect(await screen.findByText(/2 workspaces/)).toBeTruthy();
		const dialog = screen.getByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Remove repository" }));

		await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
		expect(remove).toHaveBeenCalledWith(repo.id);
	});

	it("toasts the removal and opens the user Git settings, as Conductor does", async () => {
		const { repo, container } = await renderPage(1);
		vi.spyOn(container.actions.projects, "remove").mockResolvedValue(ok(undefined));
		const success = vi.spyOn(toast, "success");

		fireEvent.click(screen.getByRole("button", { name: "Remove repository" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Remove repository" }));

		await waitFor(() => expect(success).toHaveBeenCalledWith("Repository removed successfully"));
		expect(navigate).toHaveBeenCalledWith({
			to: "/settings/user/$page",
			params: { page: "git" },
			replace: true,
		});
		expect(container.actions.projects.remove).toHaveBeenCalledWith(repo.id);
	});

	it("shows the root and workspaces paths read-only with the warning", async () => {
		const { repo } = await renderPage();

		expect(screen.getByText(repo.rootPath)).toBeTruthy();
		expect(
			screen.getByText(
				"Do not move or delete this directory. Instead, remove the repository in Conducted.",
			),
		).toBeTruthy();
		expect(screen.getByText(new RegExp(`workspaces/${repo.name}$`))).toBeTruthy();
		expect(
			screen.getByText(
				"Do not move or delete the workspace subdirectories. Instead, archive workspaces in Conducted.",
			),
		).toBeTruthy();
		// The branch new workspaces start from is on the repository's Git page, as in Conductor.
		expect(screen.queryByRole("button", { name: "Branch new workspaces from" })).toBeNull();
	});

	it("shows one empty row with a name and a URL when nothing is saved", async () => {
		await renderPage();

		expect(nameInputs()).toHaveLength(1);
		expect(urlInputs()).toHaveLength(1);
		expect(nameInputs()[0]?.value).toBe("");
		expect(urlInputs()[0]?.value).toBe("");
		expect(
			(screen.getByRole("button", { name: "Remove preview URL" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("adds, removes and moves preview URLs in order", async () => {
		const { repo, container } = await renderPage(0, {
			previewUrls: [
				{ name: "Local", url: "http://localhost:$CONDUCTED_PORT" },
				{ name: "Preview", url: "https://example.test/preview" },
			],
		});
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		expect(nameInputs().map((input) => input.value)).toEqual(["Local", "Preview"]);
		expect(urlInputs().map((input) => input.value)).toEqual([
			"http://localhost:$CONDUCTED_PORT",
			"https://example.test/preview",
		]);

		vi.useFakeTimers();
		fireEvent.click(screen.getAllByRole("button", { name: "Move preview URL down" })[0] as Element);
		await advanceSave();

		expect(updateConfig).toHaveBeenLastCalledWith(
			repo.id,
			expect.objectContaining({
				previewUrls: [
					{ name: "Preview", url: "https://example.test/preview" },
					{ name: "Local", url: "http://localhost:$CONDUCTED_PORT" },
				],
			}),
		);
		expect(nameInputs().map((input) => input.value)).toEqual(["Preview", "Local"]);

		fireEvent.click(screen.getByRole("button", { name: "Add preview URL" }));
		fireEvent.change(nameInputs()[2] as HTMLInputElement, { target: { value: "Docs" } });
		fireEvent.change(urlInputs()[2] as HTMLInputElement, {
			target: { value: "https://docs.example.test" },
		});
		await advanceSave();

		expect(updateConfig).toHaveBeenLastCalledWith(
			repo.id,
			expect.objectContaining({
				previewUrls: [
					{ name: "Preview", url: "https://example.test/preview" },
					{ name: "Local", url: "http://localhost:$CONDUCTED_PORT" },
					{ name: "Docs", url: "https://docs.example.test" },
				],
			}),
		);

		fireEvent.click(screen.getAllByRole("button", { name: "Remove preview URL" })[1] as Element);
		await advanceSave();

		expect(updateConfig).toHaveBeenLastCalledWith(
			repo.id,
			expect.objectContaining({
				previewUrls: [
					{ name: "Preview", url: "https://example.test/preview" },
					{ name: "Docs", url: "https://docs.example.test" },
				],
			}),
		);
		expect(nameInputs()).toHaveLength(2);
	});

	it("refuses a preview URL that is not a URL", async () => {
		const { container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		vi.useFakeTimers();
		const url = urlInputs()[0] as HTMLInputElement;
		fireEvent.change(url, { target: { value: "not a url" } });
		fireEvent.blur(url);

		expect(screen.getByText("Enter a URL such as http://localhost:$CONDUCTED_PORT.")).toBeTruthy();
		await advanceSave();
		expect(updateConfig).not.toHaveBeenCalled();
	});

	it("saves after the 500 ms debounce without waiting for a blur", async () => {
		const { repo, container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		vi.useFakeTimers();
		fireEvent.change(urlInputs()[0] as HTMLInputElement, {
			target: { value: "http://localhost:$CONDUCTED_PORT" },
		});

		expect(updateConfig).not.toHaveBeenCalled();
		await advanceSave();

		expect(updateConfig).toHaveBeenCalledTimes(1);
		expect(updateConfig.mock.calls[0]?.[0]).toBe(repo.id);
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({
			previewUrls: [{ name: "", url: "http://localhost:$CONDUCTED_PORT" }],
		});
	});

	it("saves each template's name with its URL", async () => {
		const { repo, container } = await renderPage(0, {
			previewUrls: [{ name: "", url: "http://localhost:$CONDUCTED_PORT" }],
		});
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		vi.useFakeTimers();
		fireEvent.change(nameInputs()[0] as HTMLInputElement, { target: { value: "App" } });
		fireEvent.click(screen.getByRole("button", { name: "Add preview URL" }));
		fireEvent.change(nameInputs()[1] as HTMLInputElement, { target: { value: "Docs" } });
		fireEvent.change(urlInputs()[1] as HTMLInputElement, {
			target: { value: "https://example.test/preview" },
		});
		await advanceSave();

		expect(updateConfig).toHaveBeenLastCalledWith(
			repo.id,
			expect.objectContaining({
				previewUrls: [
					{ name: "App", url: "http://localhost:$CONDUCTED_PORT" },
					{ name: "Docs", url: "https://example.test/preview" },
				],
			}),
		);
	});

	it("does not write an unchanged list", async () => {
		const { container } = await renderPage(0, {
			previewUrls: [{ name: "App", url: "http://localhost:$CONDUCTED_PORT" }],
		});
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		vi.useFakeTimers();
		fireEvent.change(nameInputs()[0] as HTMLInputElement, { target: { value: " App " } });
		await advanceSave();

		expect(updateConfig).not.toHaveBeenCalled();
	});

	it("shows the file patterns and saves a removal", async () => {
		const { container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		expect(screen.getByText(".env")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Remove .env" }));

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({ copyFiles: [] });
	});

	it("shows the saved icon and opens the icon picker", async () => {
		await renderPage(0, {}, "emoji:🚀");

		expect(screen.getByText("🚀")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Change repository icon" }));

		expect(await screen.findByRole("dialog", { name: "Change repository icon" })).toBeTruthy();
		expect(screen.getByLabelText("Search emoji")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Remove emoji" })).toBeTruthy();
	});

	// Conductor saves the files to copy through its settings writer, whose failed-save toast offers
	// "Overwrite file" for an invalid file (Uz, main @389730). The field's own "Failed to save files
	// to copy" is only for a save that throws (renderApp @11275161, Oja @10903526). Ours said
	// "Couldn't save the repository settings" (issue #654).
	it("offers Overwrite file when the files to copy meet an invalid local settings file", async () => {
		const testContainer = createTestContainer();
		test = testContainer;
		const container = testContainer.container;
		const repo = await seedRepo(container);
		const file = await seedInvalidLocalSettings(testContainer, repo);
		container.services.repo.store.setState((state) => ({
			...state,
			configs: { ...state.configs, [repo.id]: config({ copyFiles: [".env"] }) },
		}));
		render(
			<QueryClientProvider client={new QueryClient()}>
				<ServicesProvider container={container}>
					<RepoMiscPage repoId={repo.id} />
					<Toaster />
				</ServicesProvider>
			</QueryClientProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Remove .env" }));
		const shown = await waitFor(() => {
			const element = document.querySelector("[data-sonner-toast]");
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		expect(shown.querySelector("[data-title]")?.textContent).toBe(
			"Can't save setting because your settings file is invalid",
		);
		fireEvent.click(within(shown).getByRole("button", { name: "Overwrite file" }));

		// The forced save wrote the file over the reading the earlier save left, so it parses again.
		await waitFor(async () => {
			const read = await container.services.settings.readSettingsFile(file);
			expect(read.ok && read.value.values).toMatchObject({ archive_on_merge: true });
		});
		expect(container.services.repo.store.getState().configs[repo.id]?.copyFiles).toEqual([]);
	});
});
