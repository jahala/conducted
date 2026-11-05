/**
 * @feature SIDE-21 Agent settings reach the sidecar: the desktop composition root's launch
 * Owns: proof that the real container reads the saved program path, Environment variables and
 * provider keys and sends them in a chat's launch.
 * Behaviour: apps/desktop/src/core/container.ts (launchFor), core/services/sessions.ts (sendMessage).
 * Test first: this file.
 * Our design choice: the sidecar transport is the memory Platform's scripted seam. It answers the
 * sendMessage line at once, so the test never waits on a timer.
 */
import { randomUUID } from "node:crypto";
import type { SessionConfig } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../test/container.ts";
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
		launch?: {
			executablePath?: string;
			env: Record<string, string>;
			providerKeys: Record<string, { value: string; source: string }>;
		};
	};
}

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
});
