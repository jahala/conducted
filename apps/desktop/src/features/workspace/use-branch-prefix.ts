/**
 * @feature NAV-10 Branch prefix for display
 * Owns: the user's current branch prefix, which workspace names and the header drop from a branch.
 * Behaviour: Conductor's renderApp reads the prefix from the Git settings: the custom text, or the
 * GitHub username followed by "/", or none (ui-map.md 6, "Branch name prefix").
 * Data: useSetting for `branch_prefix_type` and `branch_prefix_custom`, useGitHubAccess for the
 * signed-in GitHub login; branchPrefixFor is the same rule new branches are named by.
 * Must handle: signed out of GitHub with the username prefix (no prefix, so nothing is dropped).
 * Test first: a workspace row on "sam/fix-login" is named "Fix login" while the GitHub login is sam.
 */
import { useGitHubAccess, useSetting } from "../../core/hooks.ts";
import { branchPrefixFor } from "../../core/workspace-helpers.ts";

export function useBranchPrefix(): string {
	const type = useSetting<string>("branch_prefix_type");
	const custom = useSetting<string>("branch_prefix_custom");
	const access = useGitHubAccess();
	const login =
		access.state === "ready" && access.data.state === "signed_in" ? access.data.login : null;
	return branchPrefixFor(type, custom, login);
}
