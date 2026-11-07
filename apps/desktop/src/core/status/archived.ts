/**
 * @feature WS-06 Unarchive
 * Owns: the one rule for whether a workspace is archived, `isArchivedWorkspace`.
 * Behaviour: services-map.md 2.3.1 and 3.10 (unarchive moves the row to `initializing` before the
 * restored worktree exists, and only the finished restore clears `archived_at`).
 * Our design choice: `state` is the one home of archived-ness. `archived_at` is only the time the
 * archive finished, kept for the lifetime and checkpoint jobs (DATA-02, DATA-06), never a second
 * flag. A workspace being restored is `initializing` while `archived_at` still holds the old time,
 * and it is not archived on any screen.
 * Test first: a workspace being restored is not archived.
 */
import type { Workspace } from "../model.ts";

/** True when the workspace's state is `archived`. The archived time does not decide this. */
export function isArchivedWorkspace(workspace: Pick<Workspace, "state">): boolean {
	return workspace.state === "archived";
}
