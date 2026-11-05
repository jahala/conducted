/**
 * @feature SIDE-15 Agent detection, versions and sign-in flows
 * Owns: the tests for detection, version tracking, auth state and the sign-in state machine in
 * agent-detection.ts.
 * Behaviour: research/conductor/other-runners.md section 5 "Auth" and native-and-sidecar-map.md B3
 * "Harness version tracking".
 * Test first: detectAll() with a runner whose detect() returns null yields installed false and
 * emits no agentInstallsChanged when nothing changed since the last call.
 */
import { describe, expect, test } from "bun:test";
import type { AgentInstall } from "@conducted/protocol";
import type { AcpAgent, AgentKind, IdSource } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import type { ProbeCommand } from "../runners/deps.ts";
import { MapRunnerRegistry, type RunnerSelector } from "../runners/registry.ts";
import type { AgentSession, Runner, StartOptions } from "../runners/runner.ts";
import type { CapturedShellEnv, ShellEnvProvider } from "../shell-env/capture.ts";
import {
	AGENT_AUTH_REQUIRED,
	CLAUDE_AUTH_CACHE_MS,
	CODEX_LOGIN_TIMEOUT_MS,
	type CodexAuthPort,
	type CursorAuthPort,
	DefaultAgentDetector,
	VERSION_PROBE_TIMEOUT_MS,
} from "./agent-detection.ts";

function fakeLogger() {
	return createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test",
	});
}

const CAPTURED: CapturedShellEnv = {
	shell: "/bin/zsh",
	path: "/usr/bin:/bin",
	env: { PATH: "/usr/bin:/bin" },
};

function fakeShellEnv(): ShellEnvProvider {
	return {
		get: async () => ok(CAPTURED),
		refresh: async () => ok(CAPTURED),
	};
}

function fakeIds(): IdSource {
	let next = 0;
	return { uuid: () => `login-${++next}` };
}

type Detect = Runner["detect"];

function fakeRunner(agent: AgentKind, detect: Detect, _acpAgent?: AcpAgent): Runner {
	return {
		agent,
		capabilities: {
			steer: false,
			interrupt: false,
			resumeAt: false,
			liveConfig: false,
			slashCommands: false,
			mcpServers: false,
			contextUsage: false,
		},
		detect,
		start: async (_options: StartOptions): Promise<AgentSession> => {
			throw new Error("start is not used by detection");
		},
		listModels: async () => [],
		listSlashCommands: async () => [],
	};
}

function runnerEntries(
	detect: Detect,
	selector: RunnerSelector = { agent: "claude" },
): { selector: RunnerSelector; runner: Runner }[] {
	return [{ selector, runner: fakeRunner(selector.agent, detect, selector.acpAgent) }];
}

const noProbe: ProbeCommand = async () => err(appError("probe_failed", "no probe"));

interface Options {
	detect?: Detect;
	deps?: Partial<ConstructorParameters<typeof DefaultAgentDetector>[0]>;
	selector?: RunnerSelector;
	probe?: ProbeCommand;
	onChanged?(agents: AgentInstall[]): void;
}

function detector(options: Options = {}): DefaultAgentDetector {
	const detect = options.detect ?? (async () => null);
	const deps: ConstructorParameters<typeof DefaultAgentDetector>[0] = {
		runners: new MapRunnerRegistry(runnerEntries(detect, options.selector ?? { agent: "claude" })),
		shellEnv: fakeShellEnv(),
		onChanged: options.onChanged ?? (() => {}),
		logger: fakeLogger(),
		ids: fakeIds(),
		probe: options.probe ?? noProbe,
		...options.deps,
	};
	return new DefaultAgentDetector(deps);
}

describe("SIDE-15 agent detection", () => {
	test("a runner whose detect() returns null reports installed false", async () => {
		const agents = await detector().detectAll();
		expect(agents).toEqual([{ agent: "claude", installed: false }]);
	});

	test("agentInstallsChanged fires only when the answer differs from the last call", async () => {
		let available = false;
		const changes: AgentInstall[][] = [];
		const detect: Detect = async () =>
			available ? { path: "/opt/claude", version: "1.2.3" } : null;
		const subject = detector({
			detect,
			onChanged: (agents) => changes.push(agents),
		});

		await subject.detectAll();
		expect(changes.length).toBe(1);
		expect(changes[0]?.[0]?.installed).toBe(false);

		await subject.detectAll();
		expect(changes.length).toBe(1);

		available = true;
		await subject.detectAll();
		expect(changes.length).toBe(2);
		expect(changes[1]?.[0]).toMatchObject({
			agent: "claude",
			installed: true,
			path: "/opt/claude",
			source: "login_path",
			version: "1.2.3",
		});
	});

	test("a version probe that returned no version reports installed true without a version", async () => {
		const agents = await detector({
			detect: async () => ({ path: "/opt/claude", version: "" }),
		}).detectAll();
		expect(agents[0]).toMatchObject({ installed: true, path: "/opt/claude" });
		expect(agents[0]?.version).toBeUndefined();
	});

	test("the newest detection wins when two runs finish out of order", async () => {
		let call = 0;
		let releaseFirst!: () => void;
		const first = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const changes: AgentInstall[][] = [];
		const detect: Detect = async () => {
			call += 1;
			if (call === 1) {
				await first;
				return { path: "/old/claude", version: "1.0.0" };
			}
			return { path: "/new/claude", version: "2.0.0" };
		};
		const subject = detector({ detect, onChanged: (agents) => changes.push(agents) });

		const older = subject.detectAll();
		const newer = subject.detectAll();
		const newest = await newer;
		releaseFirst();
		const oldest = await older;

		expect(oldest[0]?.path).toBe("/old/claude");
		expect(newest[0]?.path).toBe("/new/claude");
		expect(changes.at(-1)?.[0]?.path).toBe("/new/claude");
	});

	test("Claude sign-in state comes from claude auth status --json", async () => {
		const calls: { command: string; args: readonly string[]; timeoutMs: number }[] = [];
		const probe: ProbeCommand = async (command, args, options) => {
			calls.push({ command, args, timeoutMs: options.timeoutMs });
			return ok({
				stdout: JSON.stringify({ loggedIn: true, authMethod: "bedrock" }),
				stderr: "",
				exitCode: 0,
			});
		};
		const agents = await detector({
			detect: async () => ({ path: "/opt/claude", version: "1.2.3" }),
			probe,
		}).detectAll();

		expect(agents[0]).toMatchObject({
			authenticated: true,
			authMethod: "bedrock",
		});
		expect(calls).toEqual([
			{
				command: "/opt/claude",
				args: ["auth", "status", "--json"],
				timeoutMs: VERSION_PROBE_TIMEOUT_MS,
			},
		]);
	});

	test("the Claude auth status is reused for 60 seconds", async () => {
		let now = 1_000;
		let authCalls = 0;
		const probe: ProbeCommand = async (_command, args) => {
			if (args[0] === "auth") {
				authCalls += 1;
				return ok({
					stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key" }),
					stderr: "",
					exitCode: 0,
				});
			}
			return ok({ stdout: "1.2.3\n", stderr: "", exitCode: 0 });
		};
		const subject = detector({
			detect: async () => ({ path: "/opt/claude", version: "1.2.3" }),
			probe,
			deps: { clock: { now: () => now } },
		});

		await subject.detectAll();
		now += CLAUDE_AUTH_CACHE_MS - 1;
		await subject.detectAll();
		expect(authCalls).toBe(1);

		now += 1;
		await subject.detectAll();
		expect(authCalls).toBe(2);
	});

	test("a configured executable path replaces the PATH copy", async () => {
		const seen: string[] = [];
		const probe: ProbeCommand = async (command, args, options) => {
			seen.push(`${command} ${args.join(" ")} ${options.timeoutMs}`);
			if (args[0] === "--version") {
				return ok({ stdout: "2.1.0 (Claude Code)\n", stderr: "", exitCode: 0 });
			}
			return err(appError("probe_failed", "not signed in"));
		};
		const agents = await detector({
			detect: async () => ({ path: "/path/claude", version: "1.0.0" }),
			probe,
			deps: { executablePath: () => "/custom/claude" },
		}).detectAll();

		expect(agents[0]).toMatchObject({
			installed: true,
			path: "/custom/claude",
			source: "user",
			version: "2.1.0",
		});
		expect(seen[0]).toBe(`/custom/claude --version ${VERSION_PROBE_TIMEOUT_MS}`);
	});

	test("a configured path with no program reports a warning instead of a version", async () => {
		const probe: ProbeCommand = async () => err(appError("spawn_failed", "executable not found"));
		const agents = await detector({
			probe,
			deps: { executablePath: () => "/missing/claude" },
		}).detectAll();

		expect(agents[0]?.installed).toBe(false);
		expect(agents[0]?.warning).toContain("/missing/claude");
		expect(agents[0]?.warning).toContain("was not found");
	});

	test("the app's managed copy is preferred over the PATH copy", async () => {
		let detected = false;
		const agents = await detector({
			detect: async () => {
				detected = true;
				return { path: "/path/claude", version: "1.0.0" };
			},
			deps: {
				findManagedProgram: async () => ({
					path: "/app/agent-binaries/claude/2.0.0/claude",
					version: "2.0.0",
				}),
			},
		}).detectAll();

		expect(agents[0]).toMatchObject({
			installed: true,
			path: "/app/agent-binaries/claude/2.0.0/claude",
			source: "managed",
			version: "2.0.0",
		});
		expect(detected).toBe(false);
	});

	test("Codex account state comes from account/read", async () => {
		const codex: CodexAuthPort = {
			account: async () => ok({ authenticated: true, authMethod: "chatgpt" }),
			startDeviceLogin: async () => err(appError("not_used", "not used")),
			finishLogin: async () => err(appError("not_used", "not used")),
			cancelLogin: async () => err(appError("not_used", "not used")),
		};
		const agents = await detector({
			detect: async () => ({ path: "/opt/codex", version: "0.154.0" }),
			deps: { codex },
			selector: { agent: "codex" },
		}).detectAll();

		expect(agents[0]).toMatchObject({
			agent: "codex",
			authenticated: true,
			authMethod: "chatgpt",
		});
	});

	test("Codex and Claude use one spelling for an auth method", async () => {
		const codex: CodexAuthPort = {
			account: async () => ok({ authenticated: true, authMethod: "apiKey" }),
			startDeviceLogin: async () => err(appError("not_used", "not used")),
			finishLogin: async () => err(appError("not_used", "not used")),
			cancelLogin: async () => err(appError("not_used", "not used")),
		};
		const codexAgents = await detector({
			detect: async () => ({ path: "/opt/codex", version: "0.154.0" }),
			deps: { codex },
			selector: { agent: "codex" },
		}).detectAll();

		const probe: ProbeCommand = async () =>
			ok({
				stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key" }),
				stderr: "",
				exitCode: 0,
			});
		const claudeAgents = await detector({
			detect: async () => ({ path: "/opt/claude", version: "1.2.3" }),
			probe,
		}).detectAll();

		expect(codexAgents[0]?.authMethod).toBe("api_key");
		expect(claudeAgents[0]?.authMethod).toBe("api_key");
	});

	test("a Cursor API key from Settings reports the agent as signed in", async () => {
		const agents = await detector({
			detect: async () => ({ path: "/opt/cursor-agent", version: "1.0.0" }),
			deps: { cursorApiKey: () => "key-from-settings" },
			selector: { agent: "cursor" },
		}).detectAll();

		expect(agents[0]).toMatchObject({ authenticated: true, authMethod: "api_key" });
	});

	test("a failing shell capture is logged and detection still answers", async () => {
		const shellEnv: ShellEnvProvider = {
			get: async () => err(appError("shell_failed", "the shell did not start")),
			refresh: async () => err(appError("shell_failed", "the shell did not start")),
		};
		const agents = await detector({
			deps: { shellEnv },
		}).detectAll();
		expect(agents).toEqual([{ agent: "claude", installed: false }]);
	});
});

describe("SIDE-15 detection calls the runner as a method", () => {
	test("SIDE-15 a class runner whose detect() reads this is reported installed", async () => {
		class ClassRunner {
			readonly agent: AgentKind = "claude";
			readonly capabilities = fakeRunner("claude", async () => null).capabilities;
			private readonly deps = { path: "/usr/local/bin/claude" };
			async detect() {
				return { path: this.deps.path, version: "2.0.0" };
			}
			async start(): Promise<AgentSession> {
				throw new Error("start is not used by detection");
			}
			async listModels() {
				return [];
			}
			async listSlashCommands() {
				return [];
			}
		}
		const runner = new ClassRunner() as unknown as Runner;
		const agents = await detector({
			deps: {
				runners: new MapRunnerRegistry([{ selector: { agent: "claude" }, runner }]),
			},
		}).detectAll();

		expect(agents[0]).toMatchObject({ agent: "claude", installed: true });
	});
});

describe("SIDE-15 sign-in flows", () => {
	test("Claude sign-in offers the setup-token command", async () => {
		const result = await detector().startLogin("claude");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.loginId).toBe("login-1");
		expect(result.value.command).toBe("claude setup-token");
		expect(result.value.instructions).toContain("setup-token");
	});

	test("a second start for the same agent returns the pending flow", async () => {
		const subject = detector();
		const first = await subject.startLogin("claude");
		const second = await subject.startLogin("claude");
		expect(first.ok && second.ok).toBe(true);
		if (!first.ok || !second.ok) return;
		expect(second.value.loginId).toBe(first.value.loginId);
		expect(second.value.command).toBe(first.value.command);
	});

	test("two concurrent Codex starts share one device login", async () => {
		let starts = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const codex: CodexAuthPort = {
			account: async () => ok({ authenticated: false }),
			startDeviceLogin: async () => {
				starts += 1;
				await gate;
				return ok({
					loginId: "codex-login",
					userCode: "ABCD-1234",
					instructions: "Enter the code.",
				});
			},
			finishLogin: async () => err(appError("not_used", "not used")),
			cancelLogin: async () => ok(undefined),
		};
		const subject = detector({ deps: { codex }, selector: { agent: "codex" } });

		const first = subject.startLogin("codex");
		const second = subject.startLogin("codex");
		release();
		const [one, two] = await Promise.all([first, second]);

		expect(starts).toBe(1);
		expect(one.ok && two.ok).toBe(true);
		if (!one.ok || !two.ok) return;
		expect(two.value.loginId).toBe(one.value.loginId);
	});

	test("a failed Codex start can be retried", async () => {
		let starts = 0;
		const codex: CodexAuthPort = {
			account: async () => ok({ authenticated: false }),
			startDeviceLogin: async () => {
				starts += 1;
				if (starts === 1) return err(appError("app_server_failed", "the app-server stopped"));
				return ok({ loginId: "codex-login", instructions: "Enter the code." });
			},
			finishLogin: async () => err(appError("not_used", "not used")),
			cancelLogin: async () => ok(undefined),
		};
		const subject = detector({ deps: { codex }, selector: { agent: "codex" } });

		const first = await subject.startLogin("codex");
		expect(first.ok).toBe(false);
		const second = await subject.startLogin("codex");
		expect(second.ok).toBe(true);
		expect(starts).toBe(2);
	});

	test("two concurrent Cursor starts share one browser login", async () => {
		let starts = 0;
		const cancelled: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const cursor: CursorAuthPort = {
			startLogin: async () => {
				starts += 1;
				await gate;
				return ok({
					loginId: "cursor-login",
					url: "https://example.test/cursor",
					instructions: "Finish signing in in your browser.",
				});
			},
			finishLogin: async () => ok({ outcome: "signed_in", apiKey: "key" }),
			cancelLogin: async (loginId) => {
				cancelled.push(loginId);
				return ok(undefined);
			},
		};
		const subject = detector({ deps: { cursor }, selector: { agent: "cursor" } });

		const first = subject.startLogin("cursor");
		const second = subject.startLogin("cursor");
		release();
		const [one, two] = await Promise.all([first, second]);

		expect(starts).toBe(1);
		expect(cancelled).toEqual([]);
		expect(one.ok && two.ok).toBe(true);
		if (!one.ok || !two.ok) return;
		expect(two.value.loginId).toBe(one.value.loginId);
	});

	test("an ACP agent has no sign-in flow of its own", async () => {
		const result = await detector({
			selector: { agent: "acp", acpAgent: "opencode" },
		}).startLogin("acp", "opencode");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe(AGENT_AUTH_REQUIRED);
	});

	test("Codex starts a device-code login and finishes it", async () => {
		const finished: { loginId: string; timeoutMs: number }[] = [];
		const codex: CodexAuthPort = {
			account: async () => ok({ authenticated: false }),
			startDeviceLogin: async () =>
				ok({
					loginId: "codex-login",
					url: "https://example.test/login",
					userCode: "ABCD-1234",
					verificationUrl: "https://example.test/device",
					instructions: "Open the page and enter the code.",
				}),
			finishLogin: async (loginId, options) => {
				finished.push({ loginId, timeoutMs: options.timeoutMs });
				return ok({ outcome: "signed_in", message: "Codex now uses your ChatGPT plan" });
			},
			cancelLogin: async () => ok(undefined),
		};
		const subject = detector({ deps: { codex }, selector: { agent: "codex" } });

		const started = await subject.startLogin("codex");
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		expect(started.value).toMatchObject({
			loginId: "codex-login",
			userCode: "ABCD-1234",
			verificationUrl: "https://example.test/device",
		});

		const finishedResult = await subject.finishLogin("codex-login");
		expect(finishedResult.ok && finishedResult.value.outcome).toBe("signed_in");
		expect(finished).toEqual([{ loginId: "codex-login", timeoutMs: CODEX_LOGIN_TIMEOUT_MS }]);

		const again = await subject.finishLogin("codex-login");
		expect(!again.ok && again.error.code).toBe("login_unknown");
	});

	test("only one Cursor login is pending at a time", async () => {
		const cancelled: string[] = [];
		let next = 0;
		const cursor: CursorAuthPort = {
			startLogin: async () => {
				next += 1;
				return ok({
					loginId: `cursor-${next}`,
					url: `https://example.test/cursor/${next}`,
					instructions: "Finish signing in in your browser.",
				});
			},
			finishLogin: async (loginId) => ok({ outcome: "signed_in", apiKey: `key-${loginId}` }),
			cancelLogin: async (loginId) => {
				cancelled.push(loginId);
				return ok(undefined);
			},
		};
		const subject = detector({ deps: { cursor }, selector: { agent: "cursor" } });

		const first = await subject.startLogin("cursor");
		const second = await subject.startLogin("cursor");
		expect(first.ok && second.ok).toBe(true);
		if (!first.ok || !second.ok) return;
		expect(cancelled).toEqual([first.value.loginId]);
		expect(second.value.loginId).toBe("cursor-2");

		const old = await subject.finishLogin(first.value.loginId);
		expect(old.ok).toBe(false);

		const done = await subject.finishLogin(second.value.loginId);
		expect(done.ok && done.value.apiKey).toBe("key-cursor-2");
	});

	test("cancelling a Codex login tells the port and forgets the flow", async () => {
		const cancelled: string[] = [];
		const codex: CodexAuthPort = {
			account: async () => ok({ authenticated: false }),
			startDeviceLogin: async () => ok({ loginId: "codex-1", instructions: "Enter the code." }),
			finishLogin: async () => err(appError("not_used", "not used")),
			cancelLogin: async (loginId) => {
				cancelled.push(loginId);
				return ok(undefined);
			},
		};
		const subject = detector({ deps: { codex }, selector: { agent: "codex" } });

		const started = await subject.startLogin("codex");
		expect(started.ok).toBe(true);
		const cancelledResult = await subject.cancelLogin("codex-1");
		expect(cancelledResult.ok).toBe(true);
		expect(cancelled).toEqual(["codex-1"]);

		const finished = await subject.finishLogin("codex-1");
		expect(!finished.ok && finished.error.code).toBe("login_unknown");
	});

	test("a Claude finish without a pasted code keeps the flow open", async () => {
		const subject = detector({
			detect: async () => ({ path: "/opt/claude", version: "1.2.3" }),
		});
		const started = await subject.startLogin("claude");
		expect(started.ok).toBe(true);

		const empty = await subject.finishLogin("login-1", "   ");
		expect(!empty.ok && empty.error.code).toBe("login_code_missing");

		const stillWaiting = await subject.finishLogin("login-1", "");
		expect(!stillWaiting.ok && stillWaiting.error.code).toBe("login_code_missing");
	});

	test("a Claude finish reports signed in only when claude auth status confirms it", async () => {
		const probe: ProbeCommand = async () =>
			ok({
				stdout: JSON.stringify({ loggedIn: true }),
				stderr: "",
				exitCode: 0,
			});
		const subject = detector({
			detect: async () => ({ path: "/opt/claude", version: "1.2.3" }),
			probe,
		});
		const started = await subject.startLogin("claude");
		expect(started.ok).toBe(true);

		const accepted = await subject.finishLogin("login-1", "code-from-claude");
		expect(accepted.ok && accepted.value.outcome).toBe("signed_in");
	});

	test("a Claude finish checks again instead of reusing the cached answer", async () => {
		let authCalls = 0;
		const probe: ProbeCommand = async () => {
			authCalls += 1;
			return ok({
				stdout: JSON.stringify({ loggedIn: authCalls > 1 }),
				stderr: "",
				exitCode: 0,
			});
		};
		const subject = detector({
			detect: async () => ({ path: "/opt/claude", version: "1.2.3" }),
			probe,
		});

		const before = await subject.detectAll();
		expect(before[0]?.authenticated).toBe(false);

		const started = await subject.startLogin("claude");
		expect(started.ok).toBe(true);
		const accepted = await subject.finishLogin("login-1", "code-from-claude");
		expect(accepted.ok && accepted.value.outcome).toBe("signed_in");
		expect(authCalls).toBe(2);
	});

	test("a Claude finish fails when claude auth status says not signed in", async () => {
		const probe: ProbeCommand = async () =>
			ok({
				stdout: JSON.stringify({ loggedIn: false }),
				stderr: "",
				exitCode: 0,
			});
		const subject = detector({
			detect: async () => ({ path: "/opt/claude", version: "1.2.3" }),
			probe,
		});
		const started = await subject.startLogin("claude");
		expect(started.ok).toBe(true);

		const accepted = await subject.finishLogin("login-1", "code-from-claude");
		expect(accepted.ok && accepted.value.outcome).toBe("failed");
		if (!accepted.ok) return;
		expect(accepted.value.message).toContain("does not report a sign-in");

		const again = await subject.finishLogin("login-1", "code-from-claude");
		expect(!again.ok && again.error.code).toBe("login_unknown");
	});

	test("a Claude finish that cannot check the sign-in fails instead of pretending", async () => {
		const subject = detector({
			detect: async () => ({ path: "/opt/claude", version: "1.2.3" }),
		});
		const started = await subject.startLogin("claude");
		expect(started.ok).toBe(true);

		const accepted = await subject.finishLogin("login-1", "code-from-claude");
		expect(accepted.ok && accepted.value.outcome).toBe("failed");
	});
});
