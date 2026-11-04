/**
 * @feature REV-01 Git panel header
 * Owns: the status chip and the one main action button above the tab strip. It renders a
 * GitHeaderModel and calls the matching action. It decides nothing itself.
 * Behaviour: ui-map.md 3.6 ("Header status chip and action"); the cases are in core/status/git-header.ts.
 * Data: the parent computes the model with computeGitHeader and passes it in.
 * Must handle: no action (chip only), an action in flight (spinner, clicks ignored), a failed
 * action (error toast from the Result, button usable again), a waiting note instead of a button
 * (reviewer cannot approve own PR), the keyboard shortcut shown on the button, the Retry action
 * for missing PR info, and narrow panel widths (title truncates, button keeps its label).
 * Test first: a model with kind "ready_to_merge" renders a Merge button, and clicking it calls
 * onAction with "merge" once even if clicked twice while busy.
 */
import { notImplemented } from "@conducted/shared";
import type {
	GitHeaderActionId,
	GitHeader as GitHeaderModel,
} from "../../core/status/git-header.ts";

export interface GitHeaderProps {
	model: GitHeaderModel;
	onAction: (action: GitHeaderActionId) => void;
}

export function GitHeader(_props: GitHeaderProps): never {
	return notImplemented("REV-01");
}
