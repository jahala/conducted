import { ok } from "@conducted/shared";
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
import "../../../test/dom-polyfills.ts";
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
	previewUrlTemplate: null,
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

async function renderPage(workspaceCount = 0, changes: Partial<RepoConfig> = {}) {
	const testContainer = createTestContainer();
	test = testContainer;
	const container = testContainer.container;
	const repo = await seedRepo(container);
	for (let index = 0; index < workspaceCount; index += 1) {
		await seedWorkspace(container, { repoId: repo.id });
	}
	container.services.repo.store.setState((state) => ({
		...state,
		configs: { ...state.configs, [repo.id]: config(changes) },
	}));
	render(
		<ServicesProvider container={container}>
			<RepoMiscPage repoId={repo.id} />
		</ServicesProvider>,
	);
	await screen.findByText("Root path");
	return { repo, container };
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

	it("shows the root and workspaces paths read-only with the warning", async () => {
		const { repo } = await renderPage();

		expect(screen.getByText(repo.rootPath)).toBeTruthy();
		expect(
			screen.getByText("Do not move or delete this folder. Remove the repository here instead."),
		).toBeTruthy();
		expect(screen.getByText(new RegExp(`workspaces/${repo.name}$`))).toBeTruthy();
		expect(
			screen.getByText(
				"Do not move or delete the workspace folders. Archive workspaces here instead.",
			),
		).toBeTruthy();
		expect((screen.getByLabelText("Branch new workspaces from") as HTMLInputElement).readOnly).toBe(
			true,
		);
	});

	it("saves a changed remote name and ignores the shown default", async () => {
		const { container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		const remote = screen.getByLabelText("Remote origin");
		fireEvent.blur(remote);
		expect(updateConfig).not.toHaveBeenCalled();

		fireEvent.change(remote, { target: { value: "upstream" } });
		fireEvent.blur(remote);

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({ remoteName: "upstream" });
	});

	it("refuses a preview URL that is not a URL", async () => {
		const { container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		const preview = screen.getByLabelText("Preview URLs");
		fireEvent.change(preview, { target: { value: "not a url" } });
		fireEvent.blur(preview);

		expect(
			await screen.findByText("Enter a URL such as http://localhost:$CONDUCTED_PORT."),
		).toBeTruthy();
		expect(updateConfig).not.toHaveBeenCalled();
	});

	it("saves a preview URL with the workspace port variable", async () => {
		const { container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		const preview = screen.getByLabelText("Preview URLs");
		fireEvent.change(preview, {
			target: { value: "http://localhost:$CONDUCTED_PORT" },
		});
		fireEvent.blur(preview);

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({
			previewUrlTemplate: "http://localhost:$CONDUCTED_PORT",
		});
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

	it("sends an emoji icon to the icon service", async () => {
		const { repo, container } = await renderPage();
		const setIcon = vi
			.spyOn(container.actions.projects, "setIcon")
			.mockResolvedValue(ok(undefined));

		fireEvent.change(screen.getByLabelText("Icon"), { target: { value: "🚀" } });
		fireEvent.click(screen.getByRole("button", { name: "Save icon" }));

		await waitFor(() =>
			expect(setIcon).toHaveBeenCalledWith(repo.id, { kind: "emoji", emoji: "🚀" }),
		);
	});
});
