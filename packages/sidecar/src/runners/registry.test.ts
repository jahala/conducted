import { expect, test } from "bun:test";
import { MapRunnerRegistry } from "./registry.ts";
import type { Runner } from "./runner.ts";

const fake = (name: string) => ({ agent: "acp", name }) as unknown as Runner;

test("an ACP selector finds the runner of its adapter, and a missing adapter is an error", () => {
	const pi = fake("pi");
	const registry = new MapRunnerRegistry([
		{ selector: { agent: "acp", acpAgent: "opencode" }, runner: fake("opencode") },
		{ selector: { agent: "acp", acpAgent: "pi" }, runner: pi },
	]);
	const found = registry.get({ agent: "acp", acpAgent: "pi" });
	expect(found.ok && found.value).toBe(pi);
	const missing = registry.get({ agent: "acp" });
	expect(!missing.ok && missing.error.code).toBe("acp_agent_missing");
});

test("an unregistered agent is an error value", () => {
	const registry = new MapRunnerRegistry([]);
	const result = registry.get({ agent: "claude" });
	expect(!result.ok && result.error.code).toBe("runner_unknown");
});

test("registering one selector twice is refused", () => {
	const entry = { selector: { agent: "claude" as const }, runner: fake("c") };
	expect(() => new MapRunnerRegistry([entry, entry])).toThrow("registered twice");
});
