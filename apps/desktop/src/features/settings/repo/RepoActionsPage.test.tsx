import { appError, err, ok, type Result } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localSettingsFile, sharedSettingsFile } from "../../../core/app-paths.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { Repo } from "../../../core/model.ts";
import { hiddenRunActionsStorageKey } from "../../../core/services/repo.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { Toaster, toast } from "../../../ui/Toast.tsx";
import { RepoActionsPage } from "./RepoActionsPage.tsx";

let test: TestContainer | undefined;

beforeEach(() => localStorage.clear());

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	test?.close();
	test = undefined;
	localStorage.clear();
});

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

async function renderPage() {
	const testContainer = createTestContainer();
	test = testContainer;
	const container = testContainer.container;
	const repo = await seedRepo(container);
	render(
		<ServicesProvider container={container}>
			<RepoActionsPage repoId={repo.id} />
		</ServicesProvider>,
	);
	return { repo, container };
}

async function writeSettings(container: TestContainer["container"], repo: Repo, toml: string) {
	must(await container.platform.fs.writeTextAtomic(sharedSettingsFile(repo.rootPath), toml));
	await container.services.repo.loadConfig(repo.id);
}

describe("SET-07 RepoActionsPage", () => {
	it("hides a shared action for this user only and leaves the shared file unchanged", async () => {
		const { repo, container } = await renderPage();
		const toml = '[scripts.run.dev]\ncommand = "pnpm dev"\ndefault = true\n';
		await writeSettings(container, repo, toml);
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		const row = await screen.findByRole("listitem", { name: "Dev" });
		fireEvent.click(within(row).getByRole("button", { name: "Hide" }));

		await waitFor(() =>
			expect(localStorage.getItem(hiddenRunActionsStorageKey(repo.id))).toBe('["dev"]'),
		);
		expect(updateConfig).not.toHaveBeenCalled();
		expect(must(await container.platform.fs.readText(sharedSettingsFile(repo.rootPath)))).toBe(
			toml,
		);
		expect(await screen.findByRole("button", { name: "Show" })).toBeTruthy();
	});

	it("shows the designed empty state when there are no actions", async () => {
		await renderPage();

		expect(await screen.findByText("No custom actions yet. Add one to get started.")).toBeTruthy();
	});

	it("saves a personal action's hidden flag to the settings file", async () => {
		const { repo, container } = await renderPage();
		must(
			await container.platform.fs.writeTextAtomic(
				localSettingsFile(repo.rootPath),
				'[scripts.run.docs]\ncommand = "pnpm docs"\n',
			),
		);
		await container.services.repo.loadConfig(repo.id);
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		const row = await screen.findByRole("listitem", { name: "Docs" });
		fireEvent.click(within(row).getByRole("button", { name: "Hide" }));

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]?.runScripts).toMatchObject([
			{ id: "docs", hidden: true },
		]);
		expect(localStorage.getItem(hiddenRunActionsStorageKey(repo.id))).toBeNull();
	});

	it("writes a change to a shared action to the personal layer and leaves the shared file alone", async () => {
		const { repo, container } = await renderPage();
		const toml = '[scripts.run.dev]\ncommand = "pnpm dev"\n';
		await writeSettings(container, repo, toml);
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		const row = await screen.findByRole("listitem", { name: "Dev" });
		fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
		fireEvent.change(screen.getByLabelText("Command"), {
			target: { value: "pnpm dev --host" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]?.runScripts).toMatchObject([
			{ id: "dev", command: "pnpm dev --host", origin: "changed_locally" },
		]);
		expect(must(await container.platform.fs.readText(sharedSettingsFile(repo.rootPath)))).toBe(
			toml,
		);
	});

	it("adds an action from the dialog", async () => {
		const { container } = await renderPage();
		const updateConfig = vi
			.spyOn(container.actions.projects, "updateConfig")
			.mockResolvedValue(ok(undefined));

		fireEvent.click(await screen.findByRole("button", { name: "Add action" }));
		fireEvent.change(screen.getByLabelText("Action name"), { target: { value: "Tests" } });
		fireEvent.change(screen.getByLabelText("Command"), { target: { value: "pnpm test" } });
		fireEvent.click(screen.getByRole("button", { name: "Save action" }));

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(updateConfig.mock.calls[0]?.[1]?.runScripts).toMatchObject([
			{ id: "Tests", command: "pnpm test", isDefault: false, origin: "local" },
		]);
	});

	it("resets a shared action that this Mac changed", async () => {
		const { repo, container } = await renderPage();
		await writeSettings(container, repo, '[scripts.run.dev]\ncommand = "pnpm dev"\n');
		must(
			await container.platform.fs.writeTextAtomic(
				localSettingsFile(repo.rootPath),
				'[scripts.run.dev]\ncommand = "pnpm dev:local"\n',
			),
		);
		await container.services.repo.loadConfig(repo.id);
		const reset = vi
			.spyOn(container.actions.projects, "resetRunAction")
			.mockResolvedValue(ok(undefined));

		fireEvent.click(await screen.findByRole("button", { name: "Reset" }));

		await waitFor(() => expect(reset).toHaveBeenCalledWith(repo.id, "dev"));
	});

	it("names a failed Spotlight switch 'Failed to update spotlight testing'", async () => {
		const testContainer = createTestContainer();
		test = testContainer;
		const container = testContainer.container;
		const repo = await seedRepo(container);
		vi.spyOn(container.actions.projects, "updateConfig").mockResolvedValue(
			err(appError("settings_write_failed", "The settings file is read-only.")),
		);
		render(
			<ServicesProvider container={container}>
				<RepoActionsPage repoId={repo.id} />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.click(await screen.findByRole("switch", { name: "Use spotlight testing" }));

		expect(await screen.findByText("Failed to update spotlight testing")).toBeTruthy();
		expect(screen.queryByText("Couldn't save the actions")).toBeNull();
	});
});
