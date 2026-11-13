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
import { RepoGitPage } from "./RepoGitPage.tsx";

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
		expect(updateConfig.mock.calls[0]?.[1]).toEqual({ remoteName: "upstream" });
	});

	// The project's config is read again when anything on the page saves (a switch here does), and
	// each read is a new object with the same values. The field must keep what the user is typing
	// until it is saved; it takes the stored value only when that value changes (issue #658).
	it("keeps a remote name being typed when the config is read again with the same values", async () => {
		const { repo, container } = await renderPage();
		const remote = screen.getByLabelText("Remote origin") as HTMLInputElement;
		await waitFor(() => expect(remote.disabled).toBe(false));

		fireEvent.change(remote, { target: { value: "upstream" } });
		act(() => {
			container.services.repo.store.setState((state) => ({
				...state,
				configs: { ...state.configs, [repo.id]: { ...(state.configs[repo.id] as RepoConfig) } },
			}));
		});

		expect(remote.value).toBe("upstream");
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

	it("toasts Failed to save setting when this repository's value cannot be saved (issue #614)", async () => {
		const { repo, container } = await renderPage();
		render(<Toaster />);
		await container.services.settings.start();
		// A file stands where the repository's .conducted folder must go.
		test?.memory.controls.addFile(`${repo.rootPath}/.conducted`, "");
		const toggle = await screen.findByRole("switch", { name: "Delete branch on archive" });
		await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));

		fireEvent.click(toggle);

		await waitFor(() =>
			expect(document.querySelector("[data-sonner-toast]")?.textContent).toBe(
				"Failed to save setting",
			),
		);
		expect(toggle.getAttribute("aria-checked")).toBe("false");
	});

	// Conductor's invalid-file toast offers "Overwrite file" once a save has read the file whole
	// (mutateSettingsFile, main @416065); pressing it saves the switch over that reading (issue #622).
	it("offers Overwrite file when this repository's local file does not parse, and saves the switch", async () => {
		const { repo, container } = await renderPage();
		render(<Toaster />);
		const { settings } = container.services;
		await settings.start();
		expect(await settings.setForRepo(repo.rootPath, "archive_on_merge", true)).toEqual(
			ok(undefined),
		);
		const local = `${repo.rootPath}/.conducted/settings.local.toml`;
		test?.memory.controls.files.set(local, "[git\n");
		const toggle = await screen.findByRole("switch", { name: "Delete branch on archive" });
		await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));

		fireEvent.click(toggle);
		fireEvent.click(await screen.findByRole("button", { name: "Overwrite file" }));

		await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
		const read = await settings.readSettingsFile(local);
		expect(read.ok && read.value.values).toMatchObject({
			archive_on_merge: true,
			delete_branch_on_archive: true,
		});
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

	// Ours keeps the remote name in the local settings file, so its save goes through the settings
	// writer, whose failed-save toast offers "Overwrite file" for an invalid file (Uz, main @389730;
	// mutateSettingsFile, @415335). Ours said "Couldn't save the repository settings" (issue #654).
	it("offers Overwrite file when the remote name meets an invalid local settings file", async () => {
		const { repo, container } = await renderPage();
		render(<Toaster />);
		if (test === undefined) throw new Error("no container");
		const file = await seedInvalidLocalSettings(test, repo);
		const remote = screen.getByLabelText("Remote origin");

		fireEvent.change(remote, { target: { value: "upstream" } });
		fireEvent.blur(remote);
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
				remote_name: "upstream",
			});
		});
	});
});
