import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
