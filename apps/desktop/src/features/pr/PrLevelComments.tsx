/**
 * @feature REV-13 Pull request comments without a file
 * Owns: the list in the PR tab of comments that sit on the pull request itself, each with its
 * author's avatar, and the predicate that splits these comments from file comments.
 * Behaviour: services-map.md 3.7.4 and 5A.7.3 (general pull request comments come from
 * `pullRequest.comments`, carry the author's avatar, and have no file path; their ids come from
 * GitHub's `github-general-` mapper); ui-map.md 3.2 (the PR tab).
 * Data: the caller passes the PR activity entries; `isPrLevelComment` keeps the comment entries
 * whose file path is null. The PR tab shows those here instead of in the Activity list, so each
 * comment has one home.
 * Must handle: no such comments (the section is hidden, not an empty box); an author without an
 * avatar (a letter on a neutral circle); an avatar that fails to load (the same letter); a long
 * body (wraps).
 * Test first: three comments, one with a file path, show two entries, and the file one is absent.
 */
import type { PrActivityEntry } from "../../core/model.ts";
import { PrCommentContent } from "./PrActivityItem.tsx";

export interface PrLevelCommentsProps {
	/** The workspace's PR activity; this keeps the comment entries with no file. */
	entries: readonly PrActivityEntry[];
}

/** True when the entry is a comment on the pull request itself rather than on a file. */
export function isPrLevelComment(
	entry: PrActivityEntry,
): entry is Extract<PrActivityEntry, { kind: "comment" }> {
	return entry.kind === "comment" && entry.filePath === null;
}

export function PrLevelComments({ entries }: PrLevelCommentsProps) {
	const comments = entries.filter(isPrLevelComment);

	if (comments.length === 0) return null;

	return (
		<section aria-label="Comments" className="border-b border-separator py-2">
			<h3 className="px-2 pb-1 text-sm font-medium text-fg">Comments</h3>
			<ul aria-label="Pull request comments" className="m-0 list-none space-y-2 p-0 px-2">
				{comments.map((comment) => (
					<li key={comment.id} className="min-w-0">
						<PrCommentContent entry={comment} />
					</li>
				))}
			</ul>
		</section>
	);
}
