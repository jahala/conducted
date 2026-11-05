import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test/dom-polyfills.ts";
import { renderWithRouter } from "../test/render-with-router.tsx";
import { NoWorkspaceSelected } from "./NoWorkspaceSelected.tsx";
import { NotFoundScreen, RouteErrorScreen } from "./route-states.tsx";

vi.mock("../features/sidebar/AddProjectButton.tsx", () => ({
	AddProjectButton: () => <button type="button">Add a project</button>,
}));

afterEach(cleanup);

describe("APP-04 NoWorkspaceSelected", () => {
	it("shows the landing heading and a region for the add-project action", () => {
		render(<NoWorkspaceSelected />);
		expect(screen.getByRole("heading", { name: "Run agents side by side" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add a project" })).toBeTruthy();
	});
});

describe("APP-04 route states", () => {
	it("offers a link to Home when the address matches no route", async () => {
		renderWithRouter(<NotFoundScreen />);
		const link = await screen.findByRole("link", { name: "Go to Home" });
		expect(link.getAttribute("href")).toBe("/all-workspaces");
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
