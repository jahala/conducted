/**
 * @feature SET-07 Repository Scripts page
 * Owns: the per-repository Scripts page: the setup script, the archive script, the run mode, and
 * auto-run after setup.
 * Behaviour: ui-map.md 6, "Scripts (repo)" and "Scripts page" (Setup script runs when a workspace
 * is created; Archive script runs before archiving; run mode); services-map.md 5A.1.1 to 5A.1.4
 * (three kinds of script, run_script_mode concurrent or exclusive, shared file read-only).
 * Left out: the conductor.json migration banner (our files start in the new format).
 * Data: useRepoConfig(repoId), useActions().projects.updateConfig(repoId, config).
 * Rows (our wording), RepoConfig field, control:
 *   Setup script                  setupScript                  multi-line code field
 *   Archive script                archiveScript                multi-line code field
 *   Run mode                      runMode                      select: runs may overlap across
 *                                                              workspaces, or only one workspace runs
 *   Start the default action      (proposed field              toggle
 *   after setup                   autoRunAfterSetup)
 * Our design choice: edits are saved to the personal settings file. Values that come from the
 * shared, committed file show as read-only with "Edit the file in your repository".
 * Must handle: loading and error, a value set in the shared file (read-only with its source), an
 * unsaved edit when navigating away (save on blur, no data loss), a save that fails (text kept),
 * and a script containing `$VARIABLE` names (the list of variables the app provides is shown as
 * help).
 * Test first: editing the setup script and blurring calls updateConfig with the new setupScript and
 * every other field unchanged.
 */
import type { RepoId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function RepoScriptsPage(_props: { repoId: RepoId }): never {
	return notImplemented("SET-07");
}
