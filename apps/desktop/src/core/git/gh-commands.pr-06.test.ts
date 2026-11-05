/**
 * @feature PR-06 Merge, auto-merge, ready for review, approve
 * Owns: the gh argument lists the pull request write actions send.
 * Behaviour: services-map.md 3.7.5 (merge pinned to the local HEAD, auto-merge, ready, edit,
 * reviewers, approve pinned to the head commit) and 3.16 (the pins).
 * Test first: prEdit adds each reviewer with its own --add-reviewer flag.
 */
import { describe, expect, it } from "vitest";
import * as gh from "./gh-commands.ts";

describe("PR-06 gh write commands", () => {
	it("pins an auto-merge to the local head commit", () => {
		expect(gh.prMerge(12, "squash", "abc123", true).args).toEqual([
			"pr",
			"merge",
			"12",
			"--squash",
			"--auto",
			"--match-head-commit",
			"abc123",
		]);
	});

	it("disables auto-merge with --disable-auto", () => {
		expect(gh.prMergeDisableAuto(12).args).toEqual(["pr", "merge", "12", "--disable-auto"]);
	});

	it("marks a pull request ready", () => {
		expect(gh.prReady(12).args).toEqual(["pr", "ready", "12"]);
	});

	it("reads the pull request's head commit for an approval", () => {
		expect(gh.prViewHeadCommit(12).args).toEqual([
			"pr",
			"view",
			"12",
			"--json",
			"headRefOid",
			"--jq",
			".headRefOid",
		]);
	});

	it("adds each reviewer with its own flag and removes one the same way", () => {
		expect(gh.prEdit(12, { addReviewers: ["octocat", "hubot"] }).args).toEqual([
			"pr",
			"edit",
			"12",
			"--add-reviewer",
			"octocat",
			"--add-reviewer",
			"hubot",
		]);
		expect(gh.prEdit(12, { removeReviewers: ["hubot"] }).args).toEqual([
			"pr",
			"edit",
			"12",
			"--remove-reviewer",
			"hubot",
		]);
	});

	it("keeps the approval pinned to the given commit id", () => {
		expect(gh.prApprove(12, "deadbeef").args).toContain("commit_id=deadbeef");
	});
});
