import { appError, err } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import "../../../test/dom-polyfills.ts";
import { AppearancePage } from "./AppearancePage.tsx";

let current: TestContainer | null = null;

function clearDocumentAppearance() {
	for (const name of ["data-theme", "data-contrast", "data-color-vision", "data-vibrancy"]) {
		document.documentElement.removeAttribute(name);
	}
	document.documentElement.style.removeProperty("zoom");
}

afterEach(() => {
	cleanup();
	current?.close();
	current = null;
	clearDocumentAppearance();
});

function renderPage() {
	const test = createTestContainer();
	current = test;
	render(
		<ServicesProvider container={test.container}>
			<AppearancePage />
		</ServicesProvider>,
	);
	return test;
}

function renderPageWithDispatcher() {
	const test = createTestContainer();
	current = test;
	render(
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				<AppearancePage />
			</CommandDispatcher>
		</ServicesProvider>,
	);
	return test;
}

async function choose(selectName: string, optionName: string) {
	fireEvent.keyDown(screen.getByRole("combobox", { name: selectName }), { key: "Enter" });
	fireEvent.keyDown(await screen.findByRole("option", { name: optionName }), { key: "Enter" });
}

function values(test: TestContainer) {
	return test.container.services.settings.store.getState().values;
}

describe("SET-06 AppearancePage", () => {
	it("offers a control for every appearance setting", () => {
		renderPage();

		expect(screen.getByRole("combobox", { name: "Theme" })).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Softer dark theme" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Color vision palette" })).toBeTruthy();
		expect(screen.getByRole("slider", { name: "App zoom" })).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Colored line counts in the sidebar" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Code theme" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Code font style" })).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Code ligatures" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Markdown style" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Terminal font style" })).toBeTruthy();
		expect(screen.getByRole("spinbutton", { name: "Terminal font size" })).toBeTruthy();
	});

	it("re-renders the code preview when the code theme changes", async () => {
		const test = renderPage();
		const preview = screen.getByRole("figure", { name: "Code preview" });
		expect(preview.getAttribute("data-code-theme")).toBe("default");
		expect(within(preview).getByText("Default")).toBeTruthy();

		await choose("Code theme", "Dracula");

		await waitFor(() => expect(values(test).code_theme).toBe("dracula"));
		expect(preview.getAttribute("data-code-theme")).toBe("dracula");
		expect(within(preview).getByText("Dracula")).toBeTruthy();
	});

	it("saves the theme and applies it to the document", async () => {
		const test = renderPage();

		await choose("Theme", "Dark");

		await waitFor(() => expect(values(test).theme).toBe("dark"));
		await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
	});

	it("saves the colour-vision palette and applies it to the document", async () => {
		const test = renderPage();

		await choose("Color vision palette", "Tritanopia");

		await waitFor(() => expect(values(test).color_vision).toBe("tritanopia"));
		await waitFor(() =>
			expect(document.documentElement.getAttribute("data-color-vision")).toBe("tritanopia"),
		);
	});

	it("saves low-contrast dark mode and applies it to the document", async () => {
		const test = renderPage();

		fireEvent.keyDown(screen.getByRole("switch", { name: "Softer dark theme" }), { key: " " });

		await waitFor(() => expect(values(test).low_contrast_dark_mode).toBe(true));
		await waitFor(() => expect(document.documentElement.getAttribute("data-contrast")).toBe("low"));
	});

	it("saves the sidebar diff colours, ligatures and Markdown style", async () => {
		const test = renderPage();

		fireEvent.keyDown(screen.getByRole("switch", { name: "Colored line counts in the sidebar" }), {
			key: " ",
		});
		fireEvent.keyDown(screen.getByRole("switch", { name: "Code ligatures" }), { key: " " });
		await choose("Markdown style", "Tufte");

		await waitFor(() => expect(values(test).colored_sidebar_diffs).toBe(true));
		await waitFor(() => expect(values(test).file_ligatures_enabled).toBe(false));
		await waitFor(() => expect(values(test).markdown_style).toBe("tufte"));
	});

	it("saves a custom code font, terminal font and terminal size", async () => {
		const test = renderPage();

		await choose("Code font style", "Custom");
		const codeFont = screen.getByLabelText("Code font family");
		fireEvent.change(codeFont, { target: { value: "Berkeley Mono" } });
		fireEvent.blur(codeFont);
		await waitFor(() => expect(values(test).mono_font).toBe("Berkeley Mono"));

		await choose("Terminal font style", "Custom");
		const terminalFont = screen.getByLabelText("Terminal font family");
		fireEvent.change(terminalFont, { target: { value: "Menlo" } });
		fireEvent.blur(terminalFont);
		await waitFor(() => expect(values(test).terminal_font_family).toBe("Menlo"));

		const size = screen.getByLabelText("Terminal font size");
		fireEvent.change(size, { target: { value: "18" } });
		fireEvent.blur(size);
		await waitFor(() => expect(values(test).terminal_font_size).toBe(18));
	});

	it("shows the settings store failure", () => {
		const test = createTestContainer();
		current = test;
		test.container.services.settings.store.setState({
			warnings: [{ code: "settings_load_failed", message: "Failed to load settings" }],
		});

		render(
			<ServicesProvider container={test.container}>
				<AppearancePage />
			</ServicesProvider>,
		);

		expect(screen.getByText("Couldn't load all settings")).toBeTruthy();
		expect(screen.getByText("Failed to load settings")).toBeTruthy();
	});

	it("shows the error and keeps the old value when a save fails", async () => {
		const test = createTestContainer();
		current = test;
		vi.spyOn(test.container.actions.settings, "set").mockResolvedValue(
			err(appError("setting_save_failed", "Couldn't save the setting")),
		);

		render(
			<ServicesProvider container={test.container}>
				<AppearancePage />
			</ServicesProvider>,
		);

		fireEvent.keyDown(screen.getByRole("switch", { name: "Code ligatures" }), { key: " " });

		expect(await screen.findByText("Couldn't save the setting")).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Code ligatures" }).getAttribute("data-state")).toBe(
			"checked",
		);
	});

	it("switches the theme with Cmd+Alt+T", async () => {
		const test = renderPageWithDispatcher();

		fireEvent.keyDown(document, { key: "t", metaKey: true, altKey: true });

		await waitFor(() => expect(values(test).theme).toBe("dark"));
		await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
	});

	it("zooms in, zooms out and resets with the keyboard", async () => {
		const test = renderPageWithDispatcher();

		fireEvent.keyDown(document, { key: "=", metaKey: true });
		await waitFor(() => expect(values(test).zoom_level_v2).toBe(1.1));

		fireEvent.keyDown(document, { key: "=", metaKey: true });
		await waitFor(() => expect(values(test).zoom_level_v2).toBe(1.2));

		fireEvent.keyDown(document, { key: "-", metaKey: true });
		await waitFor(() => expect(values(test).zoom_level_v2).toBe(1.1));

		fireEvent.keyDown(document, { key: "0", metaKey: true });
		await waitFor(() => expect(values(test).zoom_level_v2).toBe(1));
		await waitFor(() => expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1"));
	});
});
