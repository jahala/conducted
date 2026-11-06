/**
 * @feature REV-08 SVG preview
 * Tests that a script in an SVG never runs and the source switch.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SvgPreview } from "./SvgPreview.tsx";

afterEach(cleanup);

describe("REV-08 SvgPreview", () => {
	it("renders an SVG with a script element without executing it", () => {
		const source =
			'<svg xmlns="http://www.w3.org/2000/svg"><script>window.__svgRan = true;</script><circle r="4" /></svg>';
		const { container } = render(
			<SvgPreview source={source} view="rendered" onViewChange={() => {}} />,
		);
		expect(container.querySelector("script")).toBeNull();
		expect((window as unknown as { __svgRan?: boolean }).__svgRan).toBeUndefined();
		expect(container.querySelector("img")).not.toBeNull();
	});

	it("switches to the raw source and back through the buttons", () => {
		const onViewChange = vi.fn();
		render(<SvgPreview source="<svg />" view="rendered" onViewChange={onViewChange} />);
		fireEvent.click(screen.getByRole("button", { name: "View raw SVG code" }));
		expect(onViewChange).toHaveBeenCalledWith("source");
		fireEvent.click(screen.getByRole("button", { name: "View rendered SVG" }));
		expect(onViewChange).toHaveBeenCalledWith("rendered");
	});

	it("shows the source when the parent asks for it", () => {
		render(<SvgPreview source="<svg><rect /></svg>" view="source" onViewChange={() => {}} />);
		expect(screen.getByText("<svg><rect /></svg>")).toBeTruthy();
	});
});
