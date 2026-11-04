/**
 * @feature SET-02 Git settings page
 * Owns: the Git page of Settings: user-wide defaults for branches, pull requests and archiving.
 * Per-repository overrides are on the repository Misc page (RepoMiscPage).
 * Behaviour: ui-map.md 6, "Git" table. Left out: "Git identity" (used for cloud workspaces only).
 * Rows (our wording), key, control, scope:
 *   Branch name prefix            branch_prefix_type,          select: GitHub username (with
 *                                 branch_prefix_custom         preview), custom text, none; user
 *   Rename new branches           auto_rename_new_branches     toggle; user
 *   Rename workspace when the     auto_rename_workspace_on_    toggle; user
 *   branch gets a name            branch_name_set
 *   Open pull requests in         pull_request_open_target     select: GitHub, Linear, Graphite; user
 *   Link the workspace in the PR  (key set by SET-01)          toggle; user
 *   description
 *   Delete branch on archive      delete_branch_on_archive     toggle; user and repository
 *   Archive when the PR merges    archive_on_merge             toggle; user and repository
 *   Show auto-merge               automerge_enabled            toggle (needs auto-merge allowed on
 *                                                              the GitHub repository)
 *   Optional checks block merge   treat_optional_checks_       toggle
 *                                 as_blocking
 *   Set upstream on plain push    worktree_push_auto_          toggle; user and repository
 *                                 setup_remote
 *   Use GitHub stacked PRs        github_stacked_prs_enabled   toggle
 * Must handle: the branch prefix preview needing the GitHub username (shows a hint when `gh` is
 * signed out), a custom prefix with spaces or a trailing slash missing (validated, with the
 * resulting branch name shown), and a toggle that only applies to future workspaces saying so.
 * Test first: choosing "Custom" with the text "feature/" shows the preview "feature/<name>".
 */
import { notImplemented } from "@conducted/shared";

export function GitPage(): never {
	return notImplemented("SET-02");
}
