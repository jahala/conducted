/**
 * @feature SIDE-21 Agent settings reach the sidecar: the desktop composition root's launch;
 * AGENT-16 the chat options the settings offer
 * Owns: proof that the real container reads the saved program path, provider, region, Environment
 * variables and provider keys and sends them in a chat's launch, that a launch it cannot build
 * fails the send with the reason, and that a new chat's options come from settings.
 * Behaviour: apps/desktop/src/core/container.ts (launchFor, defaultConfig), core/lookups.ts
 * (defaultSessionConfig), core/services/sessions.ts (sendMessage).
 * Test first: this file.
 * Our design choice: the sidecar transport is the memory Platform's scripted seam. It answers the
 * sendMessage line at once, so the test never waits on a timer.
 */
import { randomUUID } from "node:crypto";
import type { SessionConfig } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";
import { createRepositories } from "./db/repositories.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

interface SentLine {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params: {
		config?: SessionConfig;
		launch?: {
			executablePath?: string;
			provider?: string;
			env: Record<string, string>;
			providerKeys: Record<string, { value: string; source: string }>;
		};
	};
}

/** Answers every sendMessage at once and keeps the last one the container sent. */
function captureSends(test: TestContainer): { last(): SentLine | null } {
	const transport = test.memory.platform.sidecar;
	const originalSend = transport.send.bind(transport);
	let sent: SentLine | null = null;
	transport.send = async (line) => {
		const answered = await originalSend(line);
		const parsed = JSON.parse(line) as SentLine;
		if (parsed.method === "sendMessage") {
			sent = parsed;
			queueMicrotask(() =>
				test.memory.controls.emitSidecarLine(
					JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { deliveredAs: "new_turn" } }),
				),
			);
		}
		return answered;
	};
	return { last: () => sent };
}

const seedRepositoriesOf = (test: TestContainer) =>
	createRepositories(test.database, {
		clock: { now: () => 1_700_000_000_000 },
		ids: { uuid: () => randomUUID() },
	});

describe("SIDE-21 the container's launch", () => {
	it("sends the saved variables and provider keys with a chat's message", async () => {
		const test = createTestContainer();
		try {
			const repositories = createRepositories(test.database, {
				clock: { now: () => 1_700_000_000_000 },
				ids: { uuid: () => randomUUID() },
			});
			must(
				await repositories.envVars.set({
					name: "JOIN_VARIABLE",
					scope: "global",
					repoId: null,
					keychainRef: "join-env-value",
				}),
			);
			must(await test.memory.platform.keychain.set("join-env-value", "variable-value"));
			must(
				await repositories.providerKeys.set(
					{
						agent: "claude",
						acpAgent: null,
						provider: "anthropic",
						envVar: "ANTHROPIC_API_KEY",
					},
					{ source: "entered", keychainRef: "join-provider-value" },
				),
			);
			must(await test.memory.platform.keychain.set("join-provider-value", "provider-value"));
			// The Anthropic API key reaches Claude when it is the chosen sign-in (SET-09).
			must(await test.container.services.settings.start());
			must(await test.container.services.settings.set("claude_provider", "anthropic"));

			const transport = test.memory.platform.sidecar;
			const originalSend = transport.send.bind(transport);
			let sent: SentLine | null = null;
			transport.send = async (line) => {
				const answered = await originalSend(line);
				const parsed = JSON.parse(line) as SentLine;
				if (parsed.method === "sendMessage") {
					sent = parsed;
					queueMicrotask(() =>
						test.memory.controls.emitSidecarLine(
							JSON.stringify({
								jsonrpc: "2.0",
								id: parsed.id,
								result: { deliveredAs: "new_turn" },
							}),
						),
					);
				}
				return answered;
			};

			const started = await test.container.sidecar.start();
			expect(started.ok).toBe(true);
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			const result = await test.container.services.sessions.send(session.id, "hello", [], "auto");

			expect(result.ok).toBe(true);
			expect(sent).not.toBeNull();
			const launch = (sent as SentLine | null)?.params.launch;
			expect(launch?.env.JOIN_VARIABLE).toBe("variable-value");
			expect(launch?.providerKeys.ANTHROPIC_API_KEY).toEqual({
				value: "provider-value",
				source: "entered",
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("sends the program path, provider and Bedrock region from settings", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			must(await test.container.services.settings.start());
			must(
				await test.container.services.settings.set("claude_executable_path", "/opt/claude/claude"),
			);
			must(await test.container.services.settings.set("claude_provider", "Bedrock"));
			must(await test.container.services.settings.set("bedrock_region", "eu-north-1"));
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			must(await test.container.services.sessions.send(session.id, "hello", [], "auto"));

			const launch = sends.last()?.params.launch;
			expect(launch?.executablePath).toBe("/opt/claude/claude");
			expect(launch?.provider).toBe("bedrock");
			expect(launch?.env.AWS_REGION).toBe("eu-north-1");
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("lets a repository's variable replace the global one and keeps other agents' keys out", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			const workspace = await seedWorkspace(test.container);
			const repositories = seedRepositoriesOf(test);
			const keychain = test.memory.platform.keychain;
			must(
				await repositories.envVars.set({
					name: "SHARED",
					scope: "global",
					repoId: null,
					keychainRef: "shared-global",
				}),
			);
			must(
				await repositories.envVars.set({
					name: "SHARED",
					scope: "repo",
					repoId: workspace.repoId,
					keychainRef: "shared-repo",
				}),
			);
			must(await keychain.set("shared-global", "from-global"));
			must(await keychain.set("shared-repo", "from-repo"));
			must(
				await repositories.providerKeys.set(
					{ agent: "claude", acpAgent: null, provider: "openai", envVar: "OPENAI_API_KEY" },
					{ source: "entered", keychainRef: "wrong-provider" },
				),
			);
			must(await keychain.set("wrong-provider", "openai-secret"));
			must(
				await repositories.providerKeys.set(
					{ agent: "claude", acpAgent: null, provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
					{ source: "this_mac" },
				),
			);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			must(await test.container.services.sessions.send(session.id, "hello", [], "auto"));

			const launch = sends.last()?.params.launch;
			expect(launch?.env.SHARED).toBe("from-repo");
			expect(launch?.providerKeys).toEqual({});
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("fails the send with the reason when a saved value is gone from the Keychain", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			const workspace = await seedWorkspace(test.container);
			const repositories = seedRepositoriesOf(test);
			must(
				await repositories.envVars.set({
					name: "SHARED",
					scope: "global",
					repoId: null,
					keychainRef: "shared-global",
				}),
			);
			must(await test.memory.platform.keychain.set("shared-global", "from-global"));
			must(
				await repositories.envVars.set({
					name: "SHARED",
					scope: "repo",
					repoId: workspace.repoId,
					keychainRef: "shared-repo-gone",
				}),
			);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			const result = await test.container.services.sessions.send(session.id, "hello", [], "auto");

			expect(result).toMatchObject({ ok: false, error: { code: "env_value_missing" } });
			expect(sends.last()).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

describe("SIDE-21 model lists use the user's program and keys", () => {
	it("sends a model list with the program path and the chosen sign-in's key", async () => {
		const test = createTestContainer();
		try {
			const transport = test.memory.platform.sidecar;
			const originalSend = transport.send.bind(transport);
			let sent: SentLine | null = null;
			transport.send = async (line) => {
				const answered = await originalSend(line);
				const parsed = JSON.parse(line) as SentLine;
				if (parsed.method === "listModels") {
					sent = parsed;
					queueMicrotask(() =>
						test.memory.controls.emitSidecarLine(
							JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { models: [] } }),
						),
					);
				}
				return answered;
			};
			must(await test.container.sidecar.start());
			const repositories = seedRepositoriesOf(test);
			must(
				await repositories.providerKeys.set(
					{ agent: "codex", acpAgent: null, provider: "openai", envVar: "OPENAI_API_KEY" },
					{ source: "entered", keychainRef: "list-provider-value" },
				),
			);
			must(await test.memory.platform.keychain.set("list-provider-value", "sk-openai"));
			const settings = test.container.services.settings;
			must(await settings.start());
			must(await settings.set("codex_executable_path", "/opt/codex/bin/codex"));
			must(await settings.set("codex_provider", "openai"));

			must(await test.container.services.agentCatalog.loadModels("codex"));

			const launch = (sent as SentLine | null)?.params.launch;
			expect(launch?.executablePath).toBe("/opt/codex/bin/codex");
			expect(launch?.provider).toBe("openai");
			expect(launch?.providerKeys.OPENAI_API_KEY).toEqual({
				value: "sk-openai",
				source: "entered",
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

describe("AGENT-16 the chat options the settings offer", () => {
	it("gives a new chat the settings' output style, Chrome, personality and approval policy", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			const settings = test.container.services.settings;
			must(await settings.start());
			must(await settings.set("default_claude_personality", "explanatory"));
			must(await settings.set("chrome_mode_enabled", true));
			must(await settings.set("default_codex_personality", "pragmatic"));
			must(await settings.set("codex_tool_approval_policy", "always_approve"));
			const workspace = await seedWorkspace(test.container);

			const session = must(await test.container.services.sessions.createFromDefaults(workspace.id));
			must(await test.container.services.sessions.send(session.id, "hello", [], "auto"));

			expect(sends.last()?.params.config).toMatchObject({
				claudeOutputStyle: "explanatory",
				claudeInChrome: true,
				codexPersonality: "pragmatic",
				codexApprovalPolicy: "never",
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
