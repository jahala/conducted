/**
 * @feature NAV-03 Sidebar section header marks
 * Owns: tests for the count and chevron rules of the sidebar's list headers, measured from Conductor.
 * Test first: a collapsed header shows a right chevron and an open one shows none until hovered.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HeaderChevron, HeaderCount } from "./section-header.tsx";

afterEach(cleanup);

describe("NAV-03 section header marks", () => {
	it("keeps a section's chevron on show while collapsed and on hover while open", () => {
		const { container, rerender } = render(<HeaderChevron open={false} />);
		const collapsed = container.querySelector("[data-chevron]");
		expect(collapsed?.getAttribute("data-chevron")).toBe("collapsed");
		expect(collapsed?.className).not.toContain("opacity-0");
		rerender(<HeaderChevron open />);
		expect(container.querySelector("[data-chevron]")?.className).toContain("opacity-0");
	});

	it("shows a status or project group's chevron on hover only, after the count", () => {
		const { container } = render(<HeaderChevron open={false} variant="group" />);
		const chevron = container.querySelector("[data-chevron]");
		expect(chevron?.className).toContain("opacity-0");
		expect(chevron?.className).not.toContain("ml-auto");
	});

	it("shows a collapsed section's count on hover and a collapsed group's count always", () => {
		const section = render(<HeaderCount open={false} count={3} />);
		expect(section.getByText("3").className).toContain("opacity-0");
		section.unmount();
		const group = render(<HeaderCount open={false} count={3} variant="group" />);
		expect(group.getByText("3").className).not.toContain("opacity-0");
		expect(group.getByText("3").className).toContain("font-mono");
		group.unmount();
		const open = render(<HeaderCount open count={3} />);
		expect(open.queryByText("3")).toBeNull();
	});
});
