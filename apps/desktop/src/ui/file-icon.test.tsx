/**
 * @feature APP-05 File icons
 * Tests that a file name or extension picks the Material Icon Theme's own icon through its manifest,
 * and that the four kinds the issue names get the theme's icon rather than a drawn one.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fileIconName } from "./file-icon.ts";
import { FileTypeIcon } from "./file-icon.tsx";

afterEach(cleanup);

describe("APP-05 file icons", () => {
	it("maps the issue's four kinds through the theme's manifest", () => {
		expect(fileIconName("src/main.rs")).toBe("rust");
		expect(fileIconName("src/a.ts")).toBe("typescript");
		expect(fileIconName("data/config.json")).toBe("json");
		expect(fileIconName("docs/guide.md")).toBe("markdown");
	});

	it("reads an exact file name before an extension, in either case", () => {
		expect(fileIconName("package.json")).toBe("nodejs");
		expect(fileIconName("README.md")).toBe("readme");
		expect(fileIconName("Makefile")).toBe("makefile");
		expect(fileIconName(".gitignore")).toBe("git");
	});

	it("falls back to the theme's file icon when nothing matches", () => {
		expect(fileIconName("data.unknown")).toBe("file");
		expect(fileIconName("no-extension")).toBe("file");
	});

	it("draws the theme's icon as an image for a .rs file", () => {
		const { container } = render(<FileTypeIcon path="src/main.rs" />);
		const icon = container.querySelector("img[data-file-icon]");
		expect(icon?.getAttribute("data-file-icon")).toBe("rust");
		expect(icon?.getAttribute("src")).toBeTruthy();
	});
});
