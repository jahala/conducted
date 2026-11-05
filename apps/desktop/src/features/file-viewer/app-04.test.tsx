import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTabState } from "./FileTabState.tsx";

afterEach(cleanup);

describe("APP-04 FileTabState", () => {
	it("offers to unarchive a file in an archived workspace", () => {
		const onAction = vi.fn();
		render(<FileTabState kind="archived" detail={null} onAction={onAction} />);
		expect(screen.getByText(/Unarchive this workspace to view files/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("announces loading with hidden skeleton blocks", () => {
		const { container } = render(<FileTabState kind="loading" detail={null} onAction={() => {}} />);
		expect(screen.getByRole("status", { name: "Loading file" })).toBeTruthy();
		expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
	});

	it("shows the error detail and offers a retry", () => {
		const onAction = vi.fn();
		render(<FileTabState kind="error" detail="Permission denied" onAction={onAction} />);
		expect(screen.getByRole("heading", { name: "Couldn't load this file" })).toBeTruthy();
		expect(screen.getByText("Permission denied")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("offers to open a file that is too large in another app", () => {
		const onAction = vi.fn();
		render(<FileTabState kind="too_large" detail={null} onAction={onAction} />);
		fireEvent.click(screen.getByRole("button", { name: "Open in another app" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});
});
