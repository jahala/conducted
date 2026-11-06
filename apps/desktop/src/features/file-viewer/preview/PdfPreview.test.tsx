/**
 * @feature REV-08 PDF preview
 * Tests that a damaged PDF reaches the error card.
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
		expect(screen.getByText("Preview not available")).toBeTruthy();
		expect(screen.getByText(/Failed to load PDF/)).toBeTruthy();
	});
});
