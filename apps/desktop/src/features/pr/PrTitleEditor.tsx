/**
 * @feature PR-07 PR title editor
 * Owns: the PR title as text that turns into an input on click, with Save and Discard.
 * Behaviour: ui-map.md 3.2 and 3.6 ("PR title", Save, Discard); services-map.md 3.7.5 (`gh pr edit
 * --title`).
 * Must handle: an empty title (Save disabled), Enter saving, Escape discarding, a save that fails
 * (text stays, error shown), a title over 256 characters (GitHub limit, counter shown), and a merged
 * or closed PR (not editable).
 * Test first: editing the title and pressing Enter calls onSave with the new text once.
 */
import { notImplemented } from "@conducted/shared";

export interface PrTitleEditorProps {
	title: string;
	editable: boolean;
	onSave: (title: string) => Promise<boolean>;
}

export function PrTitleEditor(_props: PrTitleEditorProps): never {
	return notImplemented("PR-07");
}
