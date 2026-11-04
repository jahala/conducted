/**
 * @feature SET-02 Account settings page
 * Owns: the Account page of Settings, local parts only: GitHub access through the `gh` command,
 * the Linear connection, and tool approval modes.
 * Behaviour: ui-map.md 6, "Account" table and "Account page" (GitHub via `gh` CLI auth or a
 * personal access token; Linear; tool approvals). Left out: Conductor account, billing, display
 * name and photo, sign out, enterprise data privacy (they belong to the hosted service).
 * Rows (our wording), key, control:
 *   GitHub access                 gh_auth_method               status line from `gh auth status`:
 *                                                              installed, signed-in user and host
 *   Personal access token         gh_pat_token (Keychain)      password field, optional fallback
 *                                                              (never shown after saving)
 *   Linear connection             (key set by SET-01)          API key field (Keychain), status
 *   Claude Code tool approvals    tool_approvals_enabled       toggle: ask before agents run tools
 *   Codex tool approvals          codex_tool_approval_policy   select: default, always approve
 * Data: useGitHubAccess() for the GitHub status and useActions().app.recheckGitHubAccess for
 * "Check again". Settings through useSetting and useActions().settings.
 * Our design choice: the page never starts `gh auth login` itself because it is interactive; it
 * shows the command with a copy button and a "Check again" action.
 * Must handle: `gh` not installed (how to install, link), signed out, signed in to several hosts,
 * a token that fails validation (message, token not saved), the Keychain refusing access, offline
 * (status unknown, not "signed out"), and secrets never appearing in logs or the UI after save.
 * Test first: with `gh` not installed the page shows the install help and no sign-in command.
 */
import { notImplemented } from "@conducted/shared";

export function AccountPage(): never {
	return notImplemented("SET-02");
}
