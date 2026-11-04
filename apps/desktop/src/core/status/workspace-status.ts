/**
 * @feature WS-09 Workspace status as a pure function
 * Owns: the one rule that turns lifecycle, chat states and git state into the status the sidebar
 * dot, the Home card and the tabs show.
 * Behaviour: ui-map.md 3.8 (workspace status model: priority order, labels, sidebar subtitles).
 * Must handle: priority from first to last is lifecycle (initializing, setting up, failed,
 * archiving), then agent states in the order needs plan review, needs permission, needs answer,
 * working, cancelling, waiting, then git states in the order merged, in merge queue, ready to
 * merge, draft PR, merge conflict, checks failing, checks running, PR open, changes, clean; the
 * most urgent chat decides when several chats differ; closed chats do not count; an archived
 * workspace has no status (null); `waiting` means idle with background tasks; `cancelling` is
 * the app's own flag for a chat whose cancel is not confirmed yet; missing git state (not loaded
 * yet) yields no git label and never "clean".
 * Our design choice: the function takes plain values and returns a value. It reads no store, so
 * the sidebar, Home and tabs call it with the same inputs and always agree. Ready to merge means
 * an open PR, mergeable, review not blocking, and no failing or pending checks.
 * Test first: a workspace with one working chat and a merged PR shows "working", not "merged".
 */
import type { LiveState } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { GitState, Workspace, WorkspaceStatus } from "../model.ts";

export interface ChatStatusInput {
	liveState: LiveState;
	/** The app asked to cancel and the sidecar has not confirmed. */
	cancelling: boolean;
	closed: boolean;
}

export interface WorkspaceStatusInput {
	state: Workspace["state"];
	/** The setup script is running (in memory, not stored). */
	settingUp: boolean;
	chats: readonly ChatStatusInput[];
	/** Null while git state has not loaded. */
	git: GitState | null;
}

/** Returns null for an archived workspace. */
export function deriveWorkspaceStatus(_input: WorkspaceStatusInput): WorkspaceStatus | null {
	return notImplemented("WS-09");
}
