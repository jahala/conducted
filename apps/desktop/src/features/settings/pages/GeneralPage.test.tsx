import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { Toaster, toast } from "../../../ui/Toast.tsx";
import { GeneralPage } from "./GeneralPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
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

	it("says a failed save in a toast, with no line under the row", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		vi.spyOn(test.container.actions.settings, "set").mockResolvedValue({
			ok: false,
			error: { code: "settings_save_failed", message: "The settings file is read-only." },
		});
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.click(screen.getByRole("switch", { name: "Agent notifications" }));

		await waitFor(() =>
			expect(document.querySelector("[data-sonner-toast]")?.textContent).toContain(
				"The settings file is read-only.",
			),
		);
		// A failed save is told in the toast only, as in Conductor: no line under the row.
		expect(screen.queryByRole("alert")).toBeNull();
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

describe("SET-02 GeneralPage send key failures", () => {
	it("says when a send-key change fails, in Conductor's words", async () => {
		const { appError, err } = await import("@conducted/shared");
		const { Toaster } = await import("../../../ui/Toast.tsx");
		test = createTestContainer();
		await test.container.services.settings.start();
		vi.spyOn(test.container.actions.settings, "set").mockResolvedValue(
			err(appError("settings_write_failed", "The settings file is read-only")),
		);
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
				<Toaster />
			</ServicesProvider>,
		);

		const trigger = screen.getByRole("combobox", { name: "Send messages with" });
		fireEvent.keyDown(trigger, { key: "Enter" });
		const option = await screen.findByRole("option", { name: "⌘ Enter" });
		fireEvent.keyDown(option, { key: "Enter" });

		expect(await screen.findByText("Failed to update message send key")).toBeTruthy();
	});

	it("says when resetting the send key fails", async () => {
		const { appError, err } = await import("@conducted/shared");
		const { Toaster } = await import("../../../ui/Toast.tsx");
		test = createTestContainer();
		await test.container.services.settings.start();
		await test.container.actions.settings.set("message_send_key", "cmd-enter");
		vi.spyOn(test.container.actions.settings, "set").mockResolvedValue(
			err(appError("settings_write_failed", "The settings file is read-only")),
		);
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.keyDown(screen.getByRole("button", { name: "Setting actions" }), { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Reset" }));

		expect(await screen.findByText("Failed to reset message send key")).toBeTruthy();
	});
});
