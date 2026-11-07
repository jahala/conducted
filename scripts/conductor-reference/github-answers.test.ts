import { describe, expect, test } from "bun:test";
import { ghVariables, jq, jqOutput, parseDocument, prune } from "./github-answers.ts";

const QUERY = `
fragment PrFields on PullRequest { number title reviewRequests(first: 20) { totalCount nodes { login } } }
query($owner: String!, $repo: String!, $hasPrNumber0: Boolean!) {
	repository(owner: $owner, name: $repo) {
		viewerPermission
		pr0ByBranch: pullRequests(first: 5) @skip(if: $hasPrNumber0) { nodes { ...PrFields } }
		pr0ByNumber: pullRequest(number: 1) @include(if: $hasPrNumber0) { ...PrFields }
		... on Repository { name }
	}
	rateLimit { cost }
}`;

const WORLD = {
	repository: {
		viewerPermission: "WRITE",
		squashMergeAllowed: true,
		name: "atlas",
		pr0ByBranch: {
			nodes: [
				{ number: 7, title: "Fix", body: "unasked", reviewRequests: { nodes: [{ login: "lee" }] } },
			],
		},
		pr0ByNumber: null,
	},
	viewer: { login: "sam" },
	rateLimit: { cost: 1, remaining: 4990 },
};

describe("prune", () => {
	test("answers exactly the selection, by alias, through fragments and directives", () => {
		const document = parseDocument(QUERY);
		expect(prune(WORLD, document.operation, document, { hasPrNumber0: false })).toEqual({
			repository: {
				viewerPermission: "WRITE",
				pr0ByBranch: {
					nodes: [
						{
							number: 7,
							title: "Fix",
							reviewRequests: { totalCount: 1, nodes: [{ login: "lee" }] },
						},
					],
				},
				name: "atlas",
			},
			rateLimit: { cost: 1 },
		});
		const byNumber = prune(WORLD, document.operation, document, { hasPrNumber0: true }) as {
			repository: Record<string, unknown>;
		};
		expect(Object.keys(byNumber.repository)).toEqual(["viewerPermission", "pr0ByNumber", "name"]);
	});
});

describe("ghVariables", () => {
	test("types -F values and keeps -f values as text", () => {
		expect(
			ghVariables([
				"api",
				"graphql",
				"-F",
				"n=3",
				"-F",
				"b=true",
				"-f",
				"s=3",
				"-f",
				"query={ a }",
			]),
		).toEqual({ query: "{ a }", variables: { n: 3, b: true, s: "3" } });
	});
});

describe("jq", () => {
	test("reads paths and builds arrays, and prints as gh does", () => {
		const input = { data: { repository: { a: true, b: false } }, login: "sam" };
		expect(jq("[.data.repository.a, .data.repository.b]", input)).toEqual([[true, false]]);
		expect(jqOutput(jq(".login", input) ?? [])).toBe("sam\n");
		expect(jq(".missing.deeper", input)).toEqual([null]);
		expect(jq("map(.x)", input)).toBeNull();
	});
});
