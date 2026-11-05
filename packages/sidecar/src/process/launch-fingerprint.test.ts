import { describe, expect, test } from "bun:test";
import type { AgentLaunch } from "@conducted/protocol";
import { decideLaunchChange, launchFingerprint } from "./launch-fingerprint.ts";

const launch = (over: Partial<AgentLaunch> = {}): AgentLaunch => ({
	executablePath: "/opt/claude",
	env: { FOO: "one", BAR: "two" },
	providerKeys: {
		ANTHROPIC_API_KEY: { value: "sk-ant-secret", source: "entered" },
		OPENAI_API_KEY: { value: "sk-openai-secret", source: "this_mac" },
	},
	provider: "bedrock",
	baseUrl: "https://example.test",
	...over,
});

describe("SIDE-21 launch fingerprint", () => {
	test("SIDE-21 two launches that differ only in environment key order have equal fingerprints", () => {
		const first = launch({ env: { FOO: "one", BAR: "two" } });
		const second = launch({ env: { BAR: "two", FOO: "one" } });

		expect(launchFingerprint(first)).toBe(launchFingerprint(second));
	});

	test("SIDE-21 two launches that differ only in provider key order have equal fingerprints", () => {
		const first = launch({
			providerKeys: {
				ANTHROPIC_API_KEY: { value: "a", source: "entered" },
				OPENAI_API_KEY: { value: "b", source: "entered" },
			},
		});
		const second = launch({
			providerKeys: {
				OPENAI_API_KEY: { value: "b", source: "entered" },
				ANTHROPIC_API_KEY: { value: "a", source: "entered" },
			},
		});

		expect(launchFingerprint(first)).toBe(launchFingerprint(second));
	});

	test("SIDE-21 a changed provider key value changes the fingerprint", () => {
		const before = launch();
		const after = launch({
			providerKeys: {
				ANTHROPIC_API_KEY: { value: "sk-ant-other", source: "entered" },
				OPENAI_API_KEY: { value: "sk-openai-secret", source: "this_mac" },
			},
		});

		expect(launchFingerprint(after)).not.toBe(launchFingerprint(before));
	});

	test("SIDE-21 a changed program path, environment, provider or base URL changes the fingerprint", () => {
		const before = launchFingerprint(launch());

		expect(launchFingerprint(launch({ executablePath: "/opt/other" }))).not.toBe(before);
		expect(launchFingerprint(launch({ env: { FOO: "changed", BAR: "two" } }))).not.toBe(before);
		expect(launchFingerprint(launch({ provider: "vertex" }))).not.toBe(before);
		expect(launchFingerprint(launch({ baseUrl: "https://other.test" }))).not.toBe(before);
	});

	test("SIDE-21 the fingerprint is a hash that never carries a secret, so it is safe to log", () => {
		const fingerprint = launchFingerprint(launch());

		expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(fingerprint).not.toContain("sk-ant-secret");
		expect(fingerprint).not.toContain("sk-openai-secret");
	});
});

describe("SIDE-21 what a launch change means", () => {
	test("SIDE-21 a first launch has nothing to restart", () => {
		expect(
			decideLaunchChange({
				previous: null,
				next: "abc",
				chatWorking: false,
				hasBackgroundTasks: false,
			}),
		).toBe("none");
	});

	test("SIDE-21 the same fingerprint never restarts, even while the chat works", () => {
		expect(
			decideLaunchChange({
				previous: "abc",
				next: "abc",
				chatWorking: true,
				hasBackgroundTasks: true,
			}),
		).toBe("none");
	});

	test("SIDE-21 a change on an idle chat restarts it now", () => {
		expect(
			decideLaunchChange({
				previous: "abc",
				next: "def",
				chatWorking: false,
				hasBackgroundTasks: false,
			}),
		).toBe("restart_now");
	});

	test("SIDE-21 a change during a turn restarts at the next turn", () => {
		expect(
			decideLaunchChange({
				previous: "abc",
				next: "def",
				chatWorking: true,
				hasBackgroundTasks: false,
			}),
		).toBe("restart_next_turn");
	});

	test("SIDE-21 a change while background tasks run restarts at the next turn", () => {
		expect(
			decideLaunchChange({
				previous: "abc",
				next: "def",
				chatWorking: false,
				hasBackgroundTasks: true,
			}),
		).toBe("restart_next_turn");
	});
});
