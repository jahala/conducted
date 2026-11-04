/**
 * @feature NAV-10 Which tab is open
 * Owns: turning the workspace route's search params into the one tab the centre shows, and a key that changes
 * when the tab changes.
 * Behaviour: ui-map.md 2 (search params carry the active tab type and its id), 3.2 (tab types and tab content).
 * Our design choice: a file tab without `scope` opens the whole branch's changes in diff mode. A tab whose id
 * is missing (a terminal tab without a terminal id) is "none", which shows the empty tab group instead of a
 * broken tab. A missing `tab` is also "none": restoring the last tab is NAV-02's job, done before this runs.
 * Must handle: unknown scope text (falls back to the branch scope); line numbers on non-file tabs are ignored;
 * the same search always gives the same key.
 * Test first: { tab: "file", path: "a.ts" } gives a file tab in diff mode on the branch scope; { tab: "terminal" }
 * without an id gives none.
 */
import type { CommentId, SessionId, TerminalId } from "@conducted/shared";
import type { DiffScope } from "../../core/api.ts";
import { parseDiffScope, type WorkspaceSearch } from "./workspace-search.ts";

export type ActiveTab =
	| { kind: "session"; sessionId: SessionId }
	| { kind: "terminal"; terminalId: TerminalId }
	| { kind: "file"; path: string; mode: "diff" | "edit"; scope: DiffScope; line: number | null }
	| { kind: "comment"; commentId: CommentId }
	| { kind: "pr" }
	| { kind: "browser"; url: string }
	| { kind: "none" };

export function resolveActiveTab(search: WorkspaceSearch): ActiveTab {
	switch (search.tab) {
		case "session":
			return search.sessionId
				? { kind: "session", sessionId: search.sessionId as SessionId }
				: { kind: "none" };
		case "terminal":
			return search.terminalId
				? { kind: "terminal", terminalId: search.terminalId as TerminalId }
				: { kind: "none" };
		case "file":
			return search.path
				? {
						kind: "file",
						path: search.path,
						mode: search.fileMode ?? "diff",
						scope: (search.scope ? parseDiffScope(search.scope) : null) ?? { kind: "branch" },
						line: search.line ?? null,
					}
				: { kind: "none" };
		case "comment":
			return search.commentId
				? { kind: "comment", commentId: search.commentId as CommentId }
				: { kind: "none" };
		case "pr":
			return { kind: "pr" };
		case "browser":
			return search.browserUrl ? { kind: "browser", url: search.browserUrl } : { kind: "none" };
		case undefined:
			return { kind: "none" };
	}
}

/** Changes when a different tab is open. A failed tab uses it to try again. */
export function activeTabKey(tab: ActiveTab): string {
	switch (tab.kind) {
		case "session":
			return `session:${tab.sessionId}`;
		case "terminal":
			return `terminal:${tab.terminalId}`;
		case "file":
			return `file:${tab.path}`;
		case "comment":
			return `comment:${tab.commentId}`;
		case "browser":
			return `browser:${tab.url}`;
		case "pr":
		case "none":
			return tab.kind;
	}
}
