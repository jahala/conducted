/**
 * @feature PR-08 Stack readiness
 * Owns: the one home of the rules that decide whether a GitHub stack can merge: each entry's own
 * readiness, the roll-up to a stack verdict ("ready" or "blocked"), the first entry that blocks a
 * stack merge (diverged, draft or not ready), how many pull requests a stack merge takes, and the
 * words the Git panel header and the stack view show for them.
 * Behaviour: services-map.md 3.8.2 (readiness per stack entry from GitHub's `mergeStateStatus`;
 * the research names the rules but does not give them, so they follow Conductor's own code, read
 * for behaviour only, D002), ui-map.md 3.6 ("Merge stack").
 * Must handle: merged and closed entries, which are left out of every rule; a draft, which blocks
 * even when it is the pull request being merged; a lower entry that is not ready, which blocks the
 * entries above it but not itself; an entry whose base is not the head of the open entry below it
 * (the stack needs a rebase); an unknown readiness (GitHub said UNKNOWN, or the readiness read gave
 * no answer), which never blocks and gives no verdict; a pull request that is not in the list.
 * Our design choice: plain functions over `StackEntryView[]`, ordered from trunk up; they read no
 * store and run no command.
 * Test first: a lower pull request that GitHub reports as BLOCKED blocks the stack merge of the
 * pull request above it, and the header names it.
 */
import type { StackEntryView } from "../model.ts";

/** One entry's own readiness, from its draft flag and GitHub's merge state. */
export type EntryReadiness = "ready" | "notReady" | "draft" | "unknown";

/** One entry's readiness once the entries below it are counted. */
export type EntryVerdict = EntryReadiness | "blockedDownstack";

export interface StackReadiness {
	/** The verdict of every open entry, by pull request number. */
	entries: Map<number, EntryVerdict>;
	/** Null while the top open entry's readiness is unknown, or when no entry is open. */
	stack: "ready" | "blocked" | null;
}

/** The first entry, from the bottom, that keeps a stack merge from running. */
export interface StackBlocker {
	kind: "diverged" | "draft" | "notReady";
	prNumber: number;
}

export type StackStatusTone = "neutral" | "success" | "warning" | "danger";

/** The label a stack view row shows for an entry. */
export interface StackEntryStatus {
	label: string;
	tone: StackStatusTone;
}

/** Merged and closed entries are done; every rule skips them. */
function isOpenEntry(entry: StackEntryView): boolean {
	return entry.state !== "merged" && entry.state !== "closed";
}

/** A draft is a draft whatever GitHub says; otherwise GitHub's merge state decides. */
export function entryReadiness(entry: StackEntryView): EntryReadiness {
	if (entry.state === "draft") return "draft";
	switch (entry.mergeStateStatus) {
		case "CLEAN":
		case "UNSTABLE":
		case "HAS_HOOKS":
			return "ready";
		case "DIRTY":
		case "BLOCKED":
		case "BEHIND":
		case "DRAFT":
			return "notReady";
		case "UNKNOWN":
		case null:
			return "unknown";
	}
}

type Downstack = "ok" | "unknown" | "blocked";

function entryVerdict(own: EntryReadiness, downstack: Downstack): EntryVerdict {
	if (own === "draft" || own === "notReady") return own;
	if (downstack === "blocked") return "blockedDownstack";
	if (own === "unknown" || downstack === "unknown") return "unknown";
	return "ready";
}

/** Walks the open entries from trunk up; anything not ready blocks every entry above it. */
export function stackReadiness(entries: readonly StackEntryView[]): StackReadiness {
	const verdicts = new Map<number, EntryVerdict>();
	let downstack: Downstack = "ok";
	let top: EntryVerdict | undefined;
	for (const entry of entries) {
		if (!isOpenEntry(entry)) continue;
		const verdict = entryVerdict(entryReadiness(entry), downstack);
		verdicts.set(entry.number, verdict);
		top = verdict;
		if (verdict !== "ready" && verdict !== "unknown") downstack = "blocked";
		else if (verdict === "unknown" && downstack === "ok") downstack = "unknown";
	}
	const stack =
		top === undefined || top === "unknown" ? null : top === "ready" ? "ready" : "blocked";
	return { entries: verdicts, stack };
}

/**
 * What blocks a stack merge up to and including `prNumber`. Each open entry must sit on the head
 * of the open entry below it and must not be a draft; an entry below the pull request must also
 * not be "not ready". The pull request's own merge state is the header's business, not this one.
 */
export function stackBlocker(
	entries: readonly StackEntryView[],
	prNumber: number,
): StackBlocker | null {
	const index = entries.findIndex((entry) => entry.number === prNumber);
	if (index === -1) return null;
	let expectedBase: string | undefined;
	for (const entry of entries.slice(0, index + 1)) {
		if (!isOpenEntry(entry)) continue;
		if (expectedBase !== undefined && entry.baseSha !== expectedBase) {
			return { kind: "diverged", prNumber: entry.number };
		}
		if (entry.state === "draft") return { kind: "draft", prNumber: entry.number };
		if (entry.number !== prNumber && entryReadiness(entry) === "notReady") {
			return { kind: "notReady", prNumber: entry.number };
		}
		expectedBase = entry.headSha;
	}
	return null;
}

/** The open entries a stack merge of `prNumber` takes, from the bottom up to it. */
export function stackMergeCount(entries: readonly StackEntryView[], prNumber: number): number {
	const index = entries.findIndex((entry) => entry.number === prNumber);
	if (index === -1) return 0;
	return entries.slice(0, index + 1).filter(isOpenEntry).length;
}

/** The header's title for a blocked stack. */
export function stackBlockerTitle(blocker: StackBlocker): string {
	switch (blocker.kind) {
		case "diverged":
			return "Stack needs a rebase";
		case "draft":
			return `#${blocker.prNumber} is still a draft`;
		case "notReady":
			return `#${blocker.prNumber} isn't ready to merge`;
	}
}

/** What the Git panel header needs from a stack; null when the pull request is in no stack. */
export function headerStackInput(
	entries: readonly StackEntryView[],
	prNumber: number,
): { mergeCount: number; blockedReason: string | null } | null {
	if (entries.length === 0) return null;
	const blocker = stackBlocker(entries, prNumber);
	return {
		mergeCount: stackMergeCount(entries, prNumber),
		blockedReason: blocker === null ? null : stackBlockerTitle(blocker),
	};
}

/** The label of one stack view row. A merged or closed entry says so before anything else. */
export function stackEntryStatus({
	entry,
	readiness,
	needsRebase,
}: {
	entry: StackEntryView;
	readiness: EntryVerdict | undefined;
	needsRebase: boolean;
}): StackEntryStatus {
	if (entry.state === "merged") return { label: "Merged", tone: "neutral" };
	if (entry.state === "closed") return { label: "Closed", tone: "danger" };
	if (needsRebase) return { label: "Needs rebase", tone: "warning" };
	if (entry.state === "draft") return { label: "Draft", tone: "neutral" };
	switch (readiness) {
		case "notReady":
			return { label: "Not ready", tone: "warning" };
		case "blockedDownstack":
			return { label: "Blocked downstack", tone: "neutral" };
		case "ready":
			return { label: "Ready to merge", tone: "success" };
		case "draft":
		case "unknown":
		case undefined:
			return { label: "Open", tone: "success" };
	}
}

/**
 * The stack view's readiness: the whole stack is judged as a merge of its top entry, so anything
 * that blocks that merge makes the verdict "blocked", and a diverged entry is the one that needs a
 * rebase.
 */
export function stackViewReadiness(entries: readonly StackEntryView[]): {
	verdict: "ready" | "blocked" | null;
	statusOf: (entry: StackEntryView) => StackEntryStatus;
} {
	const readiness = stackReadiness(entries);
	const top = entries[entries.length - 1];
	const blocker = top === undefined ? null : stackBlocker(entries, top.number);
	const rebaseNumber = blocker?.kind === "diverged" ? blocker.prNumber : null;
	return {
		verdict: blocker !== null ? "blocked" : readiness.stack,
		statusOf: (entry) =>
			stackEntryStatus({
				entry,
				readiness: readiness.entries.get(entry.number),
				needsRebase: rebaseNumber === entry.number,
			}),
	};
}
