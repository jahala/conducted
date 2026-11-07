import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
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

		const trigger = screen.getByRole("combobox", { name: "Send messages with" });
		fireEvent.keyDown(trigger, { key: "Enter" });
		const option = await screen.findByRole("option", { name: "⌘ Enter" });
		fireEvent.keyDown(option, { key: "Enter" });

		await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
		expect(set).toHaveBeenCalledWith("message_send_key", "cmd-enter");
	});

	it("plays the chosen completion sound from Test, and offers no Test while no sound is chosen", async () => {
		const played: string[] = [];
		test = createTestContainer({
			sound: {
				play: async (soundId) => {
					played.push(soundId);
				},
			},
		});
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
			</ServicesProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Test" }));
		await waitFor(() => expect(played).toEqual(["default"]));

		await test.container.actions.settings.set("sound_type", "none");
		await waitFor(() =>
			expect((screen.getByRole("button", { name: "Test" }) as HTMLButtonElement).disabled).toBe(
				true,
			),
		);
	});

	it("shows the title with no subtitle, as Conductor's General page has none", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
			</ServicesProvider>,
		);

		expect(await screen.findByRole("heading", { name: "General" })).toBeTruthy();
		expect(screen.queryByText(/Everyday behaviour/)).toBeNull();
		// Conductor's rows that have no line under the title get none here either.
		expect(screen.getAllByText("Arrange workspaces manually").length).toBeGreaterThan(0);
		expect(screen.queryByText(/Let you drag workspaces/)).toBeNull();
	});

	it("names the completion sound as Conductor does: Chime", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
			</ServicesProvider>,
		);

		const sound = await screen.findByRole("combobox", { name: "Completion sound" });
		expect(sound.textContent).toContain("Chime");
		expect(sound.textContent).not.toContain("Default chime");
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
		expect(screen.queryByRole("combobox", { name: "Send messages with" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(await screen.findByRole("combobox", { name: "Send messages with" })).toBeTruthy();
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

describe("PLAT-24 Full Disk Access row", () => {
	async function mountGeneral(prepare?: (mounted: TestContainer) => void) {
		test = createTestContainer();
		await test.container.services.settings.start();
		prepare?.(test);
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
			</ServicesProvider>,
		);
		return test;
	}

	it("PLAT-24 shows the permission as granted when the check allows it", async () => {
		await mountGeneral();

		expect(await screen.findByText("Granted")).toBeTruthy();
		expect(screen.getByText("Full disk access permissions")).toBeTruthy();
	});

	it("PLAT-24 shows no access and opens System Settings from the row", async () => {
		const mounted = await mountGeneral((mounted) =>
			mounted.memory.controls.setFullDiskAccess(false),
		);
		await screen.findByText("Not granted");
		const open = vi.spyOn(mounted.container.platform.system, "openFullDiskAccessSettings");

		fireEvent.click(screen.getByRole("button", { name: "Open System Settings" }));

		await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
	});

	it("PLAT-24 tells the user to grant the permission by hand when System Settings cannot open", async () => {
		const mounted = await mountGeneral();
		await screen.findByText("Granted");
		mounted.memory.controls.failOpenFullDiskAccessSettings("Launch Services refused the link.");

		fireEvent.click(screen.getByRole("button", { name: "Open System Settings" }));

		expect(
			await screen.findByText(/Grant Full Disk Access under Privacy & Security yourself/),
		).toBeTruthy();
	});
});
