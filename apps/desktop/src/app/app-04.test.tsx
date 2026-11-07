import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test/render-with-router.tsx";
import { NoWorkspaceSelected } from "./NoWorkspaceSelected.tsx";
import { NotFoundScreen, RouteErrorScreen } from "./route-states.tsx";

vi.mock("../features/sidebar/AddProjectButton.tsx", () => ({
	AddProjectButton: () => <button type="button">Add a project</button>,
}));

afterEach(cleanup);

describe("APP-04 NoWorkspaceSelected", () => {
	it("shows the landing heading and a region for the add-project action", () => {
		const { container } = render(<NoWorkspaceSelected />);
		expect(screen.getByRole("heading", { name: "Run agents side by side" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add a project" })).toBeTruthy();
		expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
	});
});

describe("APP-04 route states", () => {
	it("titles the not-found screen Not Found", async () => {
		renderWithRouter(<NotFoundScreen />);
		expect(await screen.findByRole("heading", { name: "Not Found" })).toBeTruthy();
		expect(
			screen.getByText("The address may be old, or the workspace may have been removed."),
		).toBeTruthy();
	});

	it("offers a link to Home when the address matches no route", async () => {
		const { container } = renderWithRouter(<NotFoundScreen />);
		const link = await screen.findByRole("link", { name: "Go to Home" });
		expect(link.getAttribute("href")).toBe("/all-workspaces");
		expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
	});

	it("offers Home and a reload fallback when a route fails", async () => {
		const reset = vi.fn();
		const reload = vi.fn();
		renderWithRouter(
			<RouteErrorScreen
				error={new Error("The workspace could not load")}
				reset={reset}
				reload={reload}
			/>,
		);
		expect(await screen.findByRole("heading", { name: "Something went wrong!" })).toBeTruthy();
		const link = screen.getByRole("link", { name: "Go to Home" });
		expect(link.getAttribute("href")).toBe("/all-workspaces");
		fireEvent.click(screen.getByRole("button", { name: "Reload the app" }));
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("shows the plain error message and tries the route again", async () => {
		const reset = vi.fn();
		renderWithRouter(
			<RouteErrorScreen error={new Error("The workspace could not load")} reset={reset} />,
		);
		expect(await screen.findByRole("heading", { name: "Something went wrong!" })).toBeTruthy();
		expect(screen.getByText("The workspace could not load")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(reset).toHaveBeenCalledTimes(1);
	});
});
