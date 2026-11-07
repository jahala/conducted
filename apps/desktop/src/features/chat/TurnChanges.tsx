/**
 * @feature REV-09 Turn change summary
 * Owns: the files a turn changed, as small chips at the end of the turn's footer row, each with the file's
 * name and its line counts, and a "+N more" chip for the rest; and `turnDiffScope`, the scope a turn's
 * changes open with.
 * Behaviour: ui-map.md 3.3 (file-change summary), measured from Conductor 0.92.1 (renderApp @9586422,
 * file chips in the footer): up to three files show as chips; with more, the first two show and an outlined
 * "+N more" chip with the rest's line counts opens three more at a time. A chip is an outlined 20px badge
 * with a file icon, the name and "+a -r" in small monospace (zero counts shown). Clicking a chip opens that
 * file's diff with the turn's changes in the Git panel.
 * Our "Open diff" (the whole turn in the Changes tab) is an item of the turn's "···" menu (TurnFooter), so
 * the row ends with the chips as Conductor's does (D098). A chip's tooltip names the change: "Modified",
 * "Added", "Deleted", "Renamed from <old path>".
 * Must handle: no changes (renders nothing); many files (two, then "+N more", three more per click); a
 * deleted or renamed file (named in the tooltip); a binary file; the turn is reverted (every chip is struck
 * through).
 * Test first: a turn with 12 changed files shows two chips and "+10 more"; one click shows three more.
 */

import type { SessionId } from "@conducted/shared";
import { useState } from "react";
import type { DiffScope } from "../../core/api.ts";
import type { ChatTurn } from "../../core/model.ts";
import { cn } from "../../ui/cn.ts";
import { FileTextIcon } from "../../ui/icons.tsx";
import { fileNameOf } from "./tools/ToolCardFrame.tsx";

/** Up to this many files show as chips at once. */
export const TURN_CHANGES_ALL = 3;
/** With more files than that, this many show before the "+N more" chip. */
export const TURN_CHANGES_PREVIEW = TURN_CHANGES_ALL - 1;
/** Each click on "+N more" shows this many more. */
export const TURN_CHANGES_STEP = 3;

type Change = ChatTurn["changes"][number];

const statusLabel: Record<Change["status"], string> = {
	added: "Added",
	modified: "Modified",
	deleted: "Deleted",
	renamed: "Renamed",
	copied: "Copied",
};

function changeTitle(file: Change): string {
	const status = statusLabel[file.status];
	const from = file.oldPath === undefined ? "" : ` from ${file.oldPath}`;
	return `${status}${from}: ${file.path}${file.binary ? " (binary)" : ""}`;
}

const chipClass =
	"inline-flex h-5 min-w-0 max-w-64 shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 text-xs leading-none text-fg hover:bg-hover";

function Counts({ added, removed }: { added: number; removed: number }) {
	return (
		<span className="flex shrink-0 items-center gap-1 font-mono text-3xs font-medium">
			<span className="text-git-added">+{added}</span>
			<span className="text-git-removed">-{removed}</span>
		</span>
	);
}

export interface TurnChangesProps {
	turn: ChatTurn;
	sessionId: SessionId;
	/** Opens one file's diff with the turn's changes in the Git panel. */
	onOpenFile?: (path: string, scope: DiffScope) => void;
}

/** The scope that shows one turn's changes in the Git panel. */
export function turnDiffScope(turn: ChatTurn, sessionId: SessionId): DiffScope {
	return { kind: "turn", sessionId, turnId: turn.turnId };
}

export function TurnChanges({ turn, sessionId, onOpenFile }: TurnChangesProps) {
	const [extra, setExtra] = useState(0);
	const changes = turn.changes;
	if (changes.length === 0) return null;

	const first = changes.length <= TURN_CHANGES_ALL ? changes.length : TURN_CHANGES_PREVIEW;
	const visible = changes.slice(0, first + extra);
	const rest = changes.slice(first + extra);
	const scope = turnDiffScope(turn, sessionId);
	const restAdded = rest.reduce((sum, file) => sum + file.linesAdded, 0);
	const restRemoved = rest.reduce((sum, file) => sum + file.linesRemoved, 0);
	const nextStep = Math.min(TURN_CHANGES_STEP, rest.length);

	return (
		<section
			aria-label="Files changed in this turn"
			className={cn(
				"flex min-w-0 flex-wrap items-center gap-2",
				turn.reverted && "line-through opacity-60",
			)}
		>
			{visible.map((file) => (
				<button
					key={`${file.oldPath ?? ""}\u0000${file.path}`}
					type="button"
					title={changeTitle(file)}
					onClick={() => onOpenFile?.(file.path, scope)}
					className={chipClass}
				>
					<FileTextIcon className="size-3 shrink-0 text-fg-muted" />
					<span className="truncate">{fileNameOf(file.path)}</span>
					<Counts added={file.linesAdded} removed={file.linesRemoved} />
				</button>
			))}
			{rest.length > 0 ? (
				<button
					type="button"
					title={`Show ${nextStep} more changed ${nextStep === 1 ? "file" : "files"}`}
					onClick={() => setExtra(extra + TURN_CHANGES_STEP)}
					className={cn(chipClass, "tabular-nums")}
				>
					<FileTextIcon className="size-3 shrink-0 text-fg-muted" />
					<span>+{rest.length} more</span>
					<Counts added={restAdded} removed={restRemoved} />
				</button>
			) : null}
		</section>
	);
}
