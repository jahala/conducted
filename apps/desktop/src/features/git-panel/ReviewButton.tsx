/**
 * @feature REV-01 Review button with the "edit before sending" option
 * Owns: the split button in the tab strip. The main part starts an AI review in a new chat. The
 * menu part opens the prompt for editing first.
 * Behaviour: ui-map.md 3.6 (tab strip: "Review" button, tooltip, split item "Edit before sending",
 * shortcut Cmd+Shift+R). The review prompt can be customised per repository (settings page
 * RepoPromptsPage).
 * Must handle: no changes to review (disabled with an explanation), a review already running
 * (disabled), the call failing (toast, button usable again), and the chosen review model coming
 * from settings, not from this component.
 * Test first: clicking the main part calls requestAiReview with null instructions, and the menu
 * item opens the prompt editor without calling it.
 */
import { notImplemented } from "@conducted/shared";

export interface ReviewButtonProps {
	disabled: boolean;
	disabledReason: string | null;
	onReview: () => void;
	onReviewWithEdit: () => void;
}

export function ReviewButton(_props: ReviewButtonProps): never {
	return notImplemented("REV-01");
}
