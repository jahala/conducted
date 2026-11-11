/**
 * @feature REV-02 Diff theme
 * Tests that the code theme setting picks the Shiki theme names the renderer looks up, in each
 * app mode, with Conducted's Default theme standing in where the chosen theme has no matching mode.
 */
import { describe, expect, it } from "vitest";
import { diffThemeFor } from "./diff-theme.ts";

describe("REV-02 diffThemeFor", () => {
	it("uses the Conducted Default theme for the default setting in both modes", () => {
		expect(diffThemeFor("default", "dark")).toEqual({
			name: "conducted-default-dark",
			type: "dark",
		});
		expect(diffThemeFor("default", "light")).toEqual({
			name: "conducted-default-light",
			type: "light",
		});
	});

	it("uses a dark named theme in dark mode and the Default theme in light mode", () => {
		expect(diffThemeFor("dracula", "dark")).toEqual({ name: "dracula", type: "dark" });
		expect(diffThemeFor("dracula", "light")).toEqual({
			name: "conducted-default-light",
			type: "light",
		});
	});

	it("uses the light named theme in light mode and the Default theme in dark mode", () => {
		expect(diffThemeFor("catppuccin-latte", "light")).toEqual({
			name: "catppuccin-latte",
			type: "light",
		});
		expect(diffThemeFor("catppuccin-latte", "dark")).toEqual({
			name: "conducted-default-dark",
			type: "dark",
		});
	});

	it("falls back to the Default theme for a setting the app no longer offers", () => {
		expect(diffThemeFor("gone-theme", "dark").name).toBe("conducted-default-dark");
		expect(diffThemeFor("gone-theme", "light").name).toBe("conducted-default-light");
	});
});
