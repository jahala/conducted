/**
 * @feature PR-07 Where a pull request opens
 * Owns: tests for the address a pull request opens at, per "Open pull requests in".
 * Test first: a GitHub pull request address opens at app.graphite.com when the target is Graphite.
 */
import { describe, expect, it } from "vitest";
import { openTargetLabel, openTargetOf, pullRequestOpenUrl } from "./pr-open-target.ts";

const PR = "https://github.com/me/project/pull/12";

describe("PR-07 open pull requests in", () => {
	it("opens GitHub, Linear and Graphite addresses for a GitHub pull request", () => {
		expect(pullRequestOpenUrl(PR, "github")).toBe(PR);
		expect(pullRequestOpenUrl(PR, "linear")).toBe("https://linear.review/me/project/pull/12");
		expect(pullRequestOpenUrl(`${PR}/files`, "graphite")).toBe(
			"https://app.graphite.com/github/pr/me/project/12",
		);
	});

	it("opens an address that is not on github.com as it is", () => {
		const local = "https://git.example.com/me/project/pulls/3";
		expect(pullRequestOpenUrl(local, "graphite")).toBe(local);
	});

	it("reads an unknown setting as GitHub and labels each target", () => {
		expect(openTargetOf("graphite")).toBe("graphite");
		expect(openTargetOf("bitbucket")).toBe("github");
		expect(openTargetOf(undefined)).toBe("github");
		expect(openTargetLabel("linear")).toBe("Open in Linear");
	});
});
