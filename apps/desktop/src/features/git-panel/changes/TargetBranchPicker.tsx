/**
 * @feature REV-01 Target branch picker
 * Owns: a searchable list of branches. It is used by the diff scope menu to compare against a
 * branch, and by the header to change the workspace's target branch (GIT-08).
 * Behaviour: ui-map.md 3.6 ("Select target branch..."); services-map.md 3.6.6 (remote branch list,
 * newest first, without HEAD) and 3.11 (retarget).
 * Must handle: loading the branch list (it fetches), offline (use cached remote branches and say
 * so), no match for the query, the current target marked, and branches checked out in another
 * worktree (shown, not selectable as a checkout target).
 * Test first: typing "rel" narrows ["main", "release/1"] to the second entry.
 */
import { notImplemented } from "@conducted/shared";

export interface TargetBranchPickerProps {
	branches: string[];
	current: string;
	onSelect: (branch: string) => void;
	loading: boolean;
	offline: boolean;
}

export function TargetBranchPicker(_props: TargetBranchPickerProps): never {
	return notImplemented("REV-01");
}
