import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { ExperimentalPage } from "./ExperimentalPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("SET-02 ExperimentalPage", () => {
	it("uses Conductor's subtitle and order: Auto permission mode first, Graphite stack support last", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<ExperimentalPage />
			</ServicesProvider>,
		);

		expect(screen.getByText(/Experimental features that are under development\./).textContent).toBe(
			"Experimental features that are under development. Expect breaking changes.",
		);
		const keys = [...document.querySelectorAll("[data-setting-key]")].map((row) =>
			row.getAttribute("data-setting-key"),
		);
		expect(keys[0]).toBe("experimental_auto_permission_mode");
		expect(keys.at(-1)).toBe("graphite_disabled");
	});

	it("links Auto permission mode to Claude's page about auto mode", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		const openUrl = vi
			.spyOn(test.container.actions.app, "openUrl")
			.mockResolvedValue(ok(undefined));
		render(
			<ServicesProvider container={test.container}>
				<ExperimentalPage />
			</ServicesProvider>,
		);
		const row = document.querySelector('[data-setting-key="experimental_auto_permission_mode"]');
		if (!(row instanceof HTMLElement)) throw new Error("no Auto permission mode row");

		fireEvent.click(within(row).getByRole("link", { name: "Learn more" }));

		await waitFor(() =>
			expect(openUrl).toHaveBeenCalledWith("https://code.claude.com/docs/en/glossary#auto-mode"),
		);
	});

	it("shows the restart note after sidebar transparency is turned on", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<ExperimentalPage />
			</ServicesProvider>,
		);

		fireEvent.click(screen.getByRole("switch", { name: "Sidebar transparency" }));

		expect(
			await screen.findByText(/Quit and reopen the app to apply sidebar transparency/),
		).toBeTruthy();
	});

	it("shows Auto-run after setup, where the settings search sends it", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<ExperimentalPage focusSettingKey="auto_run_after_setup" />
			</ServicesProvider>,
		);

		expect(screen.getByRole("switch", { name: "Auto-run after setup" })).toBeTruthy();
		expect(
			document
				.querySelector('[data-setting-key="auto_run_after_setup"]')
				?.getAttribute("data-highlighted"),
		).toBe("true");
	});
});
