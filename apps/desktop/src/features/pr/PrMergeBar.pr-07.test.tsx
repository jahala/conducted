/**
 * @feature PR-07 PR merge bar
 * Owns: tests of the PR tab's Merge block: a head mismatch, a draft, conflicts, failing checks
 * (and an optional one that only blocks when the setting says so), the merge queue, a merge in
 * flight, auto-merge, and merged or closed pull requests.
 * Behaviour: ui-map.md 3.2 and 3.6; services-map.md 3.7.5.
 * Test first: with a head mismatch error the bar shows the explanation and does not retry.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_HEAD_MISMATCH_MESSAGE } from "../../core/github-text.ts";
import type { CheckRun, PullRequest } from "../../core/model.ts";
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

const check = (name: string, state: CheckRun["state"], required: boolean): CheckRun => ({
	name,
	state,
	url: null,
	startedAt: null,
	completedAt: null,
	required,
});

function renderBar(
	props: Partial<Parameters<typeof PrMergeBar>[0]> & { pullRequest: PullRequest },
) {
	const handlers = { onMerge: vi.fn(), onMarkReady: vi.fn(), onSetAutoMerge: vi.fn() };
	render(
		<PrMergeBar
			blockedReason={null}
			busy={null}
			treatOptionalAsBlocking={false}
			{...handlers}
			{...props}
		/>,
	);
	return handlers;
}

const mergeButton = () => screen.queryByRole("button", { name: "Squash and merge" });

describe("PR-07 PrMergeBar", () => {
	it("shows the head mismatch explanation and offers no merge to retry", () => {
		const onMerge = vi.fn();
		render(
			<PrMergeBar
				pullRequest={pullRequest()}
				blockedReason={GITHUB_HEAD_MISMATCH_MESSAGE}
				busy={null}
				treatOptionalAsBlocking={false}
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
				treatOptionalAsBlocking={false}
				onMerge={vi.fn()}
				onMarkReady={vi.fn()}
				onSetAutoMerge={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "Mark ready" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Squash and merge" })).toBeNull();
	});

	it("merges with the repository's merge method when nothing blocks it", () => {
		const handlers = renderBar({ pullRequest: pullRequest() });

		fireEvent.click(mergeButton() as HTMLElement);

		expect(handlers.onMerge).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Enable auto-merge" })).toBeTruthy();
	});

	it("explains conflicts and offers no merge", () => {
		renderBar({ pullRequest: pullRequest({ mergeable: "conflicting" }) });

		expect(
			screen.getByText("This branch has conflicts that must be resolved before merging."),
		).toBeTruthy();
		expect(mergeButton()).toBeNull();
	});

	it("counts the failing checks that block a merge and offers no merge", () => {
		renderBar({
			pullRequest: pullRequest({
				checks: [check("build", "failure", true), check("lint", "failure", true)],
			}),
		});

		expect(screen.getByText("2 checks failed. Fix them before merging.")).toBeTruthy();
		expect(mergeButton()).toBeNull();
	});

	it("lets an optional failing check through unless the setting treats it as blocking", () => {
		const optional = pullRequest({
			checks: [check("build", "success", true), check("preview", "failure", false)],
		});
		renderBar({ pullRequest: optional });
		expect(mergeButton()).toBeTruthy();
		expect(screen.queryByText(/checks failed/)).toBeNull();
		cleanup();

		renderBar({ pullRequest: optional, treatOptionalAsBlocking: true });
		expect(mergeButton()).toBeNull();
		expect(screen.getByText("1 check failed. Fix it before merging.")).toBeTruthy();
	});

	it("says a pull request in the merge queue is there and offers no merge", () => {
		renderBar({ pullRequest: pullRequest({ inMergeQueue: true }) });

		expect(screen.getByText("This pull request is in the merge queue.")).toBeTruthy();
		expect(mergeButton()).toBeNull();
	});

	it("disables Merge while a merge is on its way, so a second click does nothing", () => {
		const handlers = renderBar({ pullRequest: pullRequest(), busy: "merge" });

		const button = mergeButton() as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.click(button);
		expect(handlers.onMerge).not.toHaveBeenCalled();
	});

	it("turns auto-merge off when it is on", () => {
		const handlers = renderBar({ pullRequest: pullRequest({ autoMergeEnabled: true }) });

		fireEvent.click(screen.getByRole("button", { name: "Disable auto-merge" }));

		expect(handlers.onSetAutoMerge).toHaveBeenCalledWith(false);
	});

	it("shows a merged pull request with no actions", () => {
		renderBar({ pullRequest: pullRequest({ state: "merged" }) });

		expect(screen.getByText("This pull request has been merged.")).toBeTruthy();
		expect(screen.queryAllByRole("button")).toEqual([]);
	});
});
