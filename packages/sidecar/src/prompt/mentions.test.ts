import { describe, expect, test } from "bun:test";
import {
	buildPullRequestStub,
	expandMentions,
	fileMentionPaths,
	formatFileMention,
	formatPullRequestMention,
} from "./mentions.ts";

describe("SIDE-09 mentions", () => {
	test("file and pull-request tokens expand, and each pull request is listed once", () => {
		const input = `fix ${formatFileMention("src/a b.ts")} and ${formatPullRequestMention(12)} (${formatPullRequestMention(12)})`;
		const out = expandMentions(input);
		expect(out.text).toBe(
			"fix src/a b.ts and [pull request 12](.context/pull-requests/12.md) ([pull request 12](.context/pull-requests/12.md))",
		);
		expect(out.pullRequests).toEqual([{ number: 12 }]);
		expect(out.filePaths).toEqual(["src/a b.ts"]);
	});

	test("text that only looks like a mention stays as typed", () => {
		const out = expandMentions("see ⟦pr:abc⟧ and ⟦file:⟧ and ⟦pr:5");
		expect(out.text).toBe("see ⟦pr:abc⟧ and ⟦file:⟧ and ⟦pr:5");
		expect(out.pullRequests).toEqual([]);
		expect(out.filePaths).toEqual([]);
	});

	test("file mentions inside a review comment are found, once each", () => {
		const comment = `See ${formatFileMention("src/a.ts")} and ${formatFileMention("src/a.ts")}.`;
		expect(fileMentionPaths(comment)).toEqual(["src/a.ts"]);
	});

	test("a pull-request stub has a heading and, when known, its GitHub URL", () => {
		expect(buildPullRequestStub(12)).toBe("# Pull request #12\n");
		expect(buildPullRequestStub(12, "acme/app")).toBe(
			"# Pull request #12\n\nGitHub URL: https://github.com/acme/app/pull/12\n",
		);
	});
});
