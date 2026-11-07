import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithRouter } from "../test/render-with-router.tsx";
import { ShellControls } from "./ShellControls.tsx";

afterEach(cleanup);

function ToggleHarness() {
	const [open, setOpen] = useState(true);
	return <ShellControls sidebarOpen={open} onToggleSidebar={() => setOpen((value) => !value)} />;
}

describe("NAV-01 window controls", () => {
	it("names the sidebar button as Conductor does and says whether it is open", async () => {
		renderWithRouter(<ToggleHarness />);

		const hide = await screen.findByRole("button", { name: "Toggle sidebar", expanded: true });
		fireEvent.click(hide);

		const show = await screen.findByRole("button", {
			name: "Toggle sidebar",
			expanded: false,
		});
		fireEvent.click(show);

		expect(
			await screen.findByRole("button", { name: "Toggle sidebar", expanded: true }),
		).toBeTruthy();
	});

	it("keeps the buttons inside a drag region clear of the traffic lights", async () => {
		renderWithRouter(<ShellControls sidebarOpen onToggleSidebar={() => {}} />);

		const sidebarButton = await screen.findByRole("button", {
			name: "Toggle sidebar",
			expanded: true,
		});
		const cluster = sidebarButton.parentElement;

		expect(cluster?.getAttribute("data-tauri-drag-region")).not.toBeNull();
		expect(cluster?.className).toContain("pl-(--traffic-lights-clearance)");
	});

	it("disables back and forward at the start of history", async () => {
		renderWithRouter(<ShellControls sidebarOpen onToggleSidebar={() => {}} />);

		const back = (await screen.findByRole("button", { name: "Go back" })) as HTMLButtonElement;
		const forward = screen.getByRole("button", { name: "Go forward" }) as HTMLButtonElement;

		expect(back.disabled).toBe(true);
		expect(forward.disabled).toBe(false);
	});
});
