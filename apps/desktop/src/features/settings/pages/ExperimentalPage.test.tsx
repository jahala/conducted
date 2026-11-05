import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
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

		fireEvent.click(screen.getByRole("switch", { name: "Transparent sidebar" }));

		expect(
			await screen.findByText(/Quit and reopen the app to apply sidebar transparency/),
		).toBeTruthy();
	});
});
