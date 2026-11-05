import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../test/dom-polyfills.ts";
import { EmptyState } from "./EmptyState.tsx";
import { Skeleton } from "./Skeleton.tsx";

afterEach(cleanup);

describe("APP-04 EmptyState", () => {
	it("renders the title, the body and the action", () => {
		render(
			<EmptyState
				title="No projects yet"
				body="Add a project to get started."
				action={<button type="button">Add a project</button>}
			/>,
		);
		expect(screen.getByRole("heading", { name: "No projects yet" })).toBeTruthy();
		expect(screen.getByText("Add a project to get started.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add a project" })).toBeTruthy();
	});

	it("omits the body element when none is given", () => {
		const { container } = render(<EmptyState title="No projects yet" />);
		expect(container.querySelector("p")).toBeNull();
	});

	it("takes a failed tone and an optional icon", () => {
		const { container } = render(
			<EmptyState
				tone="failed"
				title="Couldn't load workspaces"
				icon={<span data-testid="state-icon" />}
			/>,
		);
		expect(container.querySelector("section")?.getAttribute("data-tone")).toBe("failed");
		expect(screen.getByTestId("state-icon")).toBeTruthy();
	});

	it("is neutral unless the caller says otherwise", () => {
		const { container } = render(<EmptyState title="No projects yet" />);
		expect(container.querySelector("section")?.getAttribute("data-tone")).toBe("neutral");
	});
});

describe("APP-04 Skeleton", () => {
	it("renders an aria-hidden block that stands in for content", () => {
		const { container } = render(<Skeleton className="h-8 w-full" />);
		const block = container.firstElementChild;
		expect(block?.getAttribute("aria-hidden")).toBe("true");
		expect(block?.className).toContain("h-8");
	});
});
