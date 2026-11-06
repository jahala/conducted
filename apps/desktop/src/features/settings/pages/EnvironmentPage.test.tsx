import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, seedRepo, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { toast } from "../../../ui/Toast.tsx";
import { EnvironmentPage } from "./EnvironmentPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	test?.close();
	test = undefined;
});

async function mountPage() {
	test = createTestContainer();
	await test.container.services.settings.start();
	const repo = await seedRepo(test.container);
	render(
		<ServicesProvider container={test.container}>
			<EnvironmentPage />
		</ServicesProvider>,
	);
	await screen.findByLabelText("Name");
	return { container: test.container, repo };
}

describe("SET-04 EnvironmentPage", () => {
	it("adds a variable in the chosen scope and shows the row with a hidden value", async () => {
		const { container } = await mountPage();
		const original = container.services.settings.setEnvVar.bind(container.services.settings);
		const setEnvVar = vi
			.spyOn(container.services.settings, "setEnvVar")
			.mockImplementation((name, value, scope) => original(name, value, scope));

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "TOKEN" } });
		fireEvent.change(screen.getByLabelText("Value"), { target: { value: "abc" } });
		fireEvent.click(screen.getByRole("button", { name: "Add variable" }));

		await waitFor(() => expect(setEnvVar).toHaveBeenCalledWith("TOKEN", "abc", "global"));
		expect(await screen.findByText("TOKEN")).toBeTruthy();
		expect(screen.getByText("••••••••")).toBeTruthy();
		expect(await test?.memory.platform.keychain.get("env:global:TOKEN")).toEqual({
			ok: true,
			value: "abc",
		});
	});

	it("saves a repository's variable in that repository's scope", async () => {
		const { container, repo } = await mountPage();
		const original = container.services.settings.setEnvVar.bind(container.services.settings);
		const setEnvVar = vi
			.spyOn(container.services.settings, "setEnvVar")
			.mockImplementation((name, value, scope) => original(name, value, scope));

		fireEvent.keyDown(screen.getByRole("combobox", { name: "Scope" }), { key: "Enter" });
		fireEvent.keyDown(await screen.findByRole("option", { name: repo.name }), { key: "Enter" });

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "LOCAL" } });
		fireEvent.change(screen.getByLabelText("Value"), { target: { value: "yes" } });
		fireEvent.click(screen.getByRole("button", { name: "Add variable" }));

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
	it("says the variables reach agents, setup scripts and actions, and not terminals", async () => {
		await mountPage();

		expect(
			screen.getByText(
				"Variables given to agents, setup scripts and actions. Values stay in the macOS Keychain.",
			),
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
		const { container, repo } = await mountPage();

		fireEvent.keyDown(screen.getByRole("combobox", { name: "Scope" }), { key: "Enter" });
		fireEvent.keyDown(await screen.findByRole("option", { name: repo.name }), { key: "Enter" });
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

		fireEvent.keyDown(screen.getByRole("combobox", { name: "Scope" }), { key: "Enter" });
		fireEvent.keyDown(await screen.findByRole("option", { name: "All repositories" }), {
			key: "Enter",
		});
		await waitFor(() => expect(screen.queryByText(".env.local")).toBeNull());
	});
});
