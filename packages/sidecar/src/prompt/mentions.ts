/**
 * @feature SIDE-09 Prompt assembly: mentions
 * Owns: the text form of "@" file mentions and "#" pull-request mentions inside a message, and
 * their expansion into what the agent reads.
 * Behaviour: research/conductor/sessions.md section 9 "Message enrichment" and claude-runner.md
 * section 5 item 4 (file mentions are resolved to paths; a pull-request mention becomes a link to a
 * stub file `.context/pull-requests/<n>.md` that is written once and never overwritten).
 * Must handle: several mentions in one message, a mention at the start or end, a path that
 * contains spaces, text that only looks like a mention (an unterminated token stays as typed),
 * the same pull request mentioned twice (one stub), and a stub that already exists (kept, because
 * the agent may have added notes).
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
}

/** Where the stub for a pull request lives, relative to the workspace folder. */
export function pullRequestStubPath(number: number): string {
	return `.context/pull-requests/${number}.md`;
}

export function expandMentions(text: string): ExpandedMentions {
	const seen = new Set<number>();
	const pullRequests: PullRequestMention[] = [];
	const expanded = text.replace(MENTION_TOKEN, (token, kind: string, value: string) => {
		if (kind === "file") {
			return value === "" ? token : value;
		}
		const number = Number(value);
		if (!Number.isInteger(number) || number <= 0) return token;
		if (!seen.has(number)) {
			seen.add(number);
			pullRequests.push({ number });
		}
		return `[pull request ${number}](${pullRequestStubPath(number)})`;
	});
	return { text: expanded, pullRequests };
}
