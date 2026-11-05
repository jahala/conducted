/**
 * @feature RUN-03 Preview URL menu
 * Owns: tests for the split Open button and its list of preview URLs.
 * Test first: two sources giving the same URL show one entry.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewUrlMenu } from "./PreviewUrlMenu.tsx";

afterEach(cleanup);

const urls = [
	{ label: "Run output", url: "http://localhost:3000", source: "run_output" as const },
	{ label: "Port 3000", url: "http://localhost:3000", source: "detected_port" as const },
	{ label: "Preview URL", url: "http://localhost:55000", source: "template" as const },
];

describe("RUN-03 preview URL menu", () => {
	it("shows one entry when two sources give the same URL", async () => {
		render(<PreviewUrlMenu urls={urls} defaultUrl={null} onOpen={() => {}} />);

		fireEvent.keyDown(screen.getByRole("button", { name: "Choose preview URL" }), {
			key: "Enter",
		});

		expect(await screen.findByRole("menu")).toBeTruthy();
		expect(screen.getAllByRole("menuitem")).toHaveLength(2);
		expect(screen.getAllByText("Run output")).toHaveLength(1);
		expect(screen.queryByText("Port 3000")).toBeNull();
	});

	it("opens the first URL from the Open button when no default is chosen", () => {
		const onOpen = vi.fn();
		render(<PreviewUrlMenu urls={urls} defaultUrl={null} onOpen={onOpen} />);

		fireEvent.click(screen.getByRole("button", { name: "Open" }));

		expect(onOpen).toHaveBeenCalledWith("http://localhost:3000");
	});

	it("opens the chosen default instead of the first URL", () => {
		const onOpen = vi.fn();
		render(<PreviewUrlMenu urls={urls} defaultUrl="http://localhost:55000" onOpen={onOpen} />);

		fireEvent.click(screen.getByRole("button", { name: "Open" }));

		expect(onOpen).toHaveBeenCalledWith("http://localhost:55000");
	});

	it("disables Open and says why when there is no URL", () => {
		render(<PreviewUrlMenu urls={[]} defaultUrl={null} onOpen={() => {}} />);

		const open = screen.getByRole("button", { name: "Open" }) as HTMLButtonElement;
		expect(open.disabled).toBe(true);
		expect(open.title).toBe("No preview URL yet");
	});
});
