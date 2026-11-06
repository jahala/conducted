/**
 * @feature SET-06 Appearance applied to the whole app
 * Owns: tests that the root's AppearanceController writes the stored appearance to the document
 * without the Appearance page, and that Cmd+Alt+T switches away from the theme on screen.
 * Behaviour: ui-map.md 5.4, 6, 8.
 * Test first: with the theme following a dark Mac, the first Cmd+Alt+T stores "light".
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { AppearanceController } from "./AppearanceController.tsx";

let current: TestContainer | null = null;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	current?.close();
	current = null;
	for (const name of ["data-theme", "data-contrast", "data-color-vision", "data-vibrancy"]) {
		document.documentElement.removeAttribute(name);
	}
	document.documentElement.style.removeProperty("zoom");
});

function mount(values: Record<string, string | number | boolean>) {
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

describe("SET-06 AppearanceController", () => {
	it("writes the stored theme to the document and the zoom to the window", () => {
		const test = mount({ theme: "dark", color_vision: "tritanopia", zoom_level_v2: 1.5 });

		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
		expect(document.documentElement.getAttribute("data-color-vision")).toBe("tritanopia");
		expect(test.memory.controls.windowZoom).toBe(1.5);
	});

	it("switches to light first when the theme follows a dark Mac", async () => {
		// seam: SET-06 jsdom has no colour scheme, so the dark macOS appearance is given here
		vi.spyOn(window, "matchMedia").mockImplementation(
			(query: string) =>
				({
					matches: query === "(prefers-color-scheme: dark)",
					media: query,
					onchange: null,
					addEventListener: () => {},
					removeEventListener: () => {},
					addListener: () => {},
					removeListener: () => {},
					dispatchEvent: () => false,
				}) as MediaQueryList,
		);
		const test = mount({ theme: "system" });

		fireEvent.keyDown(document, { key: "t", metaKey: true, altKey: true });

		await waitFor(() =>
			expect(test.container.services.settings.store.getState().values.theme).toBe("light"),
		);
		await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("light"));
	});
});
