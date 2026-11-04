/**
 * @feature SET-07 Repository Actions page
 * Owns: the per-repository Actions page: the list of run actions (dev server, tests), and the
 * Spotlight switch.
 * Behaviour: ui-map.md 6, "Actions (repo)" and "Actions page" (custom actions list with Show or
 * Hide, Edit, Delete, Reset; empty "No custom actions yet. Add one to get started."; "Use spotlight
 * testing"); services-map.md 5A.1.6 (action fields; "Hide" for shared actions is per user and
 * stored locally, not in the file) and 5A.2 (Spotlight).
 * Data: useRepoConfig(repoId).runScripts, useActions().projects.updateConfig.
 * Children: ActionList, run/AddActionDialog (scripts-panel).
 * Our design choice: prompts for Review, Create PR and the others are on RepoPromptsPage, not here.
 * Must handle: no actions (designed empty state), an action defined in the shared file (read-only,
 * can be hidden for this user only), the default action marked and changed, deleting an action
 * that is running (asks to stop it first), Spotlight on with a dirty repository root (explained),
 * and unsaved dialog edits.
 * Test first: hiding a shared action stores it as hidden for the user and leaves the file unchanged.
 */
import type { RepoId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function RepoActionsPage(_props: { repoId: RepoId }): never {
	return notImplemented("SET-07");
}
