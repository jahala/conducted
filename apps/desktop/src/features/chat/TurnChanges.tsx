/**
 * @feature REV-09 Turn change summary
 * Owns: The list of files a turn changed, with line counts and an 'Open diff' action that hands the
 * caller a `DiffScope` for this turn.
 * Behaviour: ui-map.md 3.3 (file-change summary with 'Open diff'), 3.3 checkpoint controls (diff
 * scope 'turn'), 3.6 (Changes list).
 * Must handle: No changes (renders nothing); many files (the first five, then 'and N more', which
 * expands the list); a deleted or renamed file (the old path is named); a binary file (no line
 * counts); the turn is reverted (every row is struck through); no handler for opening the diff
 * (the 'Open diff' action is shown disabled).
 * Our design choice: the component cannot open the Changes view itself, so it hands the turn scope
 * to the optional `onOpenDiff` and the caller shows the view.
 * Test first: A turn with 12 changed files shows the first 5 and 'and 7 more'.
 */

import type { SessionId } from "@conducted/shared";
import { useState } from "react";
import type { DiffScope } from "../../core/api.ts";
import type { ChatTurn } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";

/** Most files shown before the list offers to expand. */
export const TURN_CHANGES_PREVIEW = 5;

const statusLabel: Record<ChatTurn["changes"][number]["status"], string> = {
	added: "Added",
	modified: "Modified",
	deleted: "Deleted",
	renamed: "Renamed",
	copied: "Copied",
};

const statusClass: Record<ChatTurn["changes"][number]["status"], string> = {
	added: "text-git-added",
	modified: "text-fg-muted",
	deleted: "text-git-removed",
	renamed: "text-info",
	copied: "text-info",
};

export interface TurnChangesProps {
	turn: ChatTurn;
	sessionId: SessionId;
	/**
	 * Shows the Changes view for this turn. The caller turns the scope into its own view. Without it
	 * the action is shown disabled, because this component cannot open the panel itself.
	 */
	onOpenDiff?: (scope: DiffScope) => void;
}

export function TurnChanges({ turn, sessionId, onOpenDiff }: TurnChangesProps) {
	const [expanded, setExpanded] = useState(false);
	const changes = turn.changes;
	if (changes.length === 0) return null;

	const visible = expanded ? changes : changes.slice(0, TURN_CHANGES_PREVIEW);
	const hidden = changes.length - TURN_CHANGES_PREVIEW;
	const scope: DiffScope = { kind: "turn", sessionId, turnId: turn.turnId };
	const count = `${changes.length} file${changes.length === 1 ? "" : "s"} changed`;

	return (
		<section
			aria-label="Files changed in this turn"
			className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
		>
			<div className="flex items-center gap-2 text-fg-subtle">
				<span className="flex-1">{count}</span>
				<Button
					variant="ghost"
					size="xs"
					disabled={onOpenDiff === undefined}
					title={
						onOpenDiff === undefined
							? "The Changes view cannot be opened from this chat."
							: undefined
					}
					onClick={() => onOpenDiff?.(scope)}
				>
					Open diff
				</Button>
			</div>
			<ul
				className={
					turn.reverted ? "flex flex-col gap-0.5 line-through opacity-60" : "flex flex-col gap-0.5"
				}
			>
				{visible.map((file) => (
					<li
						key={`${file.oldPath ?? ""}\u0000${file.path}`}
						className="flex min-w-0 items-center gap-2"
					>
						<span
							className={`w-16 shrink-0 text-2xs ${statusClass[file.status]}`}
							title={file.status}
						>
							{statusLabel[file.status]}
						</span>
						<span className="min-w-0 flex-1 truncate text-fg" title={file.path}>
							{file.path}
						</span>
						{file.oldPath === undefined ? null : (
							<span className="max-w-40 truncate text-2xs text-fg-subtle" title={file.oldPath}>
								from {file.oldPath}
							</span>
						)}
						{file.binary ? (
							<span className="shrink-0 text-2xs text-fg-subtle">binary</span>
						) : (
							<span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs">
								<span className="text-git-added">+{file.linesAdded}</span>
								<span className="text-git-removed">-{file.linesRemoved}</span>
							</span>
						)}
					</li>
				))}
			</ul>
			{hidden > 0 && !expanded ? (
				<button
					type="button"
					onClick={() => setExpanded(true)}
					className="self-start rounded-sm px-1 text-2xs text-fg-muted hover:bg-hover hover:text-fg"
				>
					and {hidden} more
				</button>
			) : null}
		</section>
	);
}
