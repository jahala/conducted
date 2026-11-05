/**
 * @feature REV-02 Diff warnings
 * Tests the warning copy and the actions each warning offers.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { DiffWarning } from "./DiffWarnings.tsx";

afterEach(cleanup);

describe("REV-02 DiffWarning", () => {
	it("shows the whitespace notice and calls onAction", () => {
		const onAction = vi.fn();
		render(<DiffWarning kind="whitespace_only" onAction={onAction} onDismiss={() => {}} />);
		expect(screen.getByText("Only whitespace changes found")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Show whitespace changes" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("names the binary warning and offers no action", () => {
		render(<DiffWarning kind="binary" onAction={() => {}} onDismiss={() => {}} />);
		expect(screen.getByText("Binary file changed")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Render anyway" })).toBeNull();
	});

	it("offers to render a large file anyway", () => {
		const onAction = vi.fn();
		render(<DiffWarning kind="too_large" onAction={onAction} onDismiss={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "Render anyway" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("shows the updating notice without an action", () => {
		render(<DiffWarning kind="updating" onAction={() => {}} onDismiss={() => {}} />);
		expect(screen.getByText("Updating diff")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("offers a retry after a renderer failure", () => {
		const onAction = vi.fn();
		render(<DiffWarning kind="render_failed" onAction={onAction} onDismiss={() => {}} />);
		expect(screen.getByText("Failed to open editor")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("dismisses through the named control", () => {
		const onDismiss = vi.fn();
		render(<DiffWarning kind="binary" onAction={() => {}} onDismiss={onDismiss} />);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss diff rendering warning" }));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
