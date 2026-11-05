/**
 * @feature WS-06 Archived workspace notice
 * Owns: the centre screen of an archived workspace: files, terminals and previews are gone until it is
 * restored, and the branch-name field shown when the old branch can no longer be reused.
 * Behaviour: ui-map.md 3.2 ("Workspace archived. Unarchive this workspace to view files, terminals, and
 * browser previews."), 4 (archived workspaces are reached from Home, the palette and Passport).
 * Must handle: unarchive in progress (button busy); unarchive fails (the caller shows the error and the
 * button returns); the caller asks for a branch name (the field replaces the plain button); the chats of
 * an archived workspace stay readable elsewhere, this screen only explains the state.
 * Test first: renders the explanation and an "Unarchive" button that calls onUnarchive.
 */
import { useId, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Input } from "../../ui/Input.tsx";

export interface ArchivedNoticeProps {
	onUnarchive: (branchName: string | null) => void;
	busy: boolean;
	/** The old branch cannot be reused, so the user must name the branch the workspace returns on. */
	branchNameRequired?: boolean;
	/** A branch name the user tried was refused (for example checked out elsewhere). */
	branchError?: string | null;
}

export function ArchivedNotice({
	onUnarchive,
	busy,
	branchNameRequired = false,
	branchError = null,
}: ArchivedNoticeProps) {
	const inputId = useId();
	const [branchName, setBranchName] = useState("");
	const trimmed = branchName.trim();

	return (
		<EmptyState
			title="Workspace archived"
			body="Unarchive this workspace to view files, terminals, and browser previews."
			action={
				branchNameRequired ? (
					<form
						className="flex w-72 flex-col gap-2 text-left"
						onSubmit={(event) => {
							event.preventDefault();
							if (trimmed !== "") onUnarchive(trimmed);
						}}
					>
						<label htmlFor={inputId} className="text-sm font-medium text-fg">
							Branch name
						</label>
						<p className="text-xs text-fg-muted">
							The old branch can't be reused. Choose the branch to restore it on.
						</p>
						<Input
							id={inputId}
							autoFocus
							value={branchName}
							error={branchError ?? undefined}
							onChange={(event) => setBranchName(event.target.value)}
						/>
						<Button type="submit" variant="default" loading={busy} disabled={trimmed === ""}>
							Unarchive
						</Button>
					</form>
				) : (
					<Button variant="default" loading={busy} onClick={() => onUnarchive(null)}>
						Unarchive
					</Button>
				)
			}
		/>
	);
}
