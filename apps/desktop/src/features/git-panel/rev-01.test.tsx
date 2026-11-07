import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShortcutOverrides } from "../../core/registries/commands.ts";
import type { GitHeader as GitHeaderModel } from "../../core/status/git-header.ts";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	GitMergeIcon,
	GitPullRequestArrowIcon,
	MessageSquareIcon,
} from "../../ui/icons.tsx";
import { GitHeader } from "./GitHeader.tsx";
import { GitPanelTabs } from "./GitPanelTabs.tsx";
import { ReviewButton } from "./ReviewButton.tsx";
import { ReviewPromptDialog } from "./ReviewPromptDialog.tsx";

const keys = vi.hoisted(() => ({ overrides: {} as Record<string, readonly string[]> }));

vi.mock("../../core/hooks.ts", async () => {
	const registry = await import("../../core/registries/commands.ts");
	return {
		useLiveShortcut: (commandId: string) =>
			registry.liveShortcut(commandId, keys.overrides as ShortcutOverrides),
	};
});

afterEach(() => {
	cleanup();
	keys.overrides = {};
});

const mergeModel: GitHeaderModel = {
	kind: "ready_to_merge",
	title: "Ready to merge",
	tone: "success",
	action: { id: "merge", label: "Merge" },
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

	// Conductor names the shortcut in the button's tooltip, not on the button (renderApp r9t, Tje).
	it("shows the user's own key binding in the button's tooltip", async () => {
		keys.overrides = { "pr.merge": ["Cmd+Shift+K"] };
		render(<GitHeader model={mergeModel} onAction={vi.fn()} />);
		const button = screen.getByRole("button", { name: /Merge/ });
		expect(button.textContent).toBe("Merge");
		fireEvent.focus(button);
		const tooltip = await screen.findByRole("tooltip");
		expect(tooltip.textContent).toContain("K");
		expect(tooltip.textContent).not.toContain("M⌘");
		expect(tooltip.textContent).not.toMatch(/⇧⌘M/);
	});

	// Conductor's header buttons each lead with a 12 px icon (renderApp r9t @2219500): the pull
	// request arrow for the agent's and the pull request's actions, arrows for pull and push, a
	// speech bubble for comments and the merge mark for auto-merge.
	it.each([
		["commit_and_push", "Commit and push", GitPullRequestArrowIcon],
		["pull", "Pull", ArrowDownIcon],
		["push", "Push", ArrowUpIcon],
		["resolve", "Resolve", GitPullRequestArrowIcon],
		["resolve_incompatible", "Resolve", GitPullRequestArrowIcon],
		["add_comments_to_chat", "Add all comments to chat", MessageSquareIcon],
		["ready_for_review", "Ready for review", GitPullRequestArrowIcon],
		["fix_errors", "Fix errors", GitPullRequestArrowIcon],
		["toggle_automerge", "Automerge", GitMergeIcon],
		["approve", "Approve PR", GitPullRequestArrowIcon],
		["merge", "Merge", GitPullRequestArrowIcon],
		["merge_stack", "Merge stack", GitPullRequestArrowIcon],
	] as const)("leads the %s button with Conductor's icon", (id, label, Icon) => {
		const model: GitHeaderModel = {
			kind: "ready_to_merge",
			title: "Ready to merge",
			tone: "success",
			action: { id, label },
		};
		render(<GitHeader model={model} onAction={vi.fn()} />);
		const button = screen.getByRole("button", { name: new RegExp(label) });
		const expected = render(<Icon />)
			.container.querySelector("path")
			?.getAttribute("d");
		expect(expected).toBeTruthy();
		expect(button.querySelector("svg path")?.getAttribute("d")).toBe(expected);
	});

	// Conductor's tooltips: the label and the shortcut for Commit and push and Fix errors; for
	// Merge, the merge method or the stack line, then the shortcut. Pull and Push have none.
	it.each([
		["commit_and_push", "Commit and push", undefined, "Commit and push"],
		["fix_errors", "Fix errors", undefined, "Fix errors"],
		["merge", "Merge", "Squash and merge", "Squash and merge"],
		["merge", "Merge", undefined, "Merge"],
	] as const)("gives %s the tooltip %s", async (id, label, tooltip, expected) => {
		const model: GitHeaderModel = {
			kind: "ready_to_merge",
			title: "Ready to merge",
			tone: "success",
			action: { id, label, ...(tooltip === undefined ? {} : { tooltip }) },
		};
		render(<GitHeader model={model} onAction={vi.fn()} />);
		fireEvent.focus(screen.getByRole("button", { name: label }));
		const shown = await screen.findByRole("tooltip");
		expect(shown.textContent).toContain(expected);
		// Each of these actions has a default shortcut, shown as key caps after the words.
		expect(shown.querySelector("kbd")).not.toBeNull();
	});

	it("gives Pull no tooltip", () => {
		const model: GitHeaderModel = {
			kind: "behind",
			title: "Behind by 1 commit",
			tone: "attention",
			action: { id: "pull", label: "Pull" },
		};
		render(<GitHeader model={model} onAction={vi.fn()} />);
		const button = screen.getByRole("button", { name: "Pull" });
		// A tooltip's trigger carries its open state; a button without a tooltip has none.
		expect(button.getAttribute("data-state")).toBeNull();
		fireEvent.focus(button);
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("shows the title once", () => {
		render(<GitHeader model={mergeModel} onAction={vi.fn()} />);
		expect(screen.getAllByText("Ready to merge")).toHaveLength(1);
	});

	it("lets the button be used again after a failed action", async () => {
		let fail: ((error: unknown) => void) | undefined;
		const onAction = vi.fn(
			() =>
				new Promise<void>((_resolve, reject) => {
					fail = reject;
				}),
		);
		render(<GitHeader model={mergeModel} onAction={onAction} />);
		const button = screen.getByRole("button", { name: /Merge/ });
		fireEvent.click(button);
		expect(onAction).toHaveBeenCalledTimes(1);
		fail?.(new Error("push failed"));
		await waitFor(() => expect(button.getAttribute("disabled")).toBeNull());
		fireEvent.click(button);
		expect(onAction).toHaveBeenCalledTimes(2);
	});

	// This test showed "Waiting for a reviewer" in place of Approve. Conductor shows nothing there, so
	// a viewer who cannot approve gets no action (D098).
	it("shows no note and no button when there is no action", () => {
		const model: GitHeaderModel = {
			kind: "review_required",
			title: "PR review required",
			tone: "attention",
			action: null,
		};
		render(<GitHeader model={model} onAction={vi.fn()} />);
		expect(screen.queryByText("Waiting for a reviewer")).toBeNull();
		expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
	});

	it("opens the PR status details from the chip", async () => {
		render(<GitHeader model={mergeModel} onAction={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "View PR status" }));
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
		fireEvent.mouseDown(screen.getByRole("tab", { name: "Checks" }), { button: 0 });
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
