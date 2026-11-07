import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequest } from "../../../core/model.ts";
import "../../../test/dom-polyfills.ts";
import { PrSummaryHeader } from "./PrSummaryHeader.tsx";

afterEach(cleanup);

const pullRequest = (over: Partial<PullRequest> = {}): PullRequest => ({
	number: 12,
	url: "https://github.com/o/r/pull/12",
	title: "Add the checks tab",
	body: "",
	state: "draft",
	mergeable: "unknown",
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
	...over,
});

describe("PR-04 PR summary header", () => {
	it("renders the Draft badge and the number for a draft PR", () => {
		render(
			<PrSummaryHeader
				pullRequest={pullRequest()}
				branch="feat/checks"
				onOpenOnGithub={vi.fn()}
				onCopy={vi.fn()}
			/>,
		);
		expect(screen.getByText("#12")).toBeTruthy();
		expect(screen.getByText("Draft")).toBeTruthy();
		// The inline editor above the header shows the title; the header does not repeat it.
		expect(screen.queryByText("Add the checks tab")).toBeNull();
	});

	it("copies the link and the number from the header menu", async () => {
		const onCopy = vi.fn();
		render(
			<PrSummaryHeader
				pullRequest={pullRequest()}
				branch="feat/checks"
				onOpenOnGithub={vi.fn()}
				onCopy={onCopy}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Pull request menu" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
		expect(onCopy).toHaveBeenCalledWith("https://github.com/o/r/pull/12");

		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy number" }));
		expect(onCopy).toHaveBeenCalledWith("12");
	});

	it("offers Create PR when there is no pull request", () => {
		const onOpen = vi.fn();
		render(
			<PrSummaryHeader
				pullRequest={null}
				branch="feat/checks"
				onOpenOnGithub={onOpen}
				onCopy={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Create PR" }));
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(screen.getByText("feat/checks")).toBeTruthy();
	});
});
