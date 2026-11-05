import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FullPage } from "./FullPage.tsx";

afterEach(cleanup);

describe("NAV-01 full-page frame", () => {
	it("renders its children below an element marked as a drag region", () => {
		const { container } = render(
			<FullPage>
				<p>settings content</p>
			</FullPage>,
		);

		const dragStrip = container.querySelector("[data-tauri-drag-region]");
		const content = screen.getByText("settings content");

		expect(dragStrip).not.toBeNull();
		expect(content).toBeTruthy();
		if (dragStrip === null) throw new Error("FullPage has no drag strip");
		expect(
			(dragStrip.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
		).toBe(true);
	});
});
