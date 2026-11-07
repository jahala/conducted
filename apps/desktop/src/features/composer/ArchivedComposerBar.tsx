/**
 * @feature APP-04 Read-only composer bar
 * Owns: the bar that replaces the composer in a chat of an archived workspace, and `ArchivedComposer`,
 * which gives it the workspace's unarchive control.
 * Behaviour: ui-map.md 3.3 ("Archived or read-only composer bar": "This workspace is archived." with
 * "Unarchive"). Conductor draws it in place of the composer while the chat above stays readable
 * (renderApp @9383062, @9398288).
 * Must handle: archived (Unarchive button, busy state); unarchive in progress; the old branch cannot be
 * reused (the bar asks for a branch name, as the archived notice does); the bar keeps the composer's
 * height so the list does not jump.
 * Test first: renders the message and calls onUnarchive when the button is clicked.
 */
import type { WorkspaceId } from "@conducted/shared";
import { ArchiveIcon } from "../../ui/icons.tsx";
import { type ArchivedNoticeProps, UnarchiveAction } from "../workspace/ArchivedNotice.tsx";
import { useUnarchive } from "../workspace/use-unarchive.ts";

export type ArchivedComposerBarProps = ArchivedNoticeProps;

export function ArchivedComposerBar(props: ArchivedComposerBarProps) {
	return (
		<div className="flex min-h-14 flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3">
			<div className="flex items-center justify-between gap-3">
				<p className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
					<ArchiveIcon className="size-4 shrink-0" aria-hidden />
					<span className="truncate">This workspace is archived.</span>
				</p>
				{props.branchNameRequired === true ? null : <UnarchiveAction {...props} compact />}
			</div>
			{props.branchNameRequired === true ? <UnarchiveAction {...props} /> : null}
		</div>
	);
}

/** The archived bar for one workspace, wired to its unarchive control. */
export function ArchivedComposer({ workspaceId }: { workspaceId: WorkspaceId }) {
	const control = useUnarchive(workspaceId);
	return (
		<ArchivedComposerBar
			onUnarchive={(branchName) => void control.unarchive(branchName)}
			busy={control.busy}
			branchNameRequired={control.branchNameRequired}
			branchError={control.branchError}
		/>
	);
}
