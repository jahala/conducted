/**
 * @feature SIDE-09 Prompt assembly: mentions
 * Owns: the text form of "@" file mentions and "#" pull-request mentions inside a message, their
 * expansion into what the agent reads, and the stub path a pull-request mention points at.
 * Behaviour: research/conductor/sessions.md section 9 "Message enrichment" and claude-runner.md
 * section 5 item 4 (file mentions are resolved to paths; a pull-request mention becomes a link to
 * a stub file `.context/pull-requests/<n>.md`).
 * Must handle: several mentions in one message, a mention at the start or end, a path that
 * contains spaces, text that only looks like a mention (an unterminated token stays as typed), and
 * the same pull request mentioned twice (one link, listed once).
 * Test first: expandMentions("fix ⟦file:src/a b.ts⟧ and ⟦pr:12⟧") replaces the file token with
 * `src/a b.ts` and the pr token with a link to .context/pull-requests/12.md, and lists pr 12.
 * The token syntax itself lives in @conducted/protocol (mentions.ts), shared with the composer.
 */
import { MENTION_TOKEN } from "@conducted/protocol";

export { formatFileMention, formatPullRequestMention } from "@conducted/protocol";

export interface PullRequestMention {
	number: number;
}

export interface ExpandedMentions {
	text: string;
	pullRequests: PullRequestMention[];
	/** Paths named by valid file tokens, in order, once each. */
	filePaths: string[];
}

/** Where the stub for a pull request lives, relative to the workspace folder. */
export function pullRequestStubPath(number: number): string {
	return `.context/pull-requests/${number}.md`;
}

export function expandMentions(text: string): ExpandedMentions {
	const seenPullRequests = new Set<number>();
	const seenFiles = new Set<string>();
	const pullRequests: PullRequestMention[] = [];
	const filePaths: string[] = [];
	const expanded = text.replace(MENTION_TOKEN, (token, kind: string, value: string) => {
		if (kind === "file") {
			if (value === "") return token;
			if (!seenFiles.has(value)) {
				seenFiles.add(value);
				filePaths.push(value);
			}
			return value;
		}
		const number = Number(value);
		if (!Number.isInteger(number) || number <= 0) return token;
		if (!seenPullRequests.has(number)) {
			seenPullRequests.add(number);
			pullRequests.push({ number });
		}
		return `[pull request ${number}](${pullRequestStubPath(number)})`;
	});
	return { text: expanded, pullRequests, filePaths };
}

/** The file paths named by mentions inside a text, such as a review-comment attachment. */
export function fileMentionPaths(text: string): string[] {
	return expandMentions(text).filePaths;
}
