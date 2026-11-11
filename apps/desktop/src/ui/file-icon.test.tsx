/**
 * @feature APP-05 File icons
 * Tests that a file gets its language icon and tint, that an unknown file gets the generic mark,
 * and that a folder draws open or closed.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FileTypeIcon } from "./file-icon.tsx";

afterEach(cleanup);

describe("APP-05 FileTypeIcon", () => {
	it("shows the rust icon for src/main.rs", () => {
		const { container } = render(<FileTypeIcon path="src/main.rs" />);
		const icon = container.querySelector("[data-file-icon]");
		expect(icon?.getAttribute("data-kind")).toBe("rust");
		expect(icon?.querySelector("svg")).not.toBeNull();
	});

	it("shows the TypeScript icon for a .ts file and the generic mark for an unknown type", () => {
		const { container } = render(<FileTypeIcon path="src/a.ts" />);
		expect(container.querySelector("[data-file-icon]")?.getAttribute("data-kind")).toBe(
			"typescript",
		);
		const generic = render(<FileTypeIcon path="data.unknown" />);
		expect(generic.container.querySelector("[data-file-icon]")?.getAttribute("data-kind")).toBe(
			"file",
		);
	});

	it("draws a folder, open or closed", () => {
		const { container } = render(<FileTypeIcon path="src" isDirectory />);
		expect(container.querySelector("[data-file-icon]")?.getAttribute("data-kind")).toBe("folder");
		const open = render(<FileTypeIcon path="src" isDirectory expanded />);
		expect(open.container.querySelector("[data-file-icon]")?.getAttribute("data-kind")).toBe(
			"folder-open",
		);
	});
});
