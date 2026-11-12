import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig } from "../../../core/model.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../../test/container.ts";
import { RepoGitPage } from "./RepoGitPage.tsx";

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
				<RepoGitPage repoId={repo.id} />
			</ServicesProvider>
		</QueryClientProvider>,
	);
	await screen.findByLabelText("Remote origin");
	return { repo, container };
}

describe("SET-07 RepoGitPage", () => {
	// Conductor's repository Git section holds the branch and the remote (renderApp git:default-branch,
	// git:remote-origin), which our Misc page used to hold.
	it("shows the branch new workspaces start from and the remote under Git", async () => {
		const { repo } = await renderPage();

		expect(screen.getByRole("heading", { name: "Git" })).toBeTruthy();
		expect(screen.getByText("Each workspace is an isolated copy of your codebase.")).toBeTruthy();
		expect(screen.getByText("Where should we push, pull, and create PRs?")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Branch new workspaces from" }).textContent,
		).toContain(repo.defaultBranch);
	});

	it("saves a changed remote name and ignores the shown default", async () => {
		const { container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		const remote = screen.getByLabelText("Remote origin") as HTMLInputElement;
		expect(remote.value).toBe("");
		expect(remote.placeholder).toBe("origin");
		fireEvent.blur(remote);
		expect(updateConfig).not.toHaveBeenCalled();

		fireEvent.change(remote, { target: { value: "upstream" } });
		fireEvent.blur(remote);

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]).toMatchObject({ remoteName: "upstream" });
	});

	it("changes the branch new workspaces start from", async () => {
		const { repo, container } = await renderPage();

		const trigger = screen.getByRole("button", { name: "Branch new workspaces from" });
		expect(trigger.textContent).toContain(repo.defaultBranch);
		fireEvent.click(trigger);

		const option = await screen.findByRole("option", { name: /develop/ });
		fireEvent.click(option);

		await waitFor(async () => {
			const rows = await test?.database.select<{ default_branch: string }>(
				"SELECT default_branch FROM repos WHERE id = $1",
				[repo.id],
			);
			expect(rows?.[0]?.default_branch).toBe("develop");
		});
		expect(
			(container.services.repo.store.getState().reposById[repo.id]?.defaultBranch ?? null) as
				| string
				| null,
		).toBe("develop");
	});

	it("turns on Delete branch on archive for this repository only, and resets it to the shared value", async () => {
		const { repo, container } = await renderPage();
		const { settings } = container.services;
		await settings.start();
		const toggle = await screen.findByRole("switch", { name: "Delete branch on archive" });
		await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(screen.queryByRole("button", { name: "Setting actions" })).toBeNull();

		fireEvent.click(toggle);

		await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
		const own = await settings.getForRepo("delete_branch_on_archive", repo.rootPath, null);
		expect(own.ok && own.value).toMatchObject({ value: true, source: "repo-local" });
		expect(settings.get("delete_branch_on_archive")).toBe(false);

		fireEvent.keyDown(await screen.findByRole("button", { name: "Setting actions" }), {
			key: "Enter",
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "Reset" }));

		await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
		const back = await settings.getForRepo("delete_branch_on_archive", repo.rootPath, null);
		expect(back.ok && back.value.source).not.toBe("repo-local");
	});

	// Conductor's row shows the value the setting falls back to while the repository's value loads:
	// on for this switch (`effective.value !== "false"`), off for the other two (renderApp @11165946).
	// Ours showed off, so a read while the page opened saw the switch turn off again (issue #615).
	it("shows Set upstream on plain git push on, as its default, while this repository's value loads", async () => {
		const { repo, container } = await renderPage();
		const { settings } = container.services;
		await settings.start();
		expect(await settings.set("worktree_push_auto_setup_remote", false)).toEqual(ok(undefined));
		expect(
			await settings.setForRepo(repo.rootPath, "worktree_push_auto_setup_remote", true),
		).toEqual(ok(undefined));
		cleanup();
		render(
			<QueryClientProvider client={new QueryClient()}>
				<ServicesProvider container={container}>
					<RepoGitPage repoId={repo.id} />
				</ServicesProvider>
			</QueryClientProvider>,
		);

		// No read has answered yet: this runs before any promise settles.
		const loading = screen.getByRole("switch", { name: "Set upstream on plain git push" });
		expect((loading as HTMLButtonElement).disabled).toBe(true);
		expect(loading.getAttribute("aria-checked")).toBe("true");
		const other = screen.getByRole("switch", { name: "Delete branch on archive" });
		expect(other.getAttribute("aria-checked")).toBe("false");

		await waitFor(() => expect((loading as HTMLButtonElement).disabled).toBe(false));
		expect(loading.getAttribute("aria-checked")).toBe("true");
	});
});
