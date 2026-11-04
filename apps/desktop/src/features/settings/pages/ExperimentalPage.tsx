/**
 * @feature SET-02 Experimental settings page
 * Owns: the Experimental page of Settings: switches for features that are still changing.
 * Behaviour: ui-map.md 6, "Experimental" table; services-map.md 4.1.5 and 4.2.3 (experimental
 * keys). Left out as cloud or team: "Pokes", "Show agent cost" (cloud workspaces),
 * "Use default internal and experimental settings", and the Internal group.
 * Rows (our wording), key, toggle unless noted:
 *   Auto permission mode          experimental_auto_permission_mode
 *   Big terminal mode             experimental_big_terminal_mode, with big_terminal_preset
 *                                 (select) and big_terminal_custom_commands (text)
 *   Full-page new workspace       experimental_new_workspace_page
 *   More tabs per workspace       experimental_tab_freak_mode (up to 10)
 *   Split the center panel        experimental_configurable_center_panel
 *   Fork a chat to a new tab      experimental_fork_to_new_tab
 *   In-app browser preview        experimental_in_app_browser_preview
 *   Older file preview and edit   experimental_legacy_file_preview_and_editing
 *   Status matrix indicator       internal_workspace_status_matrix
 *   Add projects without GitHub   local_git_forge_enabled
 *   Start the default action      auto_run_after_setup (per repository, set on RepoScriptsPage)
 *   after setup
 *   Dashboard                     dashboard_enabled
 *   Voice dictation               voice_mode
 *   Sidebar resource usage        sidebar_resource_usage
 *   Sidebar transparency          experimental_sidebar_transparency (takes effect after restart)
 *   Graphite stack support        graphite_disabled (inverted: the switch means "enabled")
 * Must handle: a setting that needs a restart (says so and offers Restart), a setting that depends
 * on another (disabled with the reason, e.g. split tabs off while the center panel is locked), and
 * voice dictation unavailable on this Mac (row disabled with reason).
 * Test first: turning on "Sidebar transparency" shows the restart note.
 */
import { notImplemented } from "@conducted/shared";

export function ExperimentalPage(): never {
	return notImplemented("SET-02");
}
