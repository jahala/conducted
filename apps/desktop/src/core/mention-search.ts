/**
 * @feature COMP-05 # PR and issue mentions
 * Owns: the row shape and limit of the composer's '#' menu, and the one rule for which GitHub
 * sign-in states stop GitHub from listing. These are the pure parts of the mention search; the
 * search and attach calls stay with the service.
 * Behaviour: ui-map.md 3.5 ('#': pull requests and issues), services-map.md 5B.8.2 (GitHub's open
 * issues).
 */
import type { GitHubAccess } from "./model.ts";

export interface PrMentionItem {
	kind: "pull_request" | "issue";
	provider: "github" | "linear";
	/** The pull request or GitHub issue number; null for a Linear issue. */
	number: number | null;
	/** What the user sees: "#12" or "ENG-12". */
	identifier: string;
	title: string;
	/** The item's web address, when its source reports one. */
	url?: string;
	/** The provider's id, for attaching an issue. */
	id: string;
}

export interface PrMentionSearchResult {
	items: readonly PrMentionItem[];
	/** One line above the rows when a source is unavailable but another can answer. */
	notice?: string;
}

/** At most this many rows show in the '#' menu. */
export const PR_MENTION_LIMIT = 20;

/** What has to happen before GitHub can list anything, or null when it can be asked. */
export type GitHubSetupNeeded = "gh_missing" | "signed_out" | "offline";

/** The one rule for which GitHub sign-in states stop a list (the '#' menu and Link issue). */
export function githubSetupNeeded(access: GitHubAccess): GitHubSetupNeeded | null {
	switch (access.state) {
		case "gh_missing":
		case "signed_out":
			return access.state;
		case "unknown":
			return access.reason === "offline" ? "offline" : null;
		case "signed_in":
			return null;
	}
}
