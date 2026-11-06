// @vitest-environment node
/**
 * @feature PR-08 Stack readiness
 * Owns: tests for the readiness rules of a GitHub stack: each entry's own readiness, the roll-up
 * to a stack verdict, the first entry that blocks a stack merge, the number of pull requests a
 * stack merge takes, the words the header and the stack view show for them, and whether a pull
 * request is in a GitHub stack.
 * Behaviour: services-map.md 3.8.2 (readiness per stack entry; Conductor's rules, checked against
 * its own code where the research names them only).
 * Test first: a lower pull request that GitHub reports as BLOCKED blocks the stack merge of the
 * pull request above it, and the header names it.
 */
import { describe, expect, it } from "vitest";
import type { PullRequest, StackEntryView } from "../model.ts";
import {
	entryReadiness,
	headerStackInput,
	isInGitHubStack,
	stackBlocker,
	stackBlockerTitle,
	stackEntryStatus,
	stackMergeCount,
	stackReadiness,
	stackViewReadiness,
} from "./stack-readiness.ts";

const entry = (over: Partial<StackEntryView> & { number: number }): StackEntryView => ({
	title: `PR ${over.number}`,
	branch: `feat-${over.number}`,
	state: "open",
	isCurrent: false,
	needsRestack: false,
	mergeStateStatus: "CLEAN",
	headSha: `head-${over.number}`,
	baseSha: `head-${over.number - 1}`,
	...over,
});

/** Three open pull requests, each based on the head of the one below it. */
const chain = (over: Record<number, Partial<StackEntryView>> = {}): StackEntryView[] =>
	[1, 2, 3].map((number) => entry({ number, ...over[number] }));

describe("PR-08 readiness of one stack entry", () => {
	it("reads GitHub's merge state, with a draft first", () => {
		expect(entryReadiness(entry({ number: 1, mergeStateStatus: "CLEAN" }))).toBe("ready");
		expect(entryReadiness(entry({ number: 1, mergeStateStatus: "UNSTABLE" }))).toBe("ready");
		expect(entryReadiness(entry({ number: 1, mergeStateStatus: "HAS_HOOKS" }))).toBe("ready");
		for (const status of ["DIRTY", "BLOCKED", "BEHIND", "DRAFT"] as const) {
			expect(entryReadiness(entry({ number: 1, mergeStateStatus: status }))).toBe("notReady");
		}
		expect(entryReadiness(entry({ number: 1, mergeStateStatus: "UNKNOWN" }))).toBe("unknown");
		expect(entryReadiness(entry({ number: 1, mergeStateStatus: null }))).toBe("unknown");
		expect(entryReadiness(entry({ number: 1, state: "draft", mergeStateStatus: "CLEAN" }))).toBe(
			"draft",
		);
	});
});

describe("PR-08 stack verdict", () => {
	it("is ready when every open entry is ready", () => {
		const readiness = stackReadiness(chain());
		expect(readiness.stack).toBe("ready");
		expect([...readiness.entries.values()]).toEqual(["ready", "ready", "ready"]);
	});

	it("marks the entries above a not-ready one as blocked downstack", () => {
		const readiness = stackReadiness(chain({ 1: { mergeStateStatus: "BLOCKED" } }));
		expect(readiness.stack).toBe("blocked");
		expect(readiness.entries.get(1)).toBe("notReady");
		expect(readiness.entries.get(2)).toBe("blockedDownstack");
		expect(readiness.entries.get(3)).toBe("blockedDownstack");
	});

	it("keeps a draft's own verdict above a blocked entry", () => {
		const readiness = stackReadiness(
			chain({ 1: { mergeStateStatus: "DIRTY" }, 2: { state: "draft" } }),
		);
		expect(readiness.entries.get(2)).toBe("draft");
		expect(readiness.entries.get(3)).toBe("blockedDownstack");
		expect(readiness.stack).toBe("blocked");
	});

	it("has no verdict while the top entry's readiness is unknown", () => {
		const readiness = stackReadiness(chain({ 1: { mergeStateStatus: null } }));
		expect(readiness.entries.get(1)).toBe("unknown");
		expect(readiness.entries.get(3)).toBe("unknown");
		expect(readiness.stack).toBeNull();
	});

	it("leaves merged and closed entries out", () => {
		const readiness = stackReadiness(
			chain({ 1: { state: "merged", mergeStateStatus: "BLOCKED" }, 2: { state: "closed" } }),
		);
		expect(readiness.entries.has(1)).toBe(false);
		expect(readiness.entries.has(2)).toBe(false);
		expect(readiness.stack).toBe("ready");
	});

	it("has no verdict for a stack with no open entry", () => {
		expect(
			stackReadiness(
				chain({ 1: { state: "merged" }, 2: { state: "merged" }, 3: { state: "closed" } }),
			).stack,
		).toBeNull();
	});
});

describe("PR-08 what blocks a stack merge", () => {
	it("is nothing when every entry up to the pull request is ready", () => {
		expect(stackBlocker(chain(), 3)).toBeNull();
	});

	it("names a lower entry that is not ready, but not the pull request itself", () => {
		expect(stackBlocker(chain({ 1: { mergeStateStatus: "BLOCKED" } }), 3)).toEqual({
			kind: "notReady",
			prNumber: 1,
		});
		expect(stackBlocker(chain({ 3: { mergeStateStatus: "BLOCKED" } }), 3)).toBeNull();
	});

	it("names a draft, including the pull request itself", () => {
		expect(stackBlocker(chain({ 2: { state: "draft" } }), 3)).toEqual({
			kind: "draft",
			prNumber: 2,
		});
		expect(stackBlocker(chain({ 3: { state: "draft" } }), 3)).toEqual({
			kind: "draft",
			prNumber: 3,
		});
	});

	it("names the first entry whose base is not the head of the open entry below it", () => {
		expect(stackBlocker(chain({ 2: { baseSha: "old-head-1" } }), 3)).toEqual({
			kind: "diverged",
			prNumber: 2,
		});
	});

	it("skips merged and closed entries when it follows the chain", () => {
		// #1 merged; #2 is based on something else, which is fine: it is the lowest open entry.
		const entries = chain({ 1: { state: "merged" }, 2: { baseSha: "main-head" } });
		expect(stackBlocker(entries, 3)).toBeNull();
	});

	it("looks only at the entries up to the pull request", () => {
		expect(stackBlocker(chain({ 3: { mergeStateStatus: "BLOCKED" } }), 2)).toBeNull();
		expect(stackBlocker(chain(), 99)).toBeNull();
	});

	it("words each blocker as the header shows it", () => {
		expect(stackBlockerTitle({ kind: "diverged", prNumber: 2 })).toBe("Stack needs a rebase");
		expect(stackBlockerTitle({ kind: "draft", prNumber: 2 })).toBe("#2 is still a draft");
		expect(stackBlockerTitle({ kind: "notReady", prNumber: 1 })).toBe("#1 isn't ready to merge");
	});
});

describe("PR-08 how many pull requests a stack merge takes", () => {
	it("counts the open entries from the bottom up to the pull request", () => {
		expect(stackMergeCount(chain(), 3)).toBe(3);
		expect(stackMergeCount(chain(), 1)).toBe(1);
		expect(stackMergeCount(chain({ 1: { state: "merged" } }), 3)).toBe(2);
		expect(stackMergeCount(chain(), 99)).toBe(0);
	});
});

describe("PR-08 the header's stack input", () => {
	it("gives the merge count and no blocker for a ready stack", () => {
		expect(headerStackInput(chain(), 3)).toEqual({ mergeCount: 3, blockedReason: null });
	});

	it("gives the blocker's words when a lower entry is not ready", () => {
		expect(headerStackInput(chain({ 1: { mergeStateStatus: "BEHIND" } }), 3)).toEqual({
			mergeCount: 3,
			blockedReason: "#1 isn't ready to merge",
		});
	});

	it("is nothing outside a stack", () => {
		expect(headerStackInput([], 3)).toBeNull();
	});
});

describe("PR-08 the stack view's readiness", () => {
	it("labels each entry and gives the stack's verdict", () => {
		const entries = [
			entry({ number: 1, state: "merged" }),
			entry({ number: 2, mergeStateStatus: "BLOCKED", baseSha: "main-head" }),
			entry({ number: 3 }),
			entry({ number: 4, state: "draft" }),
		];
		const view = stackViewReadiness(entries);
		expect(view.verdict).toBe("blocked");
		expect(entries.map((item) => view.statusOf(item).label)).toEqual([
			"Merged",
			"Not ready",
			"Blocked downstack",
			"Draft",
		]);
	});

	it("marks the entry that needs a rebase, and the stack as blocked", () => {
		const entries = chain({ 2: { baseSha: "old-head-1" } });
		const view = stackViewReadiness(entries);
		expect(view.verdict).toBe("blocked");
		expect(entries.map((item) => view.statusOf(item).label)).toEqual([
			"Ready to merge",
			"Needs rebase",
			"Ready to merge",
		]);
	});

	it("says a ready stack can merge", () => {
		expect(stackViewReadiness(chain()).verdict).toBe("ready");
	});

	it("shows Open while readiness is unknown, with no verdict", () => {
		const entries = chain({ 1: { mergeStateStatus: null } });
		const view = stackViewReadiness(entries);
		expect(view.verdict).toBeNull();
		expect(view.statusOf(entries[0] as StackEntryView).label).toBe("Open");
	});

	it("labels a closed entry", () => {
		expect(
			stackEntryStatus({
				entry: entry({ number: 1, state: "closed" }),
				readiness: undefined,
				needsRebase: false,
			}),
		).toEqual({ label: "Closed", tone: "danger" });
	});
});

describe("PR-08 whether a pull request is in a GitHub stack", () => {
	const pullRequest = (state: PullRequest["state"]): PullRequest => ({
		number: 2,
		url: "https://github.com/o/r/pull/2",
		title: "PR 2",
		body: "",
		state,
		mergeable: "mergeable",
		reviewDecision: null,
		checks: [],
		inMergeQueue: false,
		autoMergeEnabled: false,
		baseBranch: "feat-1",
		authorLogin: "octocat",
		viewerDidAuthor: true,
		viewerCanMerge: true,
		mergeMethod: "squash",
		reviewers: [],
		deployments: [],
		updatedAt: 0,
	});

	it("counts an open pull request whose stack read found members", () => {
		expect(isInGitHubStack(pullRequest("open"), chain())).toBe(true);
		expect(isInGitHubStack(pullRequest("draft"), chain())).toBe(true);
	});

	it("leaves out a merged pull request, no pull request, and a stack read with no members", () => {
		expect(isInGitHubStack(pullRequest("merged"), chain())).toBe(false);
		expect(isInGitHubStack(null, chain())).toBe(false);
		expect(isInGitHubStack(pullRequest("open"), [])).toBe(false);
		expect(isInGitHubStack(pullRequest("open"), null)).toBe(false);
	});
});
