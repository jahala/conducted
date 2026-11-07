/**
 * @feature REV-03 Discard comment dialog
 * Tests the two answers to "Discard comment?".
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscardCommentDialog } from "./DiscardCommentDialog.tsx";

afterEach(cleanup);

describe("REV-03 DiscardCommentDialog", () => {
	it("calls onDiscard once and not onKeep when Discard is pressed", () => {
		const onDiscard = vi.fn();
		const onKeep = vi.fn();
		render(<DiscardCommentDialog open onDiscard={onDiscard} onKeep={onKeep} />);

		fireEvent.click(screen.getByRole("button", { name: "Discard" }));

		expect(onDiscard).toHaveBeenCalledTimes(1);
		expect(onKeep).not.toHaveBeenCalled();
	});

	it("calls onKeep when Keep editing is pressed", () => {
		const onDiscard = vi.fn();
		const onKeep = vi.fn();
		render(<DiscardCommentDialog open onDiscard={onDiscard} onKeep={onKeep} />);

		fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

		expect(onKeep).toHaveBeenCalledTimes(1);
		expect(onDiscard).not.toHaveBeenCalled();
	});
});
