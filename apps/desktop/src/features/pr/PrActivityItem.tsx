/**
 * @feature PR-07 PR activity item
 * Owns: one line or card in the activity list, by entry kind, and the author-and-body part of a
 * comment, which the PR-level comment list shares.
 * Behaviour: ui-map.md 3.2 (PR tab: "Activity"); the kinds are listed in pr-activity.ts.
 * Must handle: each kind having its own icon and text, a review with a body (card) versus a bare
 * approval (one line), an author whose avatar is missing or fails to load (a letter), times
 * shown relative with the exact time in a tooltip, and an entry with no usable time (no time shown).
 * Test first: a "review" entry with state "changes_requested" renders the author and that state.
 */
import type { PrActivityEntry } from "../../core/model.ts";
import { AuthorAvatar } from "../../ui/AuthorAvatar.tsx";
import { Badge, type BadgeTone } from "../../ui/Badge.tsx";
import { ChatIcon, CircleIcon, GitCommitIcon, GitMergeIcon } from "../../ui/icons.tsx";
import { reviewerStateLabel } from "../git-panel/checks/ReviewersList.tsx";
import { relativeTime } from "../sidebar/WorkspaceRow.tsx";

export interface PrActivityItemProps {
	entry: PrActivityEntry;
	onOpen: () => void;
}

const REVIEW_TONE: Readonly<
	Record<"approved" | "changes_requested" | "commented" | "dismissed", BadgeTone>
> = {
	approved: "success",
	changes_requested: "danger",
	commented: "neutral",
	dismissed: "neutral",
};

const STATUS_LABEL: Readonly<
	Record<"ready_for_review" | "merged" | "closed" | "reopened", string>
> = {
	ready_for_review: "Marked ready for review",
	merged: "Merged",
	closed: "Closed",
	reopened: "Reopened",
};

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
				{entry.kind === "commit" ? (
					<GitCommitIcon />
				) : entry.kind === "review" ? (
					<GitMergeIcon />
				) : entry.kind === "comment" ? (
					<ChatIcon />
				) : (
					<CircleIcon />
				)}
			</span>
			<span className="min-w-0 flex-1">
				{entry.kind === "commit" ? (
					<>
						<span className="block truncate text-sm text-fg">{entry.subject}</span>
						<span className="block truncate text-xs text-fg-muted">
							<span className="font-mono">{entry.sha.slice(0, 7)}</span> · {entry.authorName}
						</span>
					</>
				) : entry.kind === "review" ? (
					<>
						<span className="flex flex-wrap items-center gap-1.5">
							<AuthorAvatar login={entry.authorLogin} avatarUrl={entry.authorAvatarUrl} />
							<span className="text-sm font-medium text-fg">{entry.authorLogin}</span>
							<Badge tone={REVIEW_TONE[entry.state]}>{reviewerStateLabel(entry.state)}</Badge>
						</span>
						{entry.body.trim() === "" ? null : (
							<span className="mt-1 block whitespace-pre-wrap break-words rounded-md border border-border bg-raised p-2 text-sm text-fg">
								{entry.body}
							</span>
						)}
					</>
				) : entry.kind === "comment" ? (
					<PrCommentContent entry={entry} />
				) : (
					<span className="block text-sm text-fg">{STATUS_LABEL[entry.change]}</span>
				)}
			</span>
			<Time at={entry.at} />
		</button>
	);
}
