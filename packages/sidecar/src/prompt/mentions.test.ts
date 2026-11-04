import { expect, test } from "bun:test";
import { expandMentions, formatFileMention, formatPullRequestMention } from "./mentions.ts";

test("file and pull-request tokens expand, and each pull request is listed once", () => {
	const input = `fix ${formatFileMention("src/a b.ts")} and ${formatPullRequestMention(12)} (${formatPullRequestMention(12)})`;
	const out = expandMentions(input);
	expect(out.text).toBe(
		"fix src/a b.ts and [pull request 12](.context/pull-requests/12.md) ([pull request 12](.context/pull-requests/12.md))",
	);
	expect(out.pullRequests).toEqual([{ number: 12 }]);
});

test("text that only looks like a mention stays as typed", () => {
	const out = expandMentions("see ⟦pr:abc⟧ and ⟦file:⟧ and ⟦pr:5");
	expect(out.text).toBe("see ⟦pr:abc⟧ and ⟦file:⟧ and ⟦pr:5");
	expect(out.pullRequests).toEqual([]);
});
