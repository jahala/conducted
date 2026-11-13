import { appError, err, ok, type Result } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localSettingsFile, sharedSettingsFile } from "../../../core/app-paths.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { Repo } from "../../../core/model.ts";
import { hiddenRunActionsStorageKey } from "../../../core/services/repo.ts";
import { tomlCodec } from "../../../core/services/toml-codec.ts";
import {
	createTestContainer,
	seedInvalidLocalSettings,
	seedRepo,
	type TestContainer,
} from "../../../test/container.ts";
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
	testContainer.memory.controls.addFolder(`${repo.rootPath}/.conducted`);
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
		fireEvent.click(within(row).getByRole("button", { name: "Hide action" }));

		await waitFor(() =>
			expect(localStorage.getItem(hiddenRunActionsStorageKey(repo.id))).toBe('["dev"]'),
		);
		expect(updateConfig).not.toHaveBeenCalled();
		expect(must(await container.platform.fs.readText(sharedSettingsFile(repo.rootPath)))).toBe(
			toml,
		);
		expect(await screen.findByRole("button", { name: "Show action" })).toBeTruthy();
	});

	it("shows the designed empty state when there are no actions", async () => {
		await renderPage();

		expect(await screen.findByText("No custom actions yet. Add one to get started.")).toBeTruthy();
	});

	// Conductor's Actions page: its own description, then Custom actions, Use spotlight testing and
	// the instruction rows (renderApp Enl, _Wa).
	it("holds the instruction rows after Use spotlight testing, under Conductor's description", async () => {
		await renderPage();

		expect(
			await screen.findByText(
				"Configure action-specific behavior and instructions for this repository.",
			),
		).toBeTruthy();
		expect(
			screen.getByText("Shortcuts for quick actions, like running your dev server or test suite"),
		).toBeTruthy();
		const spotlight = await screen.findByRole("switch", { name: "Use spotlight testing" });
		const review = await screen.findByText("Code review preferences");
		expect(
			spotlight.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
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
		fireEvent.click(within(row).getByRole("button", { name: "Hide action" }));

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

		fireEvent.click(await screen.findByRole("button", { name: "Add" }));
		fireEvent.change(screen.getByLabelText("Action name"), { target: { value: "Tests" } });
		fireEvent.change(screen.getByLabelText("Command"), { target: { value: "pnpm test" } });
		fireEvent.click(screen.getByRole("button", { name: "Save action" }));

		await waitFor(() => expect(updateConfig).toHaveBeenCalledTimes(1));
		expect(Object.keys(updateConfig.mock.calls[0]?.[1] ?? {})).toEqual(["runScripts"]);
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

	// Conductor writes the switch through its settings writer, which toasts the failure itself
	// (Uz, main @389730: "Failed to save setting" for a failed write). The page's own "Failed to
	// update spotlight testing" is only for a call that throws (renderApp @11265790), and ours
	// never throws. Ours named every failure that way (issue #654).
	it("toasts a failed Spotlight switch with the settings writer's words", async () => {
		const testContainer = createTestContainer();
		test = testContainer;
		const container = testContainer.container;
		const repo = await seedRepo(container);
		vi.spyOn(container.actions.projects, "updateConfig").mockResolvedValue(
			err(appError("setting_save_failed", "Failed to save setting")),
		);
		render(
			<ServicesProvider container={container}>
				<RepoActionsPage repoId={repo.id} />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.click(await screen.findByRole("switch", { name: "Use spotlight testing" }));

		const shown = await waitFor(() => {
			const element = document.querySelector("[data-sonner-toast]");
			expect(element).not.toBeNull();
			return element as HTMLElement;
		});
		expect(shown.querySelector("[data-title]")?.textContent).toBe("Failed to save setting");
		expect(screen.queryByText("Failed to update spotlight testing")).toBeNull();
	});

	// The switch and an action's Reset both write the local settings file, so an invalid file gets
	// Conductor's toast with "Overwrite file" (mutateSettingsFile, main @415335; updateTask
	// @405338 for an action), and pressing it does the same write forced (issue #654).
	it("offers Overwrite file for the Spotlight switch over an invalid local settings file", async () => {
		const testContainer = createTestContainer();
		test = testContainer;
		const container = testContainer.container;
		const repo = await seedRepo(container);
		const file = await seedInvalidLocalSettings(testContainer, repo);
		render(
			<ServicesProvider container={container}>
				<RepoActionsPage repoId={repo.id} />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.click(await screen.findByRole("switch", { name: "Use spotlight testing" }));
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
				spotlight_testing: true,
			});
		});
	});

	it("offers Overwrite file when an action's Reset meets an invalid local settings file", async () => {
		const testContainer = createTestContainer();
		test = testContainer;
		const container = testContainer.container;
		const repo = await seedRepo(container);
		testContainer.memory.controls.addFolder(`${repo.rootPath}/.conducted`);
		must(
			await container.platform.fs.writeTextAtomic(
				sharedSettingsFile(repo.rootPath),
				'[scripts.run.dev]\ncommand = "pnpm dev"\n',
			),
		);
		must(
			await container.platform.fs.writeTextAtomic(
				localSettingsFile(repo.rootPath),
				'[scripts.run.dev]\ncommand = "pnpm dev:local"\n',
			),
		);
		const file = await seedInvalidLocalSettings(testContainer, repo);
		render(
			<ServicesProvider container={container}>
				<RepoActionsPage repoId={repo.id} />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
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
			expect(read.ok && read.value.values).toMatchObject({ archive_on_merge: true });
			expect(read.ok && Object.keys(read.value.actions)).toEqual([]);
		});
	});
});

// Conductor saves one action at a time by its id (updateTask, main @405635, writing with M8e,
// @356875), and an action's name is its id: a rename writes the action under the new id in the
// old one's place (`replaceId`, renderApp @11014363). Issue #673.
describe("SET-07 run actions are saved one at a time (issue #673)", () => {
	async function renderWithLocalActions(toml: string) {
		const testContainer = createTestContainer();
		test = testContainer;
		const container = testContainer.container;
		const repo = await seedRepo(container);
		testContainer.memory.controls.addFolder(`${repo.rootPath}/.conducted`);
		must(await container.platform.fs.writeTextAtomic(localSettingsFile(repo.rootPath), toml));
		render(
			<ServicesProvider container={container}>
				<RepoActionsPage repoId={repo.id} />
				<Toaster />
			</ServicesProvider>,
		);
		return { testContainer, repo, container, file: localSettingsFile(repo.rootPath) };
	}

	const parsedFile = (file: string) => {
		const parsed = tomlCodec.parse(test?.memory.controls.files.get(file) ?? "");
		return parsed.ok ? parsed.value : null;
	};
	const actionKeys = (file: string): string[] => {
		const document = parsedFile(file) as { scripts?: { run?: Record<string, unknown> } } | null;
		return Object.keys(document?.scripts?.run ?? {});
	};

	it("keeps both of two quick edits of different actions", async () => {
		const { repo, container, file } = await renderWithLocalActions(
			'[scripts.run.docs]\ncommand = "pnpm docs"\n\n[scripts.run.lint]\ncommand = "pnpm lint"\n',
		);
		const docs = await screen.findByRole("listitem", { name: "Docs" });
		const lint = screen.getByRole("listitem", { name: "Lint" });

		// The second save is issued before the first has landed and been read again.
		fireEvent.click(within(docs).getByRole("button", { name: "Hide action" }));
		fireEvent.click(within(lint).getByRole("button", { name: "Hide action" }));

		await waitFor(() =>
			expect(parsedFile(file)).toMatchObject({
				scripts: { run: { docs: { hide: true }, lint: { hide: true } } },
			}),
		);
		const saved = container.services.repo.store.getState().configs[repo.id];
		expect(saved?.runScripts.map((action) => [action.id, action.hidden])).toEqual([
			["docs", true],
			["lint", true],
		]);
	});

	it("saves a renamed action under its new name, in its place, and a reload keeps it", async () => {
		const { repo, container, file } = await renderWithLocalActions(
			'[scripts.run.docs]\ncommand = "pnpm docs"\n\n[scripts.run.lint]\ncommand = "pnpm lint"\n',
		);
		const docs = await screen.findByRole("listitem", { name: "Docs" });
		fireEvent.click(within(docs).getByRole("button", { name: "Edit" }));
		fireEvent.change(screen.getByLabelText("Action name"), { target: { value: "Docs site" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(actionKeys(file)).toEqual(["Docs-site", "lint"]),
		);
		must(await container.services.repo.loadConfig(repo.id));
		expect(await screen.findByRole("listitem", { name: "Docs site" })).toBeTruthy();
		expect(screen.queryByRole("listitem", { name: "Docs" })).toBeNull();
		const reloaded = container.services.repo.store.getState().configs[repo.id];
		expect(reloaded?.runScripts.map((action) => [action.id, action.label, action.command])).toEqual(
			[
				["Docs-site", "Docs site", "pnpm docs"],
				["lint", "Lint", "pnpm lint"],
			],
		);
	});

	// An action's save goes through the settings writer, so an invalid file gets Conductor's toast
	// with "Overwrite file" (updateTask's onForce, main @405635), as Reset does (issue #667).
	it("offers Overwrite file when an action's save meets an invalid local settings file", async () => {
		const { testContainer, repo, container, file } = await renderWithLocalActions(
			'[scripts.run.docs]\ncommand = "pnpm docs"\n',
		);
		const docs = await screen.findByRole("listitem", { name: "Docs" });
		await seedInvalidLocalSettings(testContainer, repo);
		fireEvent.click(within(docs).getByRole("button", { name: "Delete action" }));

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
			expect(read.ok && read.value.values).toMatchObject({ archive_on_merge: true });
			expect(read.ok && Object.keys(read.value.actions)).toEqual([]);
		});
	});
});
