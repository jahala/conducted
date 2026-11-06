/**
 * @feature PLAT-23 Window look: vibrancy, traffic lights and zoom
 * Owns: tests that the stored appearance reaches the window through the Platform at startup, and
 * that the zoom shortcuts and the theme shortcut change the window too.
 * Behaviour: native-and-sidecar-map.md A2 and A5, ui-map.md 5.4 and 6.
 * Test first: a stored zoom of 1.5, a dark theme and sidebar transparency on reach the window when
 * the root mounts.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CommandDispatcher } from "../../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { AppearanceController } from "./AppearanceController.tsx";

let current: TestContainer | null = null;

afterEach(() => {
	cleanup();
	current?.close();
	current = null;
	for (const name of ["data-theme", "data-contrast", "data-color-vision", "data-vibrancy"]) {
		document.documentElement.removeAttribute(name);
	}
});

function mount(values: Record<string, string | number | boolean>): TestContainer {
	const test = createTestContainer();
	current = test;
	test.container.services.settings.store.setState({ loaded: true, values });
	render(
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				<AppearanceController />
			</CommandDispatcher>
		</ServicesProvider>,
	);
	return test;
}

describe("PLAT-23 window look", () => {
	it("applies the stored theme, zoom, transparency and traffic-light inset at startup", async () => {
		const test = mount({
			theme: "dark",
			zoom_level_v2: 1.5,
			experimental_sidebar_transparency: true,
		});

		await waitFor(() => expect(test.memory.controls.windowZoom).toBe(1.5));
		expect(test.memory.controls.windowTheme).toBe("dark");
		expect(test.memory.controls.vibrancy).toBe(true);
		expect(test.memory.controls.trafficLightPosition).toEqual({ x: 13, y: 13 });
	});

	it("zooms the window in, out and back to normal with the keyboard", async () => {
		const test = mount({ zoom_level_v2: 1 });

		fireEvent.keyDown(document, { key: "=", metaKey: true });
		await waitFor(() => expect(test.memory.controls.windowZoom).toBe(1.1));

		fireEvent.keyDown(document, { key: "=", metaKey: true });
		await waitFor(() => expect(test.memory.controls.windowZoom).toBe(1.2));

		fireEvent.keyDown(document, { key: "-", metaKey: true });
		await waitFor(() => expect(test.memory.controls.windowZoom).toBe(1.1));

		fireEvent.keyDown(document, { key: "0", metaKey: true });
		await waitFor(() => expect(test.memory.controls.windowZoom).toBe(1));
	});

	it("switches the window theme with Cmd+Alt+T", async () => {
		const test = mount({ theme: "light" });

		fireEvent.keyDown(document, { key: "t", metaKey: true, altKey: true });

		await waitFor(() => expect(test.memory.controls.windowTheme).toBe("dark"));
	});
});
