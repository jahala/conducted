import { describe, expect, test } from "bun:test";
import { type AgentLaunch, agentProviders, type WorkspaceContext } from "@conducted/protocol";
import type { Result, SessionId, WorkspaceId } from "@conducted/shared";
import {
	buildAgentEnvironment,
	claudeProviderEnvironment,
	findAgentProgram,
	resolveAgentProgram,
} from "./launch-env.ts";

const workspace: WorkspaceContext = {
	workspaceId: "w1" as WorkspaceId,
	workspaceName: "lisbon",
	workspacePath: "/work/lisbon",
	repoRootPath: "/repos/conducted",
	targetBranch: "origin/main",
	placeholderBranch: false,
	host: { kind: "local" },
	port: 5100,
};
const sessionId = "s1" as SessionId;

const launch = (over: Partial<AgentLaunch> = {}): AgentLaunch => ({
	env: {},
	providerKeys: {},
	...over,
});

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
	return result.value;
};

const executableIn =
	(...paths: string[]) =>
	async (candidate: string) =>
		paths.includes(candidate);

describe("SIDE-21 agent environment", () => {
	test("SIDE-21 a Codex chat whose launch holds an ANTHROPIC_API_KEY gets no ANTHROPIC_API_KEY", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "codex",
				sessionId,
				workspace,
				base: { PATH: "/bin" },
				launch: launch({
					providerKeys: {
						ANTHROPIC_API_KEY: { value: "sk-ant-secret", source: "entered" },
						OPENAI_API_KEY: { value: "sk-openai-secret", source: "entered" },
					},
				}),
			}),
		);

		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBe("sk-openai-secret");
	});

	test("SIDE-21 the workspace variables come from the one shared environment builder", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "claude",
				sessionId,
				workspace,
				base: { PATH: "/bin" },
				launch: launch(),
			}),
		);

		expect(env).toMatchObject({
			PATH: "/bin",
			CONDUCTED_SESSION_ID: "s1",
			CONDUCTED_WORKSPACE_ID: "w1",
			CONDUCTED_WORKSPACE_NAME: "lisbon",
			CONDUCTED_WORKSPACE_PATH: "/work/lisbon",
			CONDUCTED_ROOT_PATH: "/repos/conducted",
			CONDUCTED_DEFAULT_BRANCH: "origin/main",
			CONDUCTED_PORT: "5100",
			CONDUCTED_IS_LOCAL: "true",
			DISABLE_AUTO_UPDATE: "true",
		});
	});

	test("SIDE-21 a user variable of a stripped name wins over the captured value", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "claude",
				sessionId,
				workspace,
				base: { ANTHROPIC_API_KEY: "from-the-shell" },
				launch: launch({ env: { ANTHROPIC_API_KEY: "from-the-user" } }),
			}),
		);

		expect(env.ANTHROPIC_API_KEY).toBe("from-the-user");
	});

	test("SIDE-21 an own provider key wins over a user variable of the same name", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "claude",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					env: { ANTHROPIC_API_KEY: "from-the-user" },
					providerKeys: { ANTHROPIC_API_KEY: { value: "from-the-key", source: "entered" } },
				}),
			}),
		);

		expect(env.ANTHROPIC_API_KEY).toBe("from-the-key");
	});

	test("SIDE-21 a key chosen from this Mac reaches its own agent too", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "cursor",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					providerKeys: { CURSOR_API_KEY: { value: "from-the-mac", source: "this_mac" } },
				}),
			}),
		);

		expect(env.CURSOR_API_KEY).toBe("from-the-mac");
	});

	test("SIDE-21 a Claude chat routes to the provider its launch names", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "claude",
				sessionId,
				workspace,
				base: { PATH: "/bin" },
				launch: launch({ provider: "bedrock" }),
			}),
		);

		expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
		expect(env.PATH).toBe("/bin");
	});

	test("SIDE-21 an unknown Claude provider is an error value, not a guess", () => {
		const result = buildAgentEnvironment({
			agent: "claude",
			sessionId,
			workspace,
			base: {},
			launch: launch({ provider: "mystery" }),
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("claude_provider_unknown");
	});

	test("SIDE-21 a Codex provider name is not Claude routing", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "codex",
				sessionId,
				workspace,
				base: {},
				launch: launch({ provider: "bedrock" }),
			}),
		);

		expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
	});
});

describe("SIDE-21 the agent's own keys and base URL", () => {
	test("SIDE-21 an OpenCode chat gets the keys of the providers OpenCode reads, and no other", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "acp",
				acpAgent: "opencode",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					providerKeys: {
						OPENROUTER_API_KEY: { value: "or-secret", source: "entered" },
						CURSOR_API_KEY: { value: "cursor-secret", source: "entered" },
					},
				}),
			}),
		);

		expect(env.OPENROUTER_API_KEY).toBe("or-secret");
		expect(env.CURSOR_API_KEY).toBeUndefined();
	});

	test("SIDE-21 the base URL reaches Codex as OPENAI_BASE_URL and Claude as ANTHROPIC_BASE_URL", () => {
		const codex = must(
			buildAgentEnvironment({
				agent: "codex",
				sessionId,
				workspace,
				base: {},
				launch: launch({ baseUrl: "https://proxy.example/v1" }),
			}),
		);
		const claude = must(
			buildAgentEnvironment({
				agent: "claude",
				sessionId,
				workspace,
				base: {},
				launch: launch({ baseUrl: " https://proxy.example/anthropic " }),
			}),
		);

		expect(codex.OPENAI_BASE_URL).toBe("https://proxy.example/v1");
		expect(codex.ANTHROPIC_BASE_URL).toBeUndefined();
		expect(claude.ANTHROPIC_BASE_URL).toBe("https://proxy.example/anthropic");
		expect(claude.OPENAI_BASE_URL).toBeUndefined();
	});

	test("SIDE-21 the base URL setting wins over a user variable of the same name", () => {
		const env = must(
			buildAgentEnvironment({
				agent: "codex",
				sessionId,
				workspace,
				base: {},
				launch: launch({
					env: { OPENAI_BASE_URL: "https://from-the-environment-page" },
					baseUrl: "https://from-the-setting",
				}),
			}),
		);

		expect(env.OPENAI_BASE_URL).toBe("https://from-the-setting");
	});

	test("SIDE-21 a base URL for an agent with no such variable is an error value", () => {
		const result = buildAgentEnvironment({
			agent: "acp",
			acpAgent: "pi",
			sessionId,
			workspace,
			base: {},
			launch: launch({ baseUrl: "https://proxy.example" }),
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("base_url_unsupported");
	});
});

describe("SIDE-21 Claude provider environment", () => {
	test("SIDE-21 Bedrock, Vertex, Foundry and Mantle each set only their own variable", () => {
		expect(must(claudeProviderEnvironment("bedrock"))).toEqual({
			CLAUDE_CODE_USE_BEDROCK: "1",
		});
		expect(must(claudeProviderEnvironment("vertex"))).toEqual({
			CLAUDE_CODE_USE_VERTEX: "1",
		});
		expect(must(claudeProviderEnvironment("foundry"))).toEqual({
			CLAUDE_CODE_USE_FOUNDRY: "1",
		});
		expect(must(claudeProviderEnvironment("mantle"))).toEqual({
			CLAUDE_CODE_USE_MANTLE: "1",
		});
	});

	test("SIDE-21 the standard sign-in sets no routing variable, including a missing or empty one", () => {
		expect(must(claudeProviderEnvironment(undefined))).toEqual({});
		expect(must(claudeProviderEnvironment(""))).toEqual({});
		expect(must(claudeProviderEnvironment(" Anthropic "))).toEqual({});
	});

	test("SIDE-21 the unknown-provider message lists every provider value Claude takes, from one table", () => {
		const result = claudeProviderEnvironment("mystery");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			for (const id of [
				...agentProviders("claude").map((provider) => provider.id),
				"foundry",
				"mantle",
			]) {
				expect(result.error.message).toContain(id);
			}
		}
	});

	test("SIDE-21 an unknown provider is an error value that names it", () => {
		const result = claudeProviderEnvironment("bedrockish");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("claude_provider_unknown");
			expect(result.error.message).toContain("bedrockish");
		}
	});
});

describe("SIDE-21 choosing the agent program", () => {
	test("SIDE-21 the user's program path wins over the managed copy and the PATH copy", async () => {
		const program = must(
			await resolveAgentProgram({
				agent: "claude",
				launch: launch({ executablePath: "/opt/claude" }),
				managedPath: "/app/claude",
				pathCopy: "/usr/local/bin/claude",
				usePathCopy: false,
				isExecutable: executableIn("/opt/claude", "/app/claude", "/usr/local/bin/claude"),
			}),
		);

		expect(program).toEqual({ path: "/opt/claude", viaRuntime: false });
	});

	test("SIDE-21 a .js program path is reported as starting through the JavaScript runtime", async () => {
		const program = must(
			await resolveAgentProgram({
				agent: "codex",
				launch: launch({ executablePath: "/opt/codex/cli.js" }),
				managedPath: null,
				pathCopy: null,
				usePathCopy: false,
				isExecutable: executableIn("/opt/codex/cli.js"),
			}),
		);

		expect(program).toEqual({ path: "/opt/codex/cli.js", viaRuntime: true });
	});

	test("SIDE-21 a user path that cannot run is an error that names it, with no fallback", async () => {
		const checked: string[] = [];
		const result = await resolveAgentProgram({
			agent: "claude",
			launch: launch({ executablePath: "/opt/missing-claude" }),
			managedPath: "/app/claude",
			pathCopy: "/usr/local/bin/claude",
			usePathCopy: false,
			isExecutable: async (candidate) => {
				checked.push(candidate);
				return candidate !== "/opt/missing-claude";
			},
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("agent_program_invalid");
			expect(result.error.message).toContain("/opt/missing-claude");
		}
		expect(checked).toEqual(["/opt/missing-claude"]);
	});

	test("SIDE-21 with no user path the managed copy is used", async () => {
		const program = must(
			await resolveAgentProgram({
				agent: "claude",
				launch: launch(),
				managedPath: "/app/claude",
				pathCopy: "/usr/local/bin/claude",
				usePathCopy: false,
				isExecutable: executableIn("/app/claude", "/usr/local/bin/claude"),
			}),
		);

		expect(program).toEqual({ path: "/app/claude", viaRuntime: false });
	});

	test("SIDE-21 a managed copy that cannot run is an error naming the program, never the PATH copy", async () => {
		const result = await resolveAgentProgram({
			agent: "claude",
			launch: launch(),
			managedPath: "/app/broken-claude",
			pathCopy: "/usr/local/bin/claude",
			usePathCopy: false,
			isExecutable: executableIn("/usr/local/bin/claude"),
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("agent_not_installed");
			expect(result.error.message).toContain("Claude Code");
			expect(result.error.message).toContain("Retry");
		}
	});

	test("SIDE-21 an agent the app does not manage still uses the login-shell PATH copy", async () => {
		const program = must(
			await resolveAgentProgram({
				agent: "acp",
				launch: launch(),
				managedPath: null,
				pathCopy: "/usr/local/bin/opencode",
				usePathCopy: true,
				isExecutable: executableIn("/usr/local/bin/opencode"),
			}),
		);

		expect(program).toEqual({ path: "/usr/local/bin/opencode", viaRuntime: false });
	});

	test("SIDE-21 no program anywhere is agent_not_installed", async () => {
		const result = await resolveAgentProgram({
			agent: "acp",
			launch: launch(),
			managedPath: null,
			pathCopy: null,
			usePathCopy: true,
			isExecutable: async () => true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("agent_not_installed");
	});

	test("SIDE-21 a managed agent with no custom path never looks on PATH", async () => {
		const searched: string[] = [];
		const result = await findAgentProgram({
			agent: "claude",
			name: "claude",
			executablePath: undefined,
			env: { PATH: "/usr/bin" },
			findExecutable: async (name) => {
				searched.push(name);
				return "/usr/bin/claude";
			},
			findManagedProgram: async () => null,
			usePathCopy: false,
		});

		expect(searched).toEqual([]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("agent_not_installed");
			expect(result.error.message).toContain("Claude Code");
			expect(result.error.message).toContain("Retry");
		}
	});
});

describe("SIDE-21 agent provider list", () => {
	test("SIDE-21 each non-ACP agent lists the variables its own key lives in", () => {
		expect(agentProviders("claude").map((provider) => provider.id)).toContain("anthropic");
		expect(agentProviders("codex")[0]?.keyEnvVars).toEqual(["OPENAI_API_KEY"]);
		expect(agentProviders("cursor")[0]?.keyEnvVars).toEqual(["CURSOR_API_KEY"]);
	});

	test("SIDE-21 both ACP agents share the provider list and a caller cannot change it", () => {
		const opencode = agentProviders("acp", "opencode");
		expect(opencode.map((provider) => provider.keyEnvVars)).toContainEqual(["OPENROUTER_API_KEY"]);
		expect(agentProviders("acp", "pi").map((provider) => provider.id)).toEqual(
			opencode.map((provider) => provider.id),
		);

		const listed = opencode.length;
		opencode.pop();
		expect(agentProviders("acp", "opencode")).toHaveLength(listed);
	});
});
