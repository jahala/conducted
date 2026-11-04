/**
 * @feature PR-07 PR merge bar
 * Owns: the Merge block of the PR tab. Merge, auto-merge, and Mark ready, with the reasons when
 * merging is not possible.
 * Behaviour: ui-map.md 3.2 (PR tab: Merge) and 3.6 (Ready, Draft, Blocked, Unable states);
 * services-map.md 3.7.5 (merge pinned to the local head commit; a mismatch raises "code in this
 * workspace may differ from GitHub"; the merge method comes from the repository: squash, rebase,
 * merge commit).
 * Must handle: draft (Mark ready only), conflicts (Resolve through the agent), failing checks
 * (merge hidden or blocked by setting), a head mismatch (explain and offer Pull), auto-merge on and
 * off, merge in flight (spinner, no double click), merge queue, and archive-on-merge setting
 * (note that the workspace will be archived after merge).
 * Test first: with a head mismatch error the bar shows the explanation and does not retry.
 */
import { notImplemented } from "@conducted/shared";
import type { PullRequest } from "../../core/model.ts";

export interface PrMergeBarProps {
	pullRequest: PullRequest;
	blockedReason: string | null;
	busy: "merge" | "ready" | "automerge" | null;
	archiveOnMerge: boolean;
	onMerge: () => void;
	onMarkReady: () => void;
	onSetAutoMerge: (enabled: boolean) => void;
}

export function PrMergeBar(_props: PrMergeBarProps): never {
	return notImplemented("PR-07");
}
