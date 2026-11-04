/**
 * @feature APP-04 Read-only composer bar
 * Owns: the bar that replaces the composer when a workspace cannot take messages.
 * Behaviour: ui-map.md 3.3 ("Archived or read-only composer bar": "This workspace is archived." with
 * "Unarchive").
 * Must handle: archived (Unarchive button, busy state); unarchive in progress; the bar keeps the composer's
 * height so the list does not jump.
 * Test first: renders the message and calls onUnarchive when the button is clicked.
 */
import { Button } from "../../ui/Button.tsx";

export interface ArchivedComposerBarProps {
	onUnarchive: () => void;
	busy: boolean;
}

export function ArchivedComposerBar({ onUnarchive, busy }: ArchivedComposerBarProps) {
	return (
		<div className="flex h-14 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4">
			<p className="text-sm text-fg-muted">This workspace is archived.</p>
			<Button variant="secondary" size="sm" loading={busy} onClick={onUnarchive}>
				Unarchive
			</Button>
		</div>
	);
}
