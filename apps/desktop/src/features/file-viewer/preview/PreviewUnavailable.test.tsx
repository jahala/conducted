/**
 * @feature REV-08 Preview unavailable
 * Tests the notice's actions.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewUnavailable } from "./PreviewUnavailable.tsx";

afterEach(cleanup);

describe("REV-08 PreviewUnavailable", () => {
	it("shows a Retry button only when a retry handler is given", () => {
		const onRetry = vi.fn();
		const { rerender } = render(
			<PreviewUnavailable fileName="a.png" sizeBytes={2048} reason="Failed to load image." />,
		);
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

		rerender(
			<PreviewUnavailable
				fileName="a.png"
				sizeBytes={2048}
				reason="Failed to load image."
				onRetry={onRetry}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("names the file type and size and offers the other apps", () => {
		const onOpenExternally = vi.fn();
		const onReveal = vi.fn();
		render(
			<PreviewUnavailable
				fileName="a.pdf"
				sizeBytes={2048}
				reason="Failed to load PDF."
				onOpenExternally={onOpenExternally}
				onReveal={onReveal}
			/>,
		);
		expect(screen.getByText(/PDF · 2.0 KB/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open in another app" }));
		fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
		expect(onOpenExternally).toHaveBeenCalledTimes(1);
		expect(onReveal).toHaveBeenCalledTimes(1);
	});
});
