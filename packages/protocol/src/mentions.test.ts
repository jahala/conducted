import { expect, test } from "bun:test";
import { formatFileMention, formatPullRequestMention, MENTION_TOKEN } from "./mentions.ts";

test("formatted mentions are found by the token pattern, paths with spaces included", () => {
	const text = `fix ${formatFileMention("src/a b.ts")} for ${formatPullRequestMention(12)}`;
	const found = [...text.matchAll(MENTION_TOKEN)].map((m) => [m[1], m[2]]);
	expect(found).toEqual([
		["file", "src/a b.ts"],
		["pr", "12"],
	]);
});
