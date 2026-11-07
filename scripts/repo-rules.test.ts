/**
 * @feature PLAT-40 Branch protection on main: pull requests only, CI must pass
 * Owns: the failing cases of the branch rule's comparison and the body `--apply` writes.
 * Behaviour: docs/plans/release-pipeline.md item 4.
 * Test first: names a missing pull request rule, names a missing required check, and passes when
 * every rule is set.
 */
import { describe, expect, test } from "bun:test";
import { applyBody, protectionProblems, RULE } from "./repo-rules.ts";

/** A protection answer with every part of the rule set, for one test to break in one place. */
const protectedBranch = () => ({
	required_pull_request_reviews: { required_approving_review_count: 0 },
	required_status_checks: {
		strict: false,
		contexts: [] as string[],
		checks: [{ context: "typescript" }, { context: "rust" }, { context: "harness" }],
	},
});

describe("the branch rule", () => {
	test("names a missing pull request rule", () => {
		const protection = { ...protectedBranch(), required_pull_request_reviews: null };
		expect(protectionProblems(protection, RULE)).toEqual(["main does not require a pull request"]);
	});

	test("names a missing required check", () => {
		const protection = protectedBranch();
		protection.required_status_checks.checks = [{ context: "typescript" }];
		expect(protectionProblems(protection, RULE)).toEqual(["main does not require the rust check"]);
	});

	test("passes when every rule is set", () => {
		expect(protectionProblems(protectedBranch(), RULE)).toEqual([]);
	});

	test("reads a check set through the older contexts list", () => {
		const protection = protectedBranch();
		protection.required_status_checks.checks = [];
		protection.required_status_checks.contexts = ["typescript", "rust", "harness"];
		expect(protectionProblems(protection, RULE)).toEqual([]);
	});

	test("names an unprotected branch", () => {
		expect(protectionProblems(null, RULE)).toEqual([
			"main is not protected",
			"main does not require the typescript check",
			"main does not require the rust check",
		]);
	});
});

describe("the body --apply writes", () => {
	test("sets exactly the pull request rule and the two checks", () => {
		expect(applyBody(RULE)).toEqual({
			required_status_checks: {
				strict: false,
				checks: [{ context: "typescript" }, { context: "rust" }],
			},
			enforce_admins: false,
			required_pull_request_reviews: { required_approving_review_count: 0 },
			restrictions: null,
		});
	});
});
