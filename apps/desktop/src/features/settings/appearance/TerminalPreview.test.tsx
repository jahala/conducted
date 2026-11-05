import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalPreview } from "./TerminalPreview.tsx";

afterEach(cleanup);

const COLOUR_NAMES = [
	"Black",
	"Red",
	"Green",
	"Yellow",
	"Blue",
	"Magenta",
	"Cyan",
	"White",
	"Bright black",
	"Bright red",
	"Bright green",
	"Bright yellow",
	"Bright blue",
	"Bright magenta",
	"Bright cyan",
	"Bright white",
];

const COLOUR_TOKENS = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"bright-black",
	"bright-red",
	"bright-green",
	"bright-yellow",
	"bright-blue",
	"bright-magenta",
	"bright-cyan",
	"bright-white",
];

function preview() {
	return screen.getByRole("figure", { name: "Terminal preview" });
}

describe("SET-06 TerminalPreview", () => {
	it("shows all sixteen colour names once", () => {
		render(<TerminalPreview fontFamily="Menlo" fontSize={12} />);

		for (const name of COLOUR_NAMES) {
			expect(within(preview()).getAllByText(name)).toHaveLength(1);
		}
	});

	it("draws the text with the chosen font and size", () => {
		const { rerender } = render(<TerminalPreview fontFamily="Berkeley Mono" fontSize={12} />);
		const pre = preview().querySelector("pre");
		expect(pre?.style.fontFamily).toContain("Berkeley Mono");
		expect(pre?.style.fontSize).toBe("12px");

		rerender(<TerminalPreview fontFamily="Berkeley Mono" fontSize={18} />);
		expect(preview().querySelector("pre")?.style.fontSize).toBe("18px");
	});

	it("keeps the Menlo fallback list when no font is chosen", () => {
		render(<TerminalPreview fontFamily="" fontSize={12} />);

		expect(preview().querySelector("pre")?.style.fontFamily).toContain("Menlo");
		expect(preview().querySelector("pre")?.style.fontFamily).not.toMatch(/^,\s/);
	});

	it("uses the sixteen terminal colour tokens", () => {
		render(<TerminalPreview fontFamily="Menlo" fontSize={12} />);

		for (const token of COLOUR_TOKENS) {
			expect(preview().querySelector(`[data-colour="--color-term-${token}"]`)).not.toBeNull();
		}
	});
});
