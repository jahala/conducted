/**
 * @feature PR-07 PR review section
 * Owns: tests of the PR tab's Review block: the author cannot approve, Approve, an approved pull
 * request, no review required, asking for and removing reviewers, and a request with no login.
 * Behaviour: ui-map.md 3.2 and 3.6; services-map.md 3.7.5.
 * Test first: when viewerDidAuthor is true there is no Approve button.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequest } from "../../core/model.ts";
import { PrReviewSection } from "./PrReviewSection.tsx";

afterEach(cleanup);

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
	number: 12,
	url: "https://github.com/me/project/pull/12",
	title: "A change",
	body: "",
	state: "open",
	mergeable: "mergeable",
	reviewDecision: "review_required",
	checks: [],
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: "octocat",
	viewerDidAuthor: false,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
	...overrides,
});

describe("PR-07 PrReviewSection", () => {
	it("has no Approve button when the viewer opened the pull request", () => {
		render(
			<PrReviewSection
				pullRequest={pullRequest({ viewerDidAuthor: true })}
				approveBusy={false}
				onApprove={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
		expect(
			screen.getByText("You opened this pull request, so you cannot approve it."),
		).toBeTruthy();
	});

	it("approves when the viewer may review", () => {
		const onApprove = vi.fn();
		render(
			<PrReviewSection
				pullRequest={pullRequest({ viewerDidAuthor: false })}
				approveBusy={false}
				onApprove={onApprove}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		expect(onApprove).toHaveBeenCalledTimes(1);
	});

	it("asks for and removes reviewers", () => {
		const onRequestReview = vi.fn();
		const onRemoveReview = vi.fn();
		render(
			<PrReviewSection
				pullRequest={pullRequest({
					reviewers: [{ login: "hubot", avatarUrl: null, state: "awaiting" }],
				})}
				approveBusy={false}
				onApprove={vi.fn()}
				onRequestReview={onRequestReview}
				onRemoveReview={onRemoveReview}
			/>,
		);

		fireEvent.change(screen.getByRole("textbox", { name: "Reviewer" }), {
			target: { value: "octocat" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Request review" }));
		expect(onRequestReview).toHaveBeenCalledWith("octocat");

		fireEvent.click(screen.getByRole("button", { name: "Remove hubot" }));
		expect(onRemoveReview).toHaveBeenCalledWith("hubot");
	});

	it("offers no Approve on an approved pull request and says it is approved", () => {
		render(
			<PrReviewSection
				pullRequest={pullRequest({ reviewDecision: "approved" })}
				approveBusy={false}
				onApprove={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
		expect(screen.getByText("This pull request is approved.")).toBeTruthy();
	});

	it("says no review is required when GitHub reports no review decision", () => {
		render(
			<PrReviewSection
				pullRequest={pullRequest({ reviewDecision: null })}
				approveBusy={false}
				onApprove={vi.fn()}
			/>,
		);

		expect(screen.getByText("No review required.")).toBeTruthy();
	});

	it("asks for nobody when no login is typed", () => {
		const onRequestReview = vi.fn();
		render(
			<PrReviewSection
				pullRequest={pullRequest()}
				approveBusy={false}
				onApprove={vi.fn()}
				onRequestReview={onRequestReview}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Request review" }));
		const field = screen.getByRole("textbox", { name: "Reviewer" });
		fireEvent.change(field, { target: { value: "   " } });
		fireEvent.keyDown(field, { key: "Enter" });

		expect(onRequestReview).not.toHaveBeenCalled();
	});
});
