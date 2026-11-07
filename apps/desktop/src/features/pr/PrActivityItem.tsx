/**
 * @feature PR-07 PR activity item
 * Owns: one line or card in the activity list, by entry kind, and the author-and-body part of a
 * comment, which the PR-level comment list shares.
 * Behaviour: ui-map.md 3.2 (PR tab: "Activity"). Conductor's activity list shows commits and
 * comments only (D078, renderApp @9996475), so those are the two kinds an entry has.
 * Must handle: each kind having its own icon and text, an author whose avatar is missing or fails
 * to load (a letter), times shown relative with the exact time in a tooltip, and an entry with no
 * usable time (no time shown).
 * Test first: a review thread comment renders its author, file and line, and body.
 */
import type { PrActivityEntry } from "../../core/model.ts";
import { AuthorAvatar } from "../../ui/AuthorAvatar.tsx";
import { ChatIcon, GitCommitIcon } from "../../ui/icons.tsx";
import { relativeTime } from "../sidebar/WorkspaceRow.tsx";

export interface PrActivityItemProps {
	entry: PrActivityEntry;
	onOpen: () => void;
}

type CommentEntry = Extract<PrActivityEntry, { kind: "comment" }>;

/** The author, file and body of a comment. The activity row and the PR-level list share it. */
export function PrCommentContent({ entry }: { entry: CommentEntry }) {
	return (
		<>
			<span className="flex flex-wrap items-center gap-1.5">
				<AuthorAvatar login={entry.authorLogin} avatarUrl={entry.authorAvatarUrl} />
				<span className="text-sm font-medium text-fg">{entry.authorLogin}</span>
				{entry.filePath === null ? null : (
					<span className="truncate font-mono text-2xs text-fg-subtle">
						{entry.filePath}
						{entry.line === null ? "" : `:${entry.line}`}
					</span>
				)}
			</span>
			<span className="mt-0.5 block whitespace-pre-wrap break-words text-sm text-fg">
				{entry.body}
			</span>
		</>
	);
}

function Time({ at }: { at: number }) {
	// An entry with no usable time shows none (it sorts last, pr-activity.ts).
	if (!Number.isFinite(at)) return null;
	const date = new Date(at);
	return (
		<time
			dateTime={date.toISOString()}
			title={date.toLocaleString()}
			className="shrink-0 text-2xs text-fg-subtle"
		>
			{relativeTime(at, Date.now())}
		</time>
	);
}

export function PrActivityItem({ entry, onOpen }: PrActivityItemProps) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:bg-hover"
		>
			<span className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true">
				{entry.kind === "commit" ? <GitCommitIcon /> : <ChatIcon />}
			</span>
			<span className="min-w-0 flex-1">
				{entry.kind === "commit" ? (
					<>
						<span className="block truncate text-sm text-fg">{entry.subject}</span>
						<span className="block truncate text-xs text-fg-muted">
							<span className="font-mono">{entry.sha.slice(0, 7)}</span> · {entry.authorName}
						</span>
					</>
				) : (
					<PrCommentContent entry={entry} />
				)}
			</span>
			<Time at={entry.at} />
		</button>
	);
}
