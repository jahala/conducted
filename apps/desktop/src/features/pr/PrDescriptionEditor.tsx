/**
 * @feature PR-07 PR description editor
 * Owns: the PR description as rendered Markdown that switches to a text area for editing, with
 * Save and Discard.
 * Behaviour: ui-map.md 3.2 and 3.6 ("PR description", Save, Discard); services-map.md 3.7.5
 * (`gh pr edit --body`).
 * Must handle: an empty description (placeholder text "No description"), Cmd+Enter saving, a save
 * that fails, a description changed on GitHub while editing (the edit stays, a note shows), very
 * long text, and the description being read-only for merged or closed PRs.
 * Test first: with an empty description the placeholder shows and clicking it enters edit mode.
 */
import { notImplemented } from "@conducted/shared";

export interface PrDescriptionEditorProps {
	body: string;
	editable: boolean;
	onSave: (body: string) => Promise<boolean>;
}

export function PrDescriptionEditor(_props: PrDescriptionEditorProps): never {
	return notImplemented("PR-07");
}
