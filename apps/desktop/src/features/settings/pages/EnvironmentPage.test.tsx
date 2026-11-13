import type { RepoId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import {
	createTestContainer,
	seedInvalidLocalSettings,
	seedRepo,
	type TestContainer,
} from "../../../test/container.ts";
import { Toaster, toast } from "../../../ui/Toast.tsx";
import { EnvironmentPage } from "./EnvironmentPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	test?.close();
	test = undefined;
});

/** The page for every repository, or a repository's Environment section when `forRepo` is set. */
async function mountPage(forRepo = false) {
	test = createTestContainer();
	await test.container.services.settings.start();
	const repo = await seedRepo(test.container);
	render(
		<ServicesProvider container={test.container}>
			<EnvironmentPage repoId={forRepo ? repo.id : null} />
		</ServicesProvider>,
	);
	await screen.findByRole("button", { name: "Add environment variable" });
	return { container: test.container, repo };
}

/** Adds one variable through the panel the title's button opens. */
async function addThroughPanel(name: string, value: string) {
	fireEvent.click(screen.getByRole("button", { name: "Add environment variable" }));
	const panel = await screen.findByRole("dialog", { name: "Add environment variable" });
	fireEvent.change(within(panel).getByLabelText("Name"), { target: { value: name } });
	fireEvent.change(within(panel).getByLabelText("Value"), { target: { value } });
	fireEvent.click(within(panel).getByRole("button", { name: /^Save/ }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

describe("SET-04 EnvironmentPage", () => {
	// Conductor puts "Add environment variable" at the title's right and adds from a side panel.
	it("adds a variable from the panel by the title and shows the row with a hidden value", async () => {
		const { container } = await mountPage();
		const original = container.services.settings.setEnvVar.bind(container.services.settings);
		const setEnvVar = vi
			.spyOn(container.services.settings, "setEnvVar")
			.mockImplementation((name, value, scope) => original(name, value, scope));
		const heading = screen.getByRole("heading", { name: "Environment" });
		expect(heading.closest("header")?.textContent).toContain("Add environment variable");

		await addThroughPanel("TOKEN", "abc");

		await waitFor(() => expect(setEnvVar).toHaveBeenCalledWith("TOKEN", "abc", "global"));
		expect(await screen.findByText("TOKEN")).toBeTruthy();
		expect(screen.getByText("••••••••")).toBeTruthy();
		expect(await test?.memory.platform.keychain.get("env:global:TOKEN")).toEqual({
			ok: true,
			value: "abc",
		});
	});

	it("saves a repository's variable in that repository's scope", async () => {
		const { container, repo } = await mountPage(true);
		const original = container.services.settings.setEnvVar.bind(container.services.settings);
		const setEnvVar = vi
			.spyOn(container.services.settings, "setEnvVar")
			.mockImplementation((name, value, scope) => original(name, value, scope));
		// The scope is the page's own: there is no scope switch, as in Conductor.
		expect(screen.queryByRole("combobox", { name: "Scope" })).toBeNull();

		await addThroughPanel("LOCAL", "yes");

		await waitFor(() =>
			expect(setEnvVar).toHaveBeenCalledWith("LOCAL", "yes", { repoId: repo.id }),
		);
	});

	it("imports the local dotenv file and remembers that the banner was dismissed", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		await test.container.platform.fs.writeTextAtomic(
			`${test.container.platform.fs.paths.home}/.env`,
			"FIRST=one\nSECOND=two\n",
		);
		render(
			<ServicesProvider container={test.container}>
				<EnvironmentPage />
			</ServicesProvider>,
		);

		const importButton = await screen.findByRole("button", { name: "Import" });
		fireEvent.click(importButton);

		await waitFor(async () =>
			expect(await test?.memory.platform.keychain.get("env:global:FIRST")).toEqual({
				ok: true,
				value: "one",
			}),
		);
		expect(await test.memory.platform.keychain.get("env:global:SECOND")).toEqual({
			ok: true,
			value: "two",
		});
		await waitFor(() =>
			expect(test?.container.services.settings.get("local_env_vars_import_banner_dismissed")).toBe(
				true,
			),
		);
		await waitFor(() => expect(screen.queryByRole("button", { name: "Import" })).toBeNull());
	});
	// Conductor's page description (renderApp @10719274), with our product's name.
	it("says the variables are used by the app and passed to agents", async () => {
		await mountPage();

		expect(
			screen.getByText("Configure environment variables used by Conducted and passed to agents."),
		).toBeTruthy();
	});

	it("names each variable that failed to import and keeps the banner", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		await test.container.platform.fs.writeTextAtomic(
			`${test.container.platform.fs.paths.home}/.env`,
			"FIRST=one\nCONDUCTED_PORT=9\n",
		);
		const failed = vi.spyOn(toast, "error");
		render(
			<ServicesProvider container={test.container}>
				<EnvironmentPage />
			</ServicesProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Import" }));

		await waitFor(() =>
			expect(failed).toHaveBeenCalledWith(
				"Imported 1 of 2 variables",
				expect.objectContaining({
					description: "CONDUCTED_PORT: The app sets CONDUCTED_PORT itself. Choose another name.",
				}),
			),
		);
		expect(await test.memory.platform.keychain.get("env:global:FIRST")).toEqual({
			ok: true,
			value: "one",
		});
		expect(test.container.services.settings.get("local_env_vars_import_banner_dismissed")).toBe(
			false,
		);
		expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
	});

	it("keeps a repository's env file in that repository, out of the other scopes", async () => {
		const { container, repo } = await mountPage(true);

		fireEvent.click(screen.getByRole("button", { name: "Add env file" }));
		fireEvent.change(screen.getByLabelText("Environment file path"), {
			target: { value: ".env.local" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add" }));

		expect(await screen.findByText(".env.local")).toBeTruthy();
		const forRepo = await container.services.settings.getForRepo(
			"environment_variable_files",
			repo.rootPath,
			null,
		);
		expect(forRepo.ok && forRepo.value.value).toEqual([".env.local"]);
		expect(container.services.settings.get("environment_variable_files")).toEqual([]);

		cleanup();
		render(
			<ServicesProvider container={container}>
				<EnvironmentPage />
			</ServicesProvider>,
		);
		await screen.findByRole("button", { name: "Add environment variable" });
		await waitFor(() => expect(screen.queryByText(".env.local")).toBeNull());
	});

	it("SET-02: resets a repository's own env file list so the shared settings apply again", async () => {
		const { container, repo } = await mountPage(true);
		expect(screen.queryByRole("button", { name: "Reset to shared settings" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Add env file" }));
		fireEvent.change(screen.getByLabelText("Environment file path"), {
			target: { value: ".env.local" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add" }));
		expect(await screen.findByText(".env.local")).toBeTruthy();
		const reset = vi.spyOn(container.actions.settings, "resetForRepo");

		fireEvent.click(await screen.findByRole("button", { name: "Reset to shared settings" }));

		await waitFor(() => expect(screen.queryByText(".env.local")).toBeNull());
		expect(reset).toHaveBeenCalledWith(repo.id, "environment_variable_files");
		const forRepo = await container.services.settings.getForRepo(
			"environment_variable_files",
			repo.rootPath,
			null,
		);
		expect(forRepo.ok && forRepo.value.source).toBe("default");
		expect(screen.queryByRole("button", { name: "Reset to shared settings" })).toBeNull();
	});

	// Conductor's repository page lists the user's variables under "Inherited from User", read only,
	// dimming the ones the repository replaces (renderApp PDa, TDa).
	it("lists every repository's variables under Inherited from User, dimming the replaced one", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		const repo = await seedRepo(test.container);
		const { settings } = test.container.services;
		expect((await settings.setEnvVar("SHARED", "one", "global")).ok).toBe(true);
		expect((await settings.setEnvVar("TOKEN", "global", "global")).ok).toBe(true);
		expect((await settings.setEnvVar("TOKEN", "local", { repoId: repo.id as RepoId })).ok).toBe(
			true,
		);
		render(
			<ServicesProvider container={test.container}>
				<EnvironmentPage repoId={repo.id} />
			</ServicesProvider>,
		);

		const inherited = (await screen.findByRole("heading", { name: "Inherited from User" }))
			.parentElement as HTMLElement;
		await within(inherited).findByText("SHARED");
		const rows = [...inherited.querySelectorAll("tbody tr")];
		expect(rows.map((row) => row.querySelector(".font-mono")?.textContent)).toEqual([
			"SHARED",
			"TOKEN",
		]);
		expect(rows[1]?.className).toContain("opacity-50");
		expect(within(inherited).queryByRole("button", { name: "Delete SHARED" })).toBeNull();

		fireEvent.click(within(inherited).getByRole("button", { name: "View SHARED" }));
		const panel = await screen.findByRole("dialog", { name: "View inherited variable" });
		await waitFor(() =>
			expect((within(panel).getByLabelText("Value") as HTMLTextAreaElement).value).toBe("one"),
		);
	});

	it("edits a variable's value in the side panel", async () => {
		const { container } = await mountPage();
		await addThroughPanel("TOKEN", "abc");
		fireEvent.click(await screen.findByRole("button", { name: "Edit TOKEN" }));
		const panel = await screen.findByRole("dialog", { name: "Edit shared variable" });
		await waitFor(() =>
			expect((within(panel).getByLabelText("Value") as HTMLTextAreaElement).value).toBe("abc"),
		);

		fireEvent.change(within(panel).getByLabelText("Value"), { target: { value: "rotated" } });
		fireEvent.click(within(panel).getByRole("button", { name: /^Save/ }));

		await waitFor(async () =>
			expect(await container.platform.keychain.get("env:global:TOKEN")).toEqual({
				ok: true,
				value: "rotated",
			}),
		);
	});

	// Conductor writes a repository's env file list through its settings writer, whose failed-save
	// toast offers "Overwrite file" for an invalid file (Uz, main @389730). The page's own "Failed
	// to update env files" is only for a write that throws (renderApp @10725586). Ours said that
	// for every failure (issue #654).
	it("offers Overwrite file when an env file meets an invalid local settings file", async () => {
		const { container, repo } = await mountPage(true);
		render(<Toaster />);
		if (test === undefined) throw new Error("no container");
		const file = await seedInvalidLocalSettings(test, repo);

		fireEvent.click(screen.getByRole("button", { name: "Add env file" }));
		fireEvent.change(screen.getByLabelText("Environment file path"), {
			target: { value: ".env.local" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add" }));
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
				environment_variable_files: [".env.local"],
			});
		});
		expect(await screen.findByText(".env.local")).toBeTruthy();
	});
});
