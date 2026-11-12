/**
 * @feature PR-01 GitHub access
 * Owns: tests for the two notifications Conductor raises when GitHub refuses a sign-in.
 * Test first: a rejected personal access token answers its own title and action.
 */
import { describe, expect, it } from "vitest";
import {
	GITHUB_TOKEN_REJECTED_MESSAGE,
	GITHUB_UNAUTHORIZED_MESSAGE,
	githubUnauthorizedNotice,
} from "./github-text.ts";

describe("PR-01 unauthorized sign-in notices", () => {
	it("names the expired gh sign-in and offers to reconnect", () => {
		expect(githubUnauthorizedNotice("cli")).toEqual({
			title: "GitHub sign-in expired",
			description: GITHUB_UNAUTHORIZED_MESSAGE,
			action: "Reconnect",
		});
	});

	it("names the rejected personal access token and opens account settings", () => {
		expect(githubUnauthorizedNotice("pat")).toEqual({
			title: "GitHub token rejected",
			description: GITHUB_TOKEN_REJECTED_MESSAGE,
			action: "Open account settings",
		});
	});
});
