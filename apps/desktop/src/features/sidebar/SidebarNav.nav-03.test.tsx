import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { SidebarNav } from "./SidebarNav.tsx";

const settings = vi.hoisted(() => ({ dashboard: false }));

vi.mock("../../core/hooks.ts", () => ({
	useSetting: () => settings.dashboard,
	useLiveShortcut: (commandId: string) =>
		commandId === "nav.home"
			? "⌘⇧H"
			: commandId === "workspace.create"
				? "⌘N"
				: commandId === "app.commandPalette"
					? "⌘K"
					: null,
}));

afterEach(() => {
	cleanup();
	useOverlayStore.setState({ open: null });
	settings.dashboard = false;
});

describe("NAV-03 SidebarNav", () => {
	it("links to Home and Create and opens the palette from Search", async () => {
		renderWithRouter(<SidebarNav />);
		const home = await screen.findByRole("link", { name: /Home/ });
		expect(home.getAttribute("href")).toBe("/all-workspaces");
		const create = screen.getByRole("link", { name: /Create/ });
		expect(create.getAttribute("href")).toBe("/create");
		fireEvent.click(screen.getByRole("button", { name: /Search/ }));
		expect(useOverlayStore.getState().open).toBe("palette");
	});

	it("shows the Dashboard row only when its setting is on", async () => {
		const { unmount } = renderWithRouter(<SidebarNav />);
		expect(await screen.findByRole("link", { name: /Home/ })).toBeTruthy();
		expect(screen.queryByRole("link", { name: /Dashboard/ })).toBeNull();
		unmount();
		settings.dashboard = true;
		renderWithRouter(<SidebarNav />);
		const dashboard = await screen.findByRole("link", { name: /Dashboard/ });
		expect(dashboard.getAttribute("href")).toBe("/dashboard");
	});

	it("shows the live shortcut hints", async () => {
		renderWithRouter(<SidebarNav />);
		expect(await screen.findByText("⌘⇧H")).toBeTruthy();
		expect(screen.getByText("⌘N")).toBeTruthy();
		expect(screen.getByText("⌘K")).toBeTruthy();
	});
});
