import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { GeneralPage } from "./GeneralPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("SET-02 GeneralPage", () => {
	it("saves a changed send key once", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		const set = vi.spyOn(test.container.actions.settings, "set");
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
			</ServicesProvider>,
		);

		const trigger = screen.getByRole("combobox", { name: "Send key" });
		fireEvent.keyDown(trigger, { key: "Enter" });
		const option = await screen.findByRole("option", { name: "Cmd+Enter" });
		fireEvent.keyDown(option, { key: "Enter" });

		await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
		expect(set).toHaveBeenCalledWith("message_send_key", "cmd-enter");
	});

	it("shows the failure under the row when a save fails", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		vi.spyOn(test.container.actions.settings, "set").mockResolvedValue({
			ok: false,
			error: { code: "settings_save_failed", message: "The settings file is read-only." },
		});
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
			</ServicesProvider>,
		);

		fireEvent.click(screen.getByRole("switch", { name: "Agent notifications" }));

		expect(await screen.findByText("The settings file is read-only.")).toBeTruthy();
	});

	it("shows a failed settings load with a Retry that reads the settings again", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		test.container.services.settings.store.setState({
			warnings: [{ code: "settings_load_failed", message: "Failed to load settings" }],
		});
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
			</ServicesProvider>,
		);

		expect(screen.getByText("Couldn't load this settings page")).toBeTruthy();
		expect(screen.getByText("Failed to load settings")).toBeTruthy();
		expect(screen.queryByRole("combobox", { name: "Send key" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(await screen.findByRole("combobox", { name: "Send key" })).toBeTruthy();
		expect(test.container.services.settings.store.getState().warnings).toEqual([]);
	});

	it("lists the settings-file entries the store dropped", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		test.container.services.settings.store.setState({
			dropped: [{ file: "settings.toml", key: "theme_colour", reason: "unknown-key" }],
		});
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
			</ServicesProvider>,
		);

		expect(screen.getByText("Some saved settings were ignored")).toBeTruthy();
		expect(screen.getByText("theme_colour")).toBeTruthy();
		expect(screen.getByText(/in settings\.toml: unknown setting/)).toBeTruthy();
	});
});
