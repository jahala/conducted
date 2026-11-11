/**
 * @feature APP-05 File language
 * Tests the path-to-language rule the file icons and the editor's Shiki highlighting share.
 */
import { describe, expect, it } from "vitest";
import { fileLanguage } from "./file-language.ts";

describe("APP-05 fileLanguage", () => {
	it("reads src/main.rs as rust and README.md as markdown", () => {
		expect(fileLanguage("src/main.rs")).toBe("rust");
		expect(fileLanguage("src/a.ts")).toBe("typescript");
		expect(fileLanguage("src/a.TSX")).toBe("tsx");
		expect(fileLanguage("README.md")).toBe("markdown");
	});

	it("lets an exact file name win over its extension", () => {
		expect(fileLanguage("package.json")).toBe("javascript");
		expect(fileLanguage("Cargo.toml")).toBe("rust");
		expect(fileLanguage(".gitignore")).toBe("file");
	});

	it("gives a dotfile and an unknown extension the generic file", () => {
		expect(fileLanguage(".env.local")).toBe("file");
		expect(fileLanguage("data.bin")).toBe("file");
		expect(fileLanguage("no-extension")).toBe("file");
	});
});
