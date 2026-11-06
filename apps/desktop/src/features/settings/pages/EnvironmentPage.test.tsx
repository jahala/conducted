import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, seedRepo, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { EnvironmentPage } from "./EnvironmentPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
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
});
