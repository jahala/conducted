import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHeader as GitHeaderModel } from "../../core/status/git-header.ts";
import "../../test/dom-polyfills.ts";
import { GitHeader } from "./GitHeader.tsx";
import { GitPanelTabs } from "./GitPanelTabs.tsx";
import { ReviewButton } from "./ReviewButton.tsx";
import { ReviewPromptDialog } from "./ReviewPromptDialog.tsx";

afterEach(cleanup);

const mergeModel: GitHeaderModel = {
	kind: "ready_to_merge",
	title: "Ready to merge",
	tone: "success",
	action: { id: "merge", label: "Merge", waitingNote: null },
};

describe("REV-01 git header", () => {
	it("renders a Merge button and runs it once while busy", () => {
		const onAction = vi.fn();
		render(<GitHeader model={mergeModel} onAction={onAction} />);
		const button = screen.getByRole("button", { name: /Merge/ });
		fireEvent.click(button);
		fireEvent.click(button);
		expect(onAction).toHaveBeenCalledTimes(1);
		expect(onAction).toHaveBeenCalledWith("merge");
	});

	it("shows a waiting note instead of a button", () => {
		const model: GitHeaderModel = {
			kind: "review_required",
			title: "PR review required",
			tone: "attention",
			action: {
				id: "approve",
				label: "Approve",
				waitingNote: "Waiting for a reviewer",
			},
		};
		render(<GitHeader model={model} onAction={vi.fn()} />);
		expect(screen.getByText("Waiting for a reviewer")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
	});

	it("opens the PR status details from the chip", async () => {
		render(<GitHeader model={mergeModel} onAction={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "PR status details" }));
		expect(await screen.findByRole("group", { name: "PR status details" })).toBeTruthy();
	});
});

describe("REV-01 git panel tab strip", () => {
	it("shows the changed count badge and caps it at 99+", () => {
		const { rerender } = render(
			<GitPanelTabs
				active="changes"
				onSelect={vi.fn()}
				changedCount={3}
				checksFailing={false}
				reviewDisabled={false}
				onReview={vi.fn()}
				onReviewWithEdit={vi.fn()}
			/>,
		);
		expect(screen.getByRole("tab", { name: /Changes/ }).textContent).toContain("3");
		rerender(
			<GitPanelTabs
				active="changes"
				onSelect={vi.fn()}
				changedCount={120}
				checksFailing
				reviewDisabled={false}
				onReview={vi.fn()}
				onReviewWithEdit={vi.fn()}
			/>,
		);
		expect(screen.getByRole("tab", { name: /Changes/ }).textContent).toContain("99+");
		expect(screen.getByRole("img", { name: "A check failed" })).toBeTruthy();
	});

	it("selects a tab", () => {
		const onSelect = vi.fn();
		render(
			<GitPanelTabs
				active="changes"
				onSelect={onSelect}
				changedCount={0}
				checksFailing={false}
				reviewDisabled
				onReview={vi.fn()}
				onReviewWithEdit={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("tab", { name: "Checks" }));
		expect(onSelect).toHaveBeenCalledWith("checks");
	});
});

describe("REV-01 review button", () => {
	it("starts a review from the main part", () => {
		const onReview = vi.fn();
		render(
			<ReviewButton
				disabled={false}
				disabledReason={null}
				onReview={onReview}
				onReviewWithEdit={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Review" }));
		expect(onReview).toHaveBeenCalledTimes(1);
	});

	it("opens the prompt editor from the menu without starting a review", async () => {
		const onReview = vi.fn();
		const onReviewWithEdit = vi.fn();
		render(
			<ReviewButton
				disabled={false}
				disabledReason={null}
				onReview={onReview}
				onReviewWithEdit={onReviewWithEdit}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Review options" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Edit before sending" }));
		expect(onReviewWithEdit).toHaveBeenCalledTimes(1);
		expect(onReview).not.toHaveBeenCalled();
	});
});

describe("REV-01 review prompt dialog", () => {
	it("sends the typed instructions", () => {
		const onSend = vi.fn();
		render(<ReviewPromptDialog open onOpenChange={vi.fn()} onSend={onSend} />);
		fireEvent.change(screen.getByLabelText("Extra instructions"), {
			target: { value: "Check the error handling" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(onSend).toHaveBeenCalledWith("Check the error handling");
	});

	it("sends null when the box is empty", () => {
		const onSend = vi.fn();
		render(<ReviewPromptDialog open onOpenChange={vi.fn()} onSend={onSend} />);
		fireEvent.click(screen.getByRole("button", { name: "Send" }));
		expect(onSend).toHaveBeenCalledWith(null);
	});
});
