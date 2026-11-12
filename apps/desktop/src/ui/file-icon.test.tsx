/**
 * @feature APP-05 File icons
 * Tests that a kind in Conductor's brand table gets its tinted glyph (#534), that every other file
 * picks the Material Icon Theme's own icon through its manifest, and that every tint is a token.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { siDocker, siNodedotjs, siRust, siTypescript } from "simple-icons";
import { afterEach, describe, expect, it } from "vitest";
import { BRAND_TABLE, fileIcon, fileIconName } from "./file-icon.ts";
import { FileTypeIcon } from "./file-icon.tsx";

afterEach(cleanup);

/** The drawn glyph's single path, and its classes. */
function drawn(path: string): {
	d: string | null | undefined;
	className: string | null | undefined;
} {
	const { container } = render(<FileTypeIcon path={path} />);
	const svg = container.querySelector("svg[data-file-icon]");
	return {
		d: svg?.querySelector("path")?.getAttribute("d"),
		className: svg?.getAttribute("class"),
	};
}

describe("APP-05 Conductor's brand glyphs", () => {
	it("gives a kind in Conductor's table its glyph and tint", () => {
		expect(fileIcon("main.rs")).toEqual({ kind: "glyph", glyph: "rust", tint: "orange-700" });
		expect(fileIcon("a.ts")).toEqual({ kind: "glyph", glyph: "typescript", tint: "blue-600" });
		expect(fileIcon("package.json")).toEqual({ kind: "glyph", glyph: "nodejs", tint: "green-600" });
		expect(fileIcon("Dockerfile")).toEqual({ kind: "glyph", glyph: "docker", tint: "blue-500" });
		expect(fileIcon("Dockerfile.dev")).toEqual({
			kind: "glyph",
			glyph: "docker",
			tint: "blue-500",
		});
	});

	it("reads the whole name in lower case, then the Dockerfile prefix, then the last extension", () => {
		expect(fileIcon("Cargo.toml")).toEqual({ kind: "glyph", glyph: "rust", tint: "orange-700" });
		expect(fileIcon("README.MD")).toEqual({
			kind: "glyph",
			glyph: "markdown",
			tint: "documentation",
		});
		expect(fileIcon("types.d.ts")).toEqual({
			kind: "glyph",
			glyph: "typescript",
			tint: "blue-600",
		});
		expect(fileIcon(".env")).toEqual({ kind: "glyph", glyph: "settings", tint: "yellow-600" });
		expect(fileIcon("dockerfiles")).toEqual({ kind: "material", icon: "file" });
	});

	it("matches a name only when it is the whole string, as Conductor's path chip does", () => {
		expect(fileIcon("apps/web/package.json")).toEqual({
			kind: "glyph",
			glyph: "json",
			tint: "yellow-600",
		});
		expect(fileIcon("apps/web/Dockerfile")).toEqual({ kind: "material", icon: "docker" });
	});

	it("keeps the Material icon for a kind outside the table", () => {
		expect(fileIcon("init.lua")).toEqual({ kind: "material", icon: "lua" });
		expect(fileIcon("src/init.lua")).toEqual({ kind: "material", icon: "lua" });
		expect(fileIcon("Makefile")).toEqual({ kind: "material", icon: "makefile" });
	});

	it("draws the Simple Icons glyph in Conductor's tint for the issue's four kinds", () => {
		expect(drawn("src/main.rs")).toEqual({
			d: siRust.path,
			className: expect.stringContaining("text-file-orange-700"),
		});
		expect(drawn("src/a.ts").d).toBe(siTypescript.path);
		expect(drawn("package.json").d).toBe(siNodedotjs.path);
		expect(drawn("Dockerfile").d).toBe(siDocker.path);
	});

	it("draws every glyph in the table as one tinted SVG", () => {
		// Conductor 0.92.1's table holds 22 names and 84 reachable extensions.
		expect(Object.keys(BRAND_TABLE.names)).toHaveLength(22);
		expect(Object.keys(BRAND_TABLE.extensions)).toHaveLength(84);
		for (const [name, entry] of Object.entries(BRAND_TABLE.names)) {
			const { d, className } = drawn(name);
			expect(d, name).toBeTruthy();
			expect(className, name).toContain(`text-file-${entry.tint}`);
		}
		for (const [extension, entry] of Object.entries(BRAND_TABLE.extensions)) {
			const { d, className } = drawn(`file.${extension}`);
			expect(d, extension).toBeTruthy();
			expect(className, extension).toContain(`text-file-${entry.tint}`);
		}
	});

	it("defines a colour token for every tint the table uses", () => {
		const css = readFileSync(join(import.meta.dirname, "..", "styles.css"), "utf8");
		const tints = new Set(
			[
				...Object.values(BRAND_TABLE.names),
				...Object.values(BRAND_TABLE.extensions),
				BRAND_TABLE.dockerfile,
			].map((entry) => entry.tint),
		);
		expect(tints.size).toBe(30);
		for (const tint of tints) expect(css, tint).toContain(`--color-file-${tint}:`);
	});
});

describe("APP-05 Material file icons", () => {
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

	it("reads only the tables' own keys, so a file named like an object property gets the file icon", () => {
		expect(fileIconName("constructor")).toBe("file");
		expect(fileIconName("src/__proto__")).toBe("file");
		expect(fileIcon("toString")).toEqual({ kind: "material", icon: "file" });
	});

	// Was a .rs file, which #534 moved into Conductor's brand table.
	it("draws the theme's icon as an image for a file outside Conductor's table", () => {
		const { container } = render(<FileTypeIcon path="src/init.lua" />);
		const icon = container.querySelector("img[data-file-icon]");
		expect(icon?.getAttribute("data-file-icon")).toBe("lua");
		expect(icon?.getAttribute("src")).toBeTruthy();
	});
});
