// @vitest-environment node
/**
 * @feature PR-10 Link a pull request by URL or number
 * Owns: the command runner test that `pr.link` needs a workspace but not an open pull request,
 * because linking is how a workspace gets its first pull request.
 * Behaviour: ui-map.md 3.10 (the Link pull request command opens from the workspace).
 * Test first: with a workspace and no open PR, `pr.link` is enabled.
 */
import { describe, expect, it } from "vitest";
import { CommandRunner, commandRequirement } from "./command-runner.ts";

describe("PR-10 link command requirement", () => {
	it("needs a workspace but not an open pull request", () => {
		expect(commandRequirement("pr.link")).toBe("hasWorkspace");
	});

	it("is enabled with a workspace and no open pull request", () => {
		const runner = new CommandRunner({
			handlers: () => ({ "pr.link": async () => ({ ok: true, value: undefined }) }),
			context: () => ({ hasWorkspace: true, hasOpenPr: false, hasOpenChat: false }),
		});

		expect(runner.isEnabled("pr.link")).toBe(true);
	});
});
