/**
 * @feature REV-08 PDF preview
 * Tests that a damaged PDF reaches the error card, with Retry, and that a new URL loads again.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PdfPreview } from "./PdfPreview.tsx";

afterEach(cleanup);

describe("REV-08 PdfPreview", () => {
	it("shows the error card when the PDF fails to load", () => {
		const { container } = render(<PdfPreview url="broken.pdf" fileName="manual.pdf" />);
		const object = container.querySelector("object");
		expect(object).not.toBeNull();
		if (object !== null) fireEvent.error(object);
		expect(container.querySelector("object")).toBeNull();
		expect(screen.getByText("Preview unavailable. Open the file to try again.")).toBeTruthy();
		expect(screen.getByText(/Failed to load PDF/)).toBeTruthy();
	});

	it("loads again when the URL changes after a failure, and offers Retry", () => {
		const { container, rerender } = render(<PdfPreview url="a.pdf?v=1" fileName="a.pdf" />);
		const object = container.querySelector("object");
		if (object !== null) fireEvent.error(object);
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

		rerender(<PdfPreview url="a.pdf?v=2" fileName="a.pdf" />);

		expect(container.querySelector("object")?.getAttribute("data")).toBe("a.pdf?v=2");
	});
});
