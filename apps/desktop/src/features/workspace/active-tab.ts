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
import type { TabDescriptor } from "./tab-layout.ts";
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

/** The one ref string a tab is named by. No tab open has no ref. */
export function tabRef(tab: ActiveTab): string | null {
	switch (tab.kind) {
		case "session":
			return `session:${tab.sessionId}`;
		case "terminal":
			return `terminal:${tab.terminalId}`;
		case "file":
			return `file:${tab.path}`;
		case "comment":
			return `comment:${tab.commentId}`;
		case "pr":
			return "pr";
		case "browser":
			return `browser:${tab.url}`;
		case "none":
			return null;
	}
}

/** Changes when a different tab is open. A failed tab uses it to try again. */
export function activeTabKey(tab: ActiveTab): string {
	return tabRef(tab) ?? "none";
}

/** The inverse of the descriptor: a split pane opens the tab the strip found. */
export function activeTabFromDescriptor(tab: TabDescriptor): ActiveTab {
	switch (tab.kind) {
		case "session":
			return tab.sessionId === undefined
				? { kind: "none" }
				: { kind: "session", sessionId: tab.sessionId };
		case "terminal":
			return tab.terminalId === undefined
				? { kind: "none" }
				: { kind: "terminal", terminalId: tab.terminalId };
		case "file":
			return {
				kind: "file",
				path: tab.ref.slice("file:".length),
				mode: tab.mode ?? "diff",
				scope: tab.scope ?? { kind: "branch" },
				line: tab.line ?? null,
			};
		case "comment":
			return { kind: "comment", commentId: tab.ref.slice("comment:".length) as CommentId };
		case "pr":
			return { kind: "pr" };
		case "browser":
			return { kind: "browser", url: tab.ref.slice("browser:".length) };
	}
}

/** The search params that open a tab. One inverse of resolveActiveTab. */
export function searchPatchFor(tab: ActiveTab): Partial<WorkspaceSearch> {
	switch (tab.kind) {
		case "session":
			return { tab: "session", sessionId: tab.sessionId };
		case "terminal":
			return { tab: "terminal", terminalId: tab.terminalId };
		case "file":
			return { tab: "file", path: tab.path };
		case "comment":
			return { tab: "comment", commentId: tab.commentId };
		case "pr":
			return { tab: "pr" };
		case "browser":
			return { tab: "browser", browserUrl: tab.url };
		case "none":
			return {
				tab: undefined,
				sessionId: undefined,
				terminalId: undefined,
				path: undefined,
				commentId: undefined,
				browserUrl: undefined,
			};
	}
}
