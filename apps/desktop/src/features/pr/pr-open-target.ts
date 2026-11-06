/**
 * @feature PR-07 Where a pull request opens
 * Owns: the one rule for the address a pull request opens at, from the setting "Open pull requests
 * in" (GitHub, Linear or Graphite), and the menu label for each choice.
 * Behaviour: ui-map.md 6 ("Git: 'Open pull requests in'"), 6.x ("Open pull requests in": GitHub,
 * Linear, Graphite); services-map.md 4.2 (`pull_request_open_target`, default github). The two
 * address forms (linear.review with the GitHub path, app.graphite.com/github/pr/<owner>/<repo>/<n>)
 * and the labels "Open in GitHub", "Open in Linear" and "Open in Graphite" are from Conductor's
 * frontend bundle.
 * Must handle: an address that is not on github.com (opened as it is, whatever the setting); an
 * unknown setting value (GitHub, the setting's default).
 * Test first: a GitHub pull request address opens at app.graphite.com when the target is Graphite.
 */

export const PULL_REQUEST_OPEN_TARGETS = ["github", "linear", "graphite"] as const;
export type PullRequestOpenTarget = (typeof PULL_REQUEST_OPEN_TARGETS)[number];

const GITHUB = "https://github.com/";

/** The setting's value as a target; anything else is GitHub, the setting's default. */
export function openTargetOf(value: unknown): PullRequestOpenTarget {
	return PULL_REQUEST_OPEN_TARGETS.find((target) => target === value) ?? "github";
}

/** Where a pull request opens for the chosen target. Only GitHub addresses are rewritten. */
export function pullRequestOpenUrl(prUrl: string, target: PullRequestOpenTarget): string {
	if (!prUrl.startsWith(GITHUB)) return prUrl;
	switch (target) {
		case "github":
			return prUrl;
		case "linear":
			return `https://linear.review/${prUrl.slice(GITHUB.length)}`;
		case "graphite":
			return prUrl.replace(
				/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/,
				"https://app.graphite.com/github/pr/$1/$2/$3",
			);
	}
}

export function openTargetLabel(target: PullRequestOpenTarget): string {
	switch (target) {
		case "github":
			return "Open in GitHub";
		case "linear":
			return "Open in Linear";
		case "graphite":
			return "Open in Graphite";
	}
}
