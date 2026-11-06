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
});
