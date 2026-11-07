import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig } from "../../../core/model.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../../test/container.ts";
import { RepoMiscPage } from "./RepoMiscPage.tsx";

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

const previewInputs = () =>
	screen.getAllByRole("textbox", { name: /^Preview URL \d+$/ }) as HTMLInputElement[];

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

	it("shows one empty row when no preview URL is saved", async () => {
		await renderPage();

		expect(previewInputs()).toHaveLength(1);
		expect(previewInputs()[0]?.value).toBe("");
		expect(
			(screen.getByRole("button", { name: "Remove preview URL" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("adds, removes and moves preview URLs in order", async () => {
		const { repo, container } = await renderPage(0, {
			previewUrls: ["http://localhost:$CONDUCTED_PORT", "https://example.test/preview"],
		});
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		expect(previewInputs().map((input) => input.value)).toEqual([
			"http://localhost:$CONDUCTED_PORT",
			"https://example.test/preview",
		]);

		fireEvent.click(screen.getAllByRole("button", { name: "Move preview URL down" })[0] as Element);

		await waitFor(() =>
			expect(updateConfig).toHaveBeenLastCalledWith(
				repo.id,
				expect.objectContaining({
					previewUrls: ["https://example.test/preview", "http://localhost:$CONDUCTED_PORT"],
				}),
			),
		);
		expect(previewInputs().map((input) => input.value)).toEqual([
			"https://example.test/preview",
			"http://localhost:$CONDUCTED_PORT",
		]);

		fireEvent.click(screen.getByRole("button", { name: "Add preview URL" }));

		expect(previewInputs()).toHaveLength(3);

		fireEvent.click(screen.getAllByRole("button", { name: "Remove preview URL" })[1] as Element);

		await waitFor(() =>
			expect(updateConfig).toHaveBeenLastCalledWith(
				repo.id,
				expect.objectContaining({ previewUrls: ["https://example.test/preview"] }),
			),
		);
		expect(previewInputs()).toHaveLength(2);
		expect(previewInputs()[1]?.value).toBe("");
	});

	it("refuses a preview URL that is not a URL", async () => {
		const { container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		const preview = previewInputs()[0] as HTMLInputElement;
		fireEvent.change(preview, { target: { value: "not a url" } });
		fireEvent.blur(preview);

		expect(
			await screen.findByText("Enter a URL such as http://localhost:$CONDUCTED_PORT."),
		).toBeTruthy();
		expect(updateConfig).not.toHaveBeenCalled();
	});

	it("saves a preview URL with the workspace port variable", async () => {
		const { repo, container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		const preview = previewInputs()[0] as HTMLInputElement;
		fireEvent.change(preview, {
			target: { value: "http://localhost:$CONDUCTED_PORT" },
		});
		fireEvent.blur(preview);

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({
			previewUrls: ["http://localhost:$CONDUCTED_PORT"],
		});
		expect(updateConfig.mock.calls[0]?.[0]).toBe(repo.id);
	});

	it("saves every template in the order shown", async () => {
		const { repo, container } = await renderPage(0, {
			previewUrls: ["http://localhost:$CONDUCTED_PORT"],
		});
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		fireEvent.click(screen.getByRole("button", { name: "Add preview URL" }));
		const inputs = previewInputs();
		fireEvent.change(inputs[1] as HTMLInputElement, {
			target: { value: "https://example.test/preview" },
		});
		fireEvent.blur(inputs[1] as HTMLInputElement);

		await waitFor(() =>
			expect(updateConfig).toHaveBeenLastCalledWith(
				repo.id,
				expect.objectContaining({
					previewUrls: ["http://localhost:$CONDUCTED_PORT", "https://example.test/preview"],
				}),
			),
		);
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
});
