/**
 * @feature REV-13 Pull request comments without a file
 * Owns: the list in the PR tab of comments that sit on the pull request itself, not on a file or a line,
 * each with its author's avatar.
 * Behaviour: coverage/inventory-system-native-data.md (Conductor stores a comment on the pull request itself
 * with no file, id prefix `github-general-`, and keeps the author's avatar beside a GitHub comment);
 * services-map.md 3.7.4 (general comments come from `pullRequest.comments` and are upserted into diff
 * comments) and 5A.7 (the diff comment table). The model type is `DiffComment` in core/model.ts: its
 * `filePath` is null for these.
 * Data: useDiffComments(workspaceId) from core/hooks.ts, filtered to `filePath === null` and a GitHub
 * author. The caller passes the list so the PR tab loads it once.
 * Our design choice: these comments are read-only here. Replying and resolving stay in the Activity list
 * (PrActivityList), so one comment has one home. Order is oldest first, like the Activity list.
 * Must handle: no such comments (the section is hidden, not an empty box); an author without an avatar (a
 * letter on a neutral circle); an avatar that fails to load (the same letter); a comment hidden or
 * superseded (not shown); a very long body (collapsed with "Show more"); Markdown in the body (rendered
 * with the same renderer as chat text, links open outside the app); 500 comments (virtualised).
 * Test first: three comments, one with a file path, show two entries, and the file one is absent.
 */
import { notImplemented } from "@conducted/shared";
import type { DiffComment } from "../../core/model.ts";

export interface PrLevelCommentsProps {
	/** All comments of the workspace. The component keeps only those with no file. */
	comments: readonly DiffComment[];
}

export function PrLevelComments(_props: PrLevelCommentsProps): never {
	return notImplemented("REV-13");
}
