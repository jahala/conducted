import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { renderWithRouter } from "../../../test/render-with-router.tsx";
import { SettingsScreen } from "../SettingsScreen.tsx";
import { RemoteControlPage } from "./RemoteControlPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("RC-04 Remote control settings page", () => {
	it("shows both switches, and turning Remote Control on for new chats stores it", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<RemoteControlPage />
			</ServicesProvider>,
		);

		const keepAwake = screen.getByRole("switch", { name: "Keep this Mac awake" });
		expect(keepAwake.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(screen.getByRole("switch", { name: "Remote Control for new chats" }));

		const settings = test.container.services.settings;
		await waitFor(() => expect(settings.get("remote_control_new_chats")).toBe(true));
	});

	it("is a page of the settings screen", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		renderWithRouter(
			<ServicesProvider container={test.container}>
				<SettingsScreen page="remote-control" />
			</ServicesProvider>,
		);
		expect(await screen.findByRole("switch", { name: "Keep this Mac awake" })).toBeTruthy();
	});
});
