import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodePreview } from "./CodePreview.tsx";

afterEach(cleanup);

function preview() {
	return screen.getByRole("figure", { name: "Code preview" });
}

describe("SET-06 CodePreview", () => {
	it("shows the chosen theme name and changes it when the theme prop changes", () => {
		const { rerender } = render(
			<CodePreview themeName="catppuccin-mocha" fontFamily={null} ligatures />,
		);

		expect(preview().getAttribute("data-code-theme")).toBe("catppuccin-mocha");
		expect(within(preview()).getByText("Catppuccin Mocha")).toBeTruthy();

		rerender(<CodePreview themeName="dracula" fontFamily={null} ligatures />);

		expect(preview().getAttribute("data-code-theme")).toBe("dracula");
		expect(within(preview()).getByText("Dracula")).toBeTruthy();
	});

	it("draws the sample with the theme's own editor background", () => {
		render(<CodePreview themeName="dracula" fontFamily={null} ligatures />);

		const background = preview().querySelector("pre")?.style.background.toLowerCase() ?? "";
		expect(background).toMatch(/#282a36|rgb\(40, 42, 54\)/);
	});

	it("applies the code font and ligature setting", () => {
		const { rerender } = render(
			<CodePreview themeName="default" fontFamily="Berkeley Mono" ligatures />,
		);
		expect(preview().getAttribute("data-ligatures")).toBe("on");
		expect(preview().getAttribute("data-code-font")).toBe("Berkeley Mono");

		rerender(<CodePreview themeName="default" fontFamily={null} ligatures={false} />);
		expect(preview().getAttribute("data-ligatures")).toBe("off");
		expect(preview().getAttribute("data-code-font")).toBe("default");
	});

	it("names an unknown theme and falls back to the Default palette", () => {
		render(<CodePreview themeName="not-a-theme" fontFamily={null} ligatures />);

		expect(screen.getByRole("alert").textContent).toContain("not-a-theme");
		expect(preview().textContent).toContain("greet");
	});
});
