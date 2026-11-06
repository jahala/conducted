import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequest } from "../../core/model.ts";
import { GITHUB_HEAD_MISMATCH_MESSAGE } from "../../core/services/github.ts";
import { PrMergeBar } from "./PrMergeBar.tsx";

afterEach(cleanup);

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
	number: 12,
	url: "https://github.com/me/project/pull/12",
	title: "A change",
	body: "",
	state: "open",
	mergeable: "mergeable",
	reviewDecision: null,
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

describe("PR-07 PrMergeBar", () => {
	it("shows the head mismatch explanation and offers no merge to retry", () => {
		const onMerge = vi.fn();
		render(
			<PrMergeBar
				pullRequest={pullRequest()}
				blockedReason={GITHUB_HEAD_MISMATCH_MESSAGE}
				busy={null}
				archiveOnMerge={false}
				onMerge={onMerge}
				onMarkReady={vi.fn()}
				onSetAutoMerge={vi.fn()}
			/>,
		);

		expect(screen.getByRole("alert").textContent).toContain(
			"different from the pull request's head",
		);
		expect(screen.queryByRole("button", { name: "Squash and merge" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Enable auto-merge" })).toBeNull();
		expect(onMerge).not.toHaveBeenCalled();
	});

	it("offers Mark ready for a draft and no merge", () => {
		render(
			<PrMergeBar
				pullRequest={pullRequest({ state: "draft" })}
				blockedReason={null}
				busy={null}
				archiveOnMerge={false}
				onMerge={vi.fn()}
				onMarkReady={vi.fn()}
				onSetAutoMerge={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "Mark ready" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Squash and merge" })).toBeNull();
	});
});
