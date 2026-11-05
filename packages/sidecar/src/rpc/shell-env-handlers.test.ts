/**
 * @feature SIDE-10 Login-shell environment capture
 * Owns: the getShellEnv handler's folder, so two workspaces with different profiles cache apart.
 * Test first: getShellEnv asks the provider for the workspace path it was given.
 */
import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import type { ShellEnvProvider } from "../shell-env/capture.ts";
import { buildHandlers, type HandlerDeps } from "./handlers.ts";

const model: ModelInfo = {
	id: "claude-sonnet",
	label: "Sonnet",
	status: "picker",
	isNew: false,
	isDefault: true,
	efforts: [],
	defaultEffort: "medium",
	effortAxis: "effort",
	liveEffortChange: false,
	supportsFastMode: false,
};

function deps(shellEnv: ShellEnvProvider): HandlerDeps {
	return {
		sessions: {
			sendMessage: async () => ({ deliveredAs: "new_turn" }),
			cancel: async () => ({ wasWorking: false, droppedMessageIds: [] }),
			warmAgent: async () => ({}),
			resetAgent: async () => ({}),
			updateConfig: async () => ({ applied: "live" }),
			setAutoApproveEdits: async () => ({}),
			getSessionStatus: async () => ({ known: true }),
			answerInteraction: async () => ({ accepted: true, superseded: false }),
			liveStateOf: () => undefined,
			onAppAttached: () => {},
			shutdown: async () => {},
		},
		outbox: {
			open: async () => ok([]),
			append: async () => ok([]),
			acknowledge: async () => ok(undefined),
			pending: () => [],
			sessionsWithPending: () => [],
			sweepIdle: async () => ok(0),
		},
		models: {
			list: async () => ok([model]),
			validate: async () => ok(model),
			invalidate: () => {},
		},
		agents: {
			detectAll: async () => [],
			startLogin: async () => ok({ loginId: "login-1", instructions: "Sign in" }),
			finishLogin: async () => ok({ outcome: "signed_in" as const }),
			cancelLogin: async () => ok(undefined),
		},
		slashCommands: { list: async () => ok([]) },
		mcpServers: { list: async () => ok([]) },
		usage: {
			contextUsage: async () => ok({ usedTokens: 1, windowTokens: 2, rateLimits: [] }),
		},
		shellEnv,
		utilityPrompt: { run: async () => ok({ text: "" }) },
		setLogLevel: () => {},
	};
}

describe("SIDE-10 getShellEnv folder", () => {
	test("asks the provider for the workspace path it was given", async () => {
		const asked: (string | undefined)[] = [];
		const shellEnv: ShellEnvProvider = {
			get: async (folder) => {
				asked.push(folder);
				return ok({ shell: "/bin/zsh", path: "/usr/bin", env: {} });
			},
			refresh: async () => ok({ shell: "/bin/zsh", path: "/usr/bin", env: {} }),
		};

		const handlers = buildHandlers(deps(shellEnv));

		await expect(handlers.requests.getShellEnv({ workspacePath: "/work/lisbon" })).resolves.toEqual(
			ok({ shell: "/bin/zsh", path: "/usr/bin" }),
		);
		expect(asked).toEqual(["/work/lisbon"]);
	});
});
