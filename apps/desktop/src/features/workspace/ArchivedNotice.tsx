/**
 * @feature WS-06 Archived workspace notice
 * Owns: what a file, terminal or browser tab of an archived workspace shows: those are gone until it is
 * restored. Also owns `UnarchiveAction`, the Unarchive button that turns into a branch-name field when the
 * old branch can no longer be reused; the chat's archived bar uses it too.
 * Behaviour: ui-map.md 3.2 ("Workspace archived. Unarchive this workspace to view files, terminals, and
 * browser previews."), 4 (archived workspaces are reached from Home, the palette and Passport). Conductor
 * shows the notice in place of a file, terminal or browser tab only; chat tabs stay readable and the chat's
 * composer becomes the archived bar (renderApp @10062129, @9383062).
 * Must handle: unarchive in progress (button busy); unarchive fails (the caller shows the error and the
 * button returns); the caller asks for a branch name (the field replaces the plain button); a refused
 * branch name (shown under the field).
 * Our design choice: Conductor's notice has no button. Ours keeps the Unarchive button it had before the
 * notice moved onto single tabs, so nothing the user could do from it goes away.
 * Test first: renders the explanation and an "Unarchive" button that calls onUnarchive.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useId, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Input } from "../../ui/Input.tsx";
import { useUnarchive } from "./use-unarchive.ts";

export interface ArchivedNoticeProps {
	onUnarchive: (branchName: string | null) => void;
	busy: boolean;
	/** The old branch cannot be reused, so the user must name the branch the workspace returns on. */
	branchNameRequired?: boolean;
	/** A branch name the user tried was refused (for example checked out elsewhere). */
	branchError?: string | null;
}

export function ArchivedNotice(props: ArchivedNoticeProps) {
	return (
		<EmptyState
			title="Workspace archived"
			body="Unarchive this workspace to view files, terminals, and browser previews."
			action={<UnarchiveAction {...props} />}
		/>
	);
}

/** The notice for one archived workspace's file, terminal or browser tab, wired to its unarchive control. */
export function ArchivedTabNotice({ workspaceId }: { workspaceId: WorkspaceId }) {
	const control = useUnarchive(workspaceId);
	return (
		<ArchivedNotice
			onUnarchive={(branchName) => void control.unarchive(branchName)}
			busy={control.busy}
			branchNameRequired={control.branchNameRequired}
			branchError={control.branchError}
		/>
	);
}

/** The Unarchive button, or the branch-name field when the old branch cannot be reused. */
export function UnarchiveAction({
	onUnarchive,
	busy,
	branchNameRequired = false,
	branchError = null,
	compact = false,
}: ArchivedNoticeProps & { compact?: boolean }) {
	const inputId = useId();
	const [branchName, setBranchName] = useState("");
	const trimmed = branchName.trim();

	return branchNameRequired ? (
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
		<Button
			variant={compact ? "secondary" : "default"}
			{...(compact ? { size: "sm" as const } : {})}
			loading={busy}
			onClick={() => onUnarchive(null)}
		>
			Unarchive
		</Button>
	);
}
