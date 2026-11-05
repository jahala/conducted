import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrEmptyState } from "./PrEmptyState.tsx";

afterEach(cleanup);

describe("APP-04 PrEmptyState", () => {
	it("offers Create PR when there is no pull request yet", () => {
		const onAction = vi.fn();
		render(<PrEmptyState kind="no_pr" onAction={onAction} />);
		fireEvent.click(screen.getByRole("button", { name: "Create PR" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("announces that PR info is loading", () => {
		render(<PrEmptyState kind="loading" onAction={() => {}} />);
		expect(screen.getByRole("status", { name: "Loading PR info" })).toBeTruthy();
	});

	it("offers a retry when the network is down", () => {
		const onAction = vi.fn();
		render(<PrEmptyState kind="offline" onAction={onAction} />);
		expect(screen.getByRole("heading", { name: "No internet connection" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("sends the user to GitHub sign-in when access is missing", () => {
		const onAction = vi.fn();
		render(<PrEmptyState kind="no_github_access" onAction={onAction} />);
		fireEvent.click(screen.getByRole("button", { name: "Open GitHub sign-in" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("explains that a GitHub remote is needed", () => {
		render(<PrEmptyState kind="not_github" onAction={() => {}} />);
		expect(screen.getByRole("heading", { name: "No GitHub remote" })).toBeTruthy();
	});

	it("offers a retry when PR info is unavailable", () => {
		const onAction = vi.fn();
		render(<PrEmptyState kind="unavailable" onAction={onAction} />);
		expect(screen.getByRole("heading", { name: "PR info unavailable" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});
});
