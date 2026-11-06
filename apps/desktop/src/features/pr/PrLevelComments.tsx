/**
 * @feature REV-13 Pull request comments without a file
 * Owns: the list in the PR tab of comments that sit on the pull request itself, each with its
 * author's avatar.
 * Behaviour: services-map.md 3.7.4 and 5A.7.3 (general pull request comments come from
 * `pullRequest.comments`, keep ids that start with `github-general-`, and carry the author's
 * avatar); ui-map.md 3.2 (the PR tab).
 * Data: the caller passes the PR activity entries; this keeps the comment entries whose file path
 * is null. The PR tab shows those here instead of in the Activity list, so each comment has one home.
 * Must handle: no such comments (the section is hidden, not an empty box); an author without an
 * avatar (a letter on a neutral circle); an avatar that fails to load (the same letter); a long
 * body (wraps).
 * Test first: three comments, one with a file path, show two entries, and the file one is absent.
 */
import { useState } from "react";
import type { PrActivityEntry } from "../../core/model.ts";

export interface PrLevelCommentsProps {
	/** The workspace's PR activity; this keeps the comment entries with no file. */
	entries: readonly PrActivityEntry[];
}

function AuthorAvatar({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
	const [failed, setFailed] = useState(false);
	const letter = login.trim().slice(0, 1).toUpperCase() || "?";
	if (avatarUrl !== null && !failed) {
		return (
			<img
				src={avatarUrl}
				alt=""
				className="size-4 shrink-0 rounded-full bg-muted"
				onError={() => setFailed(true)}
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className="flex size-4 shrink-0 items-center justify-center rounded-full bg-hover text-3xs font-medium text-fg-muted"
		>
			{letter}
		</span>
	);
}

export function PrLevelComments({ entries }: PrLevelCommentsProps) {
	const comments = entries.filter(
		(entry): entry is Extract<PrActivityEntry, { kind: "comment" }> =>
			entry.kind === "comment" && entry.filePath === null,
	);

	if (comments.length === 0) return null;

	return (
		<section aria-label="Comments" className="border-b border-separator py-2">
			<h3 className="px-2 pb-1 text-sm font-medium text-fg">Comments</h3>
			<ul aria-label="Pull request comments" className="m-0 list-none space-y-2 p-0 px-2">
				{comments.map((comment) => (
					<li key={comment.id} className="flex items-start gap-2">
						<AuthorAvatar login={comment.authorLogin} avatarUrl={comment.authorAvatarUrl} />
						<div className="min-w-0 flex-1">
							<span className="block text-sm font-medium text-fg">{comment.authorLogin}</span>
							<p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">
								{comment.body}
							</p>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}
