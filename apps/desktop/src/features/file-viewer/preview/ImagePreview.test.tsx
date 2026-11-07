/**
 * @feature REV-08 Image preview
 * Tests the zoom controls, the error card, Retry, and a new URL clearing an earlier failure.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ImagePreview } from "./ImagePreview.tsx";

afterEach(cleanup);

describe("REV-08 ImagePreview", () => {
	it("shows the error card with the file name when the image fails to load", () => {
		const { container } = render(<ImagePreview url="broken.png" fileName="diagram.png" />);
		const image = container.querySelector("img");
		expect(image).not.toBeNull();
		if (image !== null) fireEvent.error(image);
		expect(screen.getByText("Preview unavailable. Open the file to try again.")).toBeTruthy();
		expect(screen.getByText(/Failed to load image/)).toBeTruthy();
		expect(screen.getByText(/diagram.png/)).toBeTruthy();
	});

	it("zooms in and out with the toolbar", () => {
		render(<ImagePreview url="a.png" fileName="a.png" />);
		expect(screen.getByText("100%")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
		expect(screen.getByText("150%")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
		expect(screen.getByText("100%")).toBeTruthy();
	});

	it("loads again when the URL changes after a failure", () => {
		const { container, rerender } = render(<ImagePreview url="a.png?v=1" fileName="a.png" />);
		const image = container.querySelector("img");
		if (image !== null) fireEvent.error(image);
		expect(screen.getByText("Preview unavailable. Open the file to try again.")).toBeTruthy();

		rerender(<ImagePreview url="a.png?v=2" fileName="a.png" />);

		expect(screen.queryByText("Preview unavailable. Open the file to try again.")).toBeNull();
		expect(container.querySelector("img")?.getAttribute("src")).toBe("a.png?v=2");
	});

	it("tries the same image again with Retry", () => {
		const { container } = render(<ImagePreview url="a.png" fileName="a.png" />);
		const image = container.querySelector("img");
		if (image !== null) fireEvent.error(image);

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		expect(screen.queryByText("Preview unavailable. Open the file to try again.")).toBeNull();
		expect(container.querySelector("img")?.getAttribute("src")).toBe("a.png");
	});
});
