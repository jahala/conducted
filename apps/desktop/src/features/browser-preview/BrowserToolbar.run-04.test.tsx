/**
 * @feature RUN-04 Browser toolbar
 * Owns: tests for the address field, history buttons, reload and the open-in-browser action.
 * Test first: typing "localhost:3000/a" and pressing Enter calls onNavigate with its URL.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserToolbar } from "./BrowserToolbar.tsx";

afterEach(cleanup);

function renderToolbar(overrides: Partial<ComponentProps<typeof BrowserToolbar>> = {}) {
	const onNavigate = vi.fn();
	render(
		<BrowserToolbar
			url="http://localhost:3000"
			loading={false}
			canGoBack={false}
			canGoForward={false}
			workspacePort={3000}
			detectedPorts={[3000]}
			onNavigate={onNavigate}
			onBack={() => {}}
			onForward={() => {}}
			onReload={() => {}}
			onOpenExternally={() => {}}
			{...overrides}
		/>,
	);
	return { onNavigate };
}

describe("RUN-04 browser toolbar", () => {
	it("typing localhost:3000/a and pressing Enter calls onNavigate with its URL", () => {
		const { onNavigate } = renderToolbar();

		const address = screen.getByLabelText("Address");
		fireEvent.change(address, { target: { value: "localhost:3000/a" } });
		fireEvent.keyDown(address, { key: "Enter" });

		expect(onNavigate).toHaveBeenCalledWith("http://localhost:3000/a");
	});

	it("shows an error and does not navigate for an address that is not a URL", () => {
		const { onNavigate } = renderToolbar();

		const address = screen.getByLabelText("Address");
		fireEvent.change(address, { target: { value: "http://[" } });
		fireEvent.keyDown(address, { key: "Enter" });

		expect(screen.getByText("Enter a web address.")).toBeTruthy();
		expect(onNavigate).not.toHaveBeenCalled();
	});

	it("disables back and forward when there is no history", () => {
		renderToolbar();

		expect(screen.getByRole("button", { name: "Back" })).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "Forward" })).toHaveProperty("disabled", true);
	});

	it("reports its loading state on the reload button", () => {
		renderToolbar({ loading: true });

		expect(screen.getByRole("button", { name: "Reload" }).getAttribute("aria-busy")).toBe("true");
	});

	it("calls the reload action", () => {
		const onReload = vi.fn();
		renderToolbar({ onReload });

		fireEvent.click(screen.getByRole("button", { name: "Reload" }));

		expect(onReload).toHaveBeenCalledOnce();
	});

	it("calls the open-in-browser action", () => {
		const onOpenExternally = vi.fn();
		renderToolbar({ onOpenExternally });

		fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));

		expect(onOpenExternally).toHaveBeenCalledOnce();
	});
});
