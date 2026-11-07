/**
 * @feature CLOUD-05 Secrets stay outside the sandbox: the outbound handler swaps in the model key and GitHub token
 * Tests the environment every sandbox command starts with: the GH_TOKEN placeholder the Worker
 * replaces, and the scrub that makes git ignore the user's config, prompts and hooks and rewrite
 * GitHub SSH remotes to HTTPS. Also checks the container environment carries it and no model key.
 */
import { describe, expect, it } from "vitest";
import { gitConfigEnvironment, SANDBOX_GIT_ENV } from "./sandbox-git-env.ts";
import { CONTAINER_ENV } from "./workspace.ts";

describe("CLOUD-05 the sandbox's git environment", () => {
	it("holds only the placeholder token and rewrites GitHub SSH remotes to HTTPS", () => {
		const env = { ...SANDBOX_GIT_ENV };
		expect(env.GH_TOKEN).toBe("provided-by-worker");
		expect(env.GH_TOKEN).toMatch(/^provided-by-worker$/);
		expect(env.GIT_TERMINAL_PROMPT).toBe("0");
		expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
		expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
		expect(env.GIT_CONFIG_COUNT).toBe(
			String(Object.keys(env).filter((name) => name.startsWith("GIT_CONFIG_KEY_")).length),
		);
		const pairs = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, index) => [
			env[`GIT_CONFIG_KEY_${index}`],
			env[`GIT_CONFIG_VALUE_${index}`],
		]);
		expect(pairs).toContainEqual(["url.https://github.com/.insteadOf", "git@github.com:"]);
		expect(pairs).toContainEqual(["url.https://github.com/.insteadOf", "ssh://git@github.com/"]);
		expect(pairs).toContainEqual(["credential.helper", ""]);
		expect(pairs).toContainEqual(["credential.https://github.com.helper", ""]);
		expect(pairs).toContainEqual(["core.hooksPath", "/dev/null"]);
	});

	it("numbers the git config pairs from zero for whatever list it is given", () => {
		const built = gitConfigEnvironment([["a.b", "c"]]);
		expect(built).toEqual({
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "a.b",
			GIT_CONFIG_VALUE_0: "c",
		});
		expect(gitConfigEnvironment([])).toEqual({ GIT_CONFIG_COUNT: "0" });
	});

	it("puts the scrub and the placeholder in the container environment, with no model key", () => {
		expect(Object.keys(SANDBOX_GIT_ENV).length).toBeGreaterThan(0);
		const container = { ...CONTAINER_ENV };
		for (const [name, value] of Object.entries(SANDBOX_GIT_ENV)) {
			expect(container[name]).toBe(value);
		}
		expect(container.ANTHROPIC_API_KEY).toBeUndefined();
		expect(container.OPENAI_API_KEY).toBeUndefined();
		expect(container.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
	});
});
