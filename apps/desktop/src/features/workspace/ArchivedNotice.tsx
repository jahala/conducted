/**
 * @feature WS-06 Archived workspace notice
 * Owns: the centre screen of an archived workspace: files, terminals and previews are gone until it is restored.
 * Behaviour: ui-map.md 3.2 ("Workspace archived. Unarchive this workspace to view files, terminals, and browser
 * previews."), 4 (archived workspaces are reached from Home, the palette and Passport).
 * Must handle: unarchive in progress (button busy); unarchive fails (the caller shows the error and the button
 * returns); the chats of an archived workspace stay readable elsewhere, this screen only explains the state.
 * Test first: renders the explanation and an "Unarchive" button that calls onUnarchive.
 */
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";

export interface ArchivedNoticeProps {
	onUnarchive: () => void;
	busy: boolean;
}

export function ArchivedNotice({ onUnarchive, busy }: ArchivedNoticeProps) {
	return (
		<EmptyState
			title="This workspace is archived"
			body="Unarchive it to view files, terminals and browser previews."
			action={
				<Button variant="default" loading={busy} onClick={onUnarchive}>
					Unarchive
				</Button>
			}
		/>
	);
}
