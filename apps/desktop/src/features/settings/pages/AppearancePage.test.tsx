import { appError, err } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import { getSettingDef } from "../../../core/registries/settings.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { AppearanceController } from "../appearance/AppearanceController.tsx";
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

/**
 * A container whose settings store has loaded, as after the app's start. The page edits the values;
 * the root's AppearanceController writes them to the document, so it is mounted beside the page.
 */
function loadedContainer() {
	const test = createTestContainer();
	current = test;
	test.container.services.settings.store.setState({ loaded: true });
	return test;
}

function renderPage() {
	const test = loadedContainer();
	render(
		<ServicesProvider container={test.container}>
			<AppearanceController />
			<AppearancePage />
		</ServicesProvider>,
	);
	return test;
}

function renderPageWithDispatcher() {
	const test = loadedContainer();
	render(
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				<AppearanceController />
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
		expect(screen.getByRole("switch", { name: "Low-contrast dark mode" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Accessible colors" })).toBeTruthy();
		// Conductor's page (FOa): App zoom is a percentage picker, the terminal font a text field and
		// its size a slider.
		expect(screen.getByRole("combobox", { name: "App zoom" })).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Colored sidebar diffs" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Code theme" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Mono Font" })).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Code ligatures" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Markdown Style" })).toBeTruthy();
		expect(screen.getByRole("textbox", { name: "Terminal Font" })).toBeTruthy();
		expect(screen.getByRole("slider", { name: "Terminal Font Size" })).toBeTruthy();
	});

	it("lists the rows in one list in Conductor's order, with no section headings", () => {
		renderPage();

		for (const heading of ["Theme and colours", "Display", "Fonts and code", "Live preview"]) {
			expect(screen.queryByRole("heading", { name: heading })).toBeNull();
		}
		const order = [
			screen.getByRole("combobox", { name: "Theme" }),
			screen.getByRole("combobox", { name: "App zoom" }),
			screen.getByRole("combobox", { name: "Accessible colors" }),
			screen.getByRole("combobox", { name: "Code theme" }),
		];
		for (let index = 1; index < order.length; index++) {
			const before = order[index - 1] as HTMLElement;
			const after = order[index] as HTMLElement;
			expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		}
	});

	it("uses the wording of Conductor's page, with the live shortcuts", () => {
		renderPage();
		const row = (key: string) => document.querySelector(`[data-setting-key="${key}"]`);
		expect(row("theme")?.textContent).toContain("Toggle with");
		expect(row("theme")?.textContent).toContain("⌥⌘T");
		expect(row("theme")?.textContent).not.toContain("Switch between");
		expect(row("zoom_level_v2")?.textContent).toMatch(
			/Adjust with ⌘- \(zoom out\) or ⌘\S+ \(zoom in\)/,
		);
		expect(
			screen.getByText(
				"Enter font name exactly as installed, e.g. Arial, Papyrus, FiraCode Nerd Font",
			),
		).toBeTruthy();
		expect(screen.getByText("12px")).toBeTruthy();
	});

	it("puts each preview under its own row: code theme, mono font, Markdown style, terminal", () => {
		renderPage();
		const previewAfter = (key: string, name: string) => {
			const row = document.querySelector(`[data-setting-key="${key}"]`) as HTMLElement;
			const preview = screen.getByRole("figure", { name });
			expect(row.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
			return preview;
		};
		const code = previewAfter("code_theme", "Code preview");
		const mono = previewAfter("mono_font", "Mono font preview");
		const markdown = previewAfter("markdown_style", "Markdown preview");
		const terminal = previewAfter("terminal_font_family", "Terminal preview");
		for (const [first, second] of [
			[code, mono],
			[mono, markdown],
			[markdown, terminal],
		] as const) {
			expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		}
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

		await choose("Accessible colors", "Tritanopia");

		await waitFor(() => expect(values(test).color_vision).toBe("tritanopia"));
		await waitFor(() =>
			expect(document.documentElement.getAttribute("data-color-vision")).toBe("tritanopia"),
		);
	});

	it("saves low-contrast dark mode and applies it to the document", async () => {
		const test = renderPage();

		fireEvent.keyDown(screen.getByRole("switch", { name: "Low-contrast dark mode" }), { key: " " });

		await waitFor(() => expect(values(test).low_contrast_dark_mode).toBe(true));
		await waitFor(() => expect(document.documentElement.getAttribute("data-contrast")).toBe("low"));
	});

	it("saves the sidebar diff colours, ligatures and Markdown style", async () => {
		const test = renderPage();

		fireEvent.keyDown(screen.getByRole("switch", { name: "Colored sidebar diffs" }), {
			key: " ",
		});
		fireEvent.keyDown(screen.getByRole("switch", { name: "Code ligatures" }), { key: " " });
		await choose("Markdown Style", "Tufte");

		await waitFor(() => expect(values(test).colored_sidebar_diffs).toBe(true));
		await waitFor(() => expect(values(test).file_ligatures_enabled).toBe(false));
		await waitFor(() => expect(values(test).markdown_style).toBe("tufte"));
	});

	it("saves a custom code font, terminal font and terminal size", async () => {
		const test = renderPage();

		await choose("Mono Font", "Custom...");
		const codeFont = screen.getByLabelText("Mono Font family");
		fireEvent.change(codeFont, { target: { value: "Berkeley Mono" } });
		fireEvent.blur(codeFont);
		await waitFor(() => expect(values(test).mono_font).toBe("Berkeley Mono"));

		const terminalFont = screen.getByRole("textbox", { name: "Terminal Font" });
		fireEvent.change(terminalFont, { target: { value: "Menlo" } });
		fireEvent.blur(terminalFont);
		await waitFor(() => expect(values(test).terminal_font_family).toBe("Menlo"));

		fireEvent.keyDown(screen.getByRole("slider", { name: "Terminal Font Size" }), {
			key: "ArrowRight",
		});
		await waitFor(() => expect(values(test).terminal_font_size).toBe(13));
	});

	it("shows the settings store failure", () => {
		const test = loadedContainer();
		test.container.services.settings.store.setState({
			warnings: [{ code: "settings_load_failed", message: "Failed to load settings" }],
		});

		render(
			<ServicesProvider container={test.container}>
				<AppearancePage />
			</ServicesProvider>,
		);

		expect(screen.getByText("Couldn't load this settings page")).toBeTruthy();
		expect(screen.getByText("Failed to load settings")).toBeTruthy();
	});

	it("shows the error and keeps the old value when a save fails", async () => {
		const test = loadedContainer();
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
		await waitFor(() => expect(test.memory.controls.windowZoom).toBe(1));
	});

	it("puts the stored terminal font size back when the save is refused", async () => {
		const test = loadedContainer();
		vi.spyOn(test.container.actions.settings, "set").mockResolvedValue(
			err(appError("setting_save_failed", "Couldn't save the setting")),
		);
		render(
			<ServicesProvider container={test.container}>
				<AppearancePage />
			</ServicesProvider>,
		);
		const size = screen.getByRole("slider", { name: "Terminal Font Size" });
		const stored = size.getAttribute("aria-valuenow");

		fireEvent.keyDown(size, { key: "ArrowRight" });

		expect(await screen.findByText("Couldn't save the setting")).toBeTruthy();
		await waitFor(() => expect(size.getAttribute("aria-valuenow")).toBe(stored));
		expect(screen.getByText(`${stored}px`)).toBeTruthy();
	});

	it("takes the zoom range from the settings registry", () => {
		const def = getSettingDef("zoom_level_v2");
		if (def?.type !== "number" || def.min === undefined || def.max === undefined) {
			throw new Error("zoom_level_v2 must be a number setting with limits.");
		}
		const test = loadedContainer();
		test.container.services.settings.store.setState((state) => ({
			values: { ...state.values, zoom_level_v2: 2.5 },
		}));
		render(
			<ServicesProvider container={test.container}>
				<AppearancePage />
			</ServicesProvider>,
		);

		const picker = screen.getByRole("combobox", { name: "App zoom" });
		expect(picker.textContent).toContain("250%");
		fireEvent.keyDown(picker, { key: "Enter" });
		const choices = screen.getAllByRole("option").map((option) => option.textContent);
		expect(choices[0]).toBe(`${Math.round(def.min * 100)}%`);
		expect(choices.at(-1)).toBe(`${Math.round(def.max * 100)}%`);
		expect(choices).toHaveLength(Math.round((def.max - def.min) * 10) + 1);
	});

	it("highlights the setting a search opened", () => {
		const test = loadedContainer();
		render(
			<ServicesProvider container={test.container}>
				<AppearancePage focusSettingKey="zoom_level_v2" />
			</ServicesProvider>,
		);

		expect(
			document
				.querySelector('[data-setting-key="zoom_level_v2"]')
				?.getAttribute("data-highlighted"),
		).toBe("true");
	});
});
