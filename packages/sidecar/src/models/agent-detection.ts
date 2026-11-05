/**
 * @feature SIDE-15 Agent detection, versions and sign-in flows
 * Owns: finding the installed agent programs, reading their versions, checking whether each is
 * signed in, and starting, finishing and cancelling an agent's own sign-in flow.
 * Behaviour: research/conductor/other-runners.md section 5 "Auth" (Claude: `claude auth status
 * --json` with a 5 s timeout; Codex: `account/read` on a throwaway app-server and a device-code
 * login through `account/login/start`; Cursor: browser login; ACP: sign-in is the agent's own),
 * native-and-sidecar-map.md B3 "Harness version tracking" (probe versions when paths change) and
 * decision 7 in docs/plans/scaffold.md (agent programs come from the user's machine first).
 * Must handle:
 *  - an agent that is missing from PATH: installed false, no error
 *  - a version probe that hangs: kill at 5 s, report installed true with no version
 *  - the login-shell PATH changes (refresh): re-detect and send agentInstallsChanged only when the
 *    result differs from the last one
 *  - startLogin for an agent without a login flow: RPC_ERRORS.agentAuthRequired with instructions
 *  - a login flow already running for the same agent: return the same url and code
 *  - a Claude sign-in that the CLI does not confirm: report failed, never a fake success
 *  - a second detectAll() within 60 s: reuse the Claude auth answer (claude-runner 1.3)
 *  - two starts at once: one flow only, so they share the same promise
 * Test first: detectAll() with a runner whose detect() returns null yields installed false and
 * emits no agentInstallsChanged when nothing changed since the last call.
 * Our design choice: the Codex app-server and Cursor SDK calls arrive as ports (CodexAuthPort,
 * CursorAuthPort). This module owns the state machine; the agent's own protocol stays in its
 * runner. The app's managed copies and the executable paths in Settings arrive through
 * findManagedProgram and executablePath, because their folders are the composition root's data.
 * Our design choice: only the newest detection run may replace the cached list, so an older answer
 * that arrives late cannot undo a newer one.
 */
import { AGENT_ERROR_CODES, type AgentInstall } from "@conducted/protocol";
import type { AcpAgent, AgentKind, IdSource } from "@conducted/shared";
import {
	type AppError,
	appError,
	type Clock,
	err,
	ok,
	type Result,
	systemClock,
} from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { ProbeCommand } from "../runners/deps.ts";
import { type RunnerRegistry, type RunnerSelector, selectorKey } from "../runners/registry.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";
import { isAppError, messageOf } from "../util/errors.ts";

/** The longest a version or auth probe may take. Conductor kills Claude's probe at 5 s. */
export const VERSION_PROBE_TIMEOUT_MS = 5_000;

/** How long a Claude auth answer is reused. Conductor caches it for 60 s (claude-runner 1.3). */
export const CLAUDE_AUTH_CACHE_MS = 60_000;

/** How long a Codex device-code login may wait for the user to finish. */
export const CODEX_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/** The agent needs a sign-in that this sidecar has no flow for (ACP). */
export const AGENT_AUTH_REQUIRED = AGENT_ERROR_CODES.authRequired;
/** The flow finished or was cancelled before this call. */
export const LOGIN_UNKNOWN = "login_unknown";
/** A pasted Claude code was empty. */
export const LOGIN_CODE_MISSING = "login_code_missing";

/** A sign-in flow returned to the app. Mirrors the protocol's AgentLogin shape. */
export interface LoginInstructions {
	loginId: string;
	/** A page to open in the browser. */
	url?: string;
	/** The code the user types on the verification page. */
	userCode?: string;
	verificationUrl?: string;
	/** A terminal command the user can run instead, such as `claude setup-token`. */
	command?: string;
	instructions: string;
}

/** The end of a sign-in flow. Cursor hands its API key back for the app's Keychain. */
export interface LoginOutcome {
	outcome: "signed_in" | "failed" | "cancelled";
	message?: string;
	apiKey?: string;
}

/** The Codex app-server calls this module needs. AGENT-06 supplies the real client. */
export interface CodexAuthPort {
	account(
		env: Readonly<Record<string, string>>,
	): Promise<Result<{ authenticated: boolean; authMethod?: string }, AppError>>;
	/** `account/login/start` with the ChatGPT device-code type. */
	startDeviceLogin(
		env: Readonly<Record<string, string>>,
	): Promise<Result<LoginInstructions, AppError>>;
	/** Waits for `account/login/completed`, up to options.timeoutMs. */
	finishLogin(
		loginId: string,
		options: { timeoutMs: number; code?: string },
	): Promise<Result<LoginOutcome, AppError>>;
	/** `account/login/cancel`. */
	cancelLogin(loginId: string): Promise<Result<void, AppError>>;
}

/** The Cursor SDK login calls this module needs. AGENT-09 supplies the real SDK. */
export interface CursorAuthPort {
	/** The SDK reads the signed-in account; optional, like the SDK's own answer. */
	account?(
		env: Readonly<Record<string, string>>,
	): Promise<Result<{ authenticated: boolean; authMethod?: string }, AppError>>;
	/** Opens the browser and returns the login URL. */
	startLogin(): Promise<Result<LoginInstructions, AppError>>;
	/** Hands back the API key the app stores in the Keychain. */
	finishLogin(loginId: string, code?: string): Promise<Result<LoginOutcome, AppError>>;
	cancelLogin(loginId: string): Promise<Result<void, AppError>>;
}

export interface AgentDetectorDeps {
	runners: RunnerRegistry;
	shellEnv: ShellEnvProvider;
	/** Called with the new list when it differs from the previous one. */
	onChanged(agents: AgentInstall[]): void;
	logger: Logger;
	/** New ids for sign-in flows. */
	ids: IdSource;
	/** Runs short programs: `--version` and `claude auth status --json`. */
	probe: ProbeCommand;
	/** The clock behind the Claude auth cache. Defaults to the system clock. */
	clock?: Clock;
	/** The program path the user chose in Settings, when there is one. */
	executablePath?(agent: AgentKind): string | undefined;
	/** The app's own copy of an agent program (D021), when one is installed. */
	findManagedProgram?(
		selector: RunnerSelector,
		env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null>;
	codex?: CodexAuthPort;
	cursor?: CursorAuthPort;
	/** The Cursor API key the user entered in Settings. */
	cursorApiKey?(): string | undefined;
}

export interface AgentDetector {
	/** Detects every known agent. Sends agentInstallsChanged when the answer changed. */
	detectAll(): Promise<AgentInstall[]>;
	startLogin(agent: AgentKind, acpAgent?: AcpAgent): Promise<Result<LoginInstructions, AppError>>;
	finishLogin(loginId: string, code?: string): Promise<Result<LoginOutcome, AppError>>;
	cancelLogin(loginId: string): Promise<Result<void, AppError>>;
}

interface PendingLogin {
	selector: RunnerSelector;
	instructions: LoginInstructions;
}

interface AuthRead {
	authenticated: boolean;
	authMethod?: string;
}

interface ClaudeAuthCacheEntry {
	path: string;
	readAt: number;
	value: AuthRead;
}

interface ProgramFound {
	path: string;
	source: "managed" | "user" | "login_path";
	version?: string;
}

export class DefaultAgentDetector implements AgentDetector {
	/** Serialised form of the last answer, to tell an unchanged answer from a changed one. */
	private lastSignature: string | undefined;
	/** Bumped by every detectAll() so only the newest run may replace the answer. */
	private generation = 0;
	private readonly pending = new Map<string, PendingLogin>();
	private readonly pendingBySelector = new Map<string, string>();
	/** A start that has not remembered its flow yet, so two callers share one flow. */
	private readonly starting = new Map<string, Promise<Result<LoginInstructions, AppError>>>();
	private claudeAuth: ClaudeAuthCacheEntry | undefined;

	constructor(protected readonly deps: AgentDetectorDeps) {}

	async detectAll(): Promise<AgentInstall[]> {
		const generation = ++this.generation;
		const env = await this.shellEnvironment();
		const entries = this.deps.runners.all();
		const agents = await Promise.all(
			entries.map((entry) => this.detectOne(entry.selector, entry.runner.detect, env)),
		);

		if (generation !== this.generation) {
			this.deps.logger.debug("Dropped an older agent detection result");
			return agents;
		}

		const signature = JSON.stringify(agents);
		const changed = signature !== this.lastSignature;
		this.lastSignature = signature;
		if (!changed) return agents;

		try {
			this.deps.onChanged(agents);
		} catch (cause) {
			this.deps.logger.warn("Could not report changed agent installs", {
				message: messageOf(cause),
			});
		}
		return agents;
	}

	async startLogin(
		agent: AgentKind,
		acpAgent?: AcpAgent,
	): Promise<Result<LoginInstructions, AppError>> {
		const selector: RunnerSelector = acpAgent === undefined ? { agent } : { agent, acpAgent };
		const key = selectorKey(selector);
		// Cursor allows one pending login only: a new start replaces the old one below.
		if (agent !== "cursor") {
			const pendingId = this.pendingBySelector.get(key);
			if (pendingId !== undefined) {
				const pending = this.pending.get(pendingId);
				if (pending !== undefined) return ok(pending.instructions);
			}
		}

		const inFlight = this.starting.get(key);
		if (inFlight !== undefined) return inFlight;

		const started = this.beginLogin(selector).finally(() => {
			if (this.starting.get(key) === started) this.starting.delete(key);
		});
		this.starting.set(key, started);
		return started;
	}

	private async beginLogin(selector: RunnerSelector): Promise<Result<LoginInstructions, AppError>> {
		const agent = selector.agent;
		try {
			if (agent === "claude") {
				const instructions = this.claudeLogin();
				this.remember(selector, instructions);
				return ok(instructions);
			}

			if (agent === "codex") {
				const codex = this.deps.codex;
				if (codex === undefined) return err(this.noLoginFlow(selector));
				const env = await this.shellEnvironment();
				const started = await codex.startDeviceLogin(env);
				if (!started.ok) return started;
				this.remember(selector, started.value);
				return started;
			}

			if (agent === "cursor") {
				const cursor = this.deps.cursor;
				if (cursor === undefined) return err(this.noLoginFlow(selector));
				await this.cancelPendingCursor();
				const started = await cursor.startLogin();
				if (!started.ok) return started;
				this.remember(selector, started.value);
				return started;
			}

			return err(this.noLoginFlow(selector));
		} catch (cause) {
			return err(asAppError("login_start_failed", "Could not start the sign-in", cause));
		}
	}

	async finishLogin(loginId: string, code?: string): Promise<Result<LoginOutcome, AppError>> {
		const pending = this.pending.get(loginId);
		if (pending === undefined) {
			return err(appError(LOGIN_UNKNOWN, "That sign-in is no longer waiting. Start it again."));
		}

		try {
			if (pending.selector.agent === "claude") {
				if (code === undefined || code.trim() === "") {
					return err(appError(LOGIN_CODE_MISSING, "Paste the code that Claude printed."));
				}
				const env = await this.shellEnvironment();
				const path = await this.resolveProgram(pending.selector, env);
				this.forget(loginId);
				if (path === undefined) {
					return ok({
						outcome: "failed",
						message: "Claude Code was not found, so its sign-in could not be checked.",
					});
				}
				this.claudeAuth = undefined;
				const auth = await this.readClaudeAuth(path, env);
				if (auth?.authenticated !== true) {
					return ok({
						outcome: "failed",
						message:
							"Claude does not report a sign-in. Run `claude setup-token` again and paste the new code.",
					});
				}
				return ok({ outcome: "signed_in" });
			}

			if (pending.selector.agent === "codex") {
				const codex = this.deps.codex;
				if (codex === undefined) return err(this.noLoginFlow(pending.selector));
				const finished = await codex.finishLogin(loginId, {
					timeoutMs: CODEX_LOGIN_TIMEOUT_MS,
					...(code === undefined ? {} : { code }),
				});
				this.forget(loginId);
				return finished;
			}

			if (pending.selector.agent === "cursor") {
				const cursor = this.deps.cursor;
				if (cursor === undefined) return err(this.noLoginFlow(pending.selector));
				const finished = await cursor.finishLogin(loginId, code);
				this.forget(loginId);
				return finished;
			}

			this.forget(loginId);
			return err(this.noLoginFlow(pending.selector));
		} catch (cause) {
			this.forget(loginId);
			return err(asAppError("login_finish_failed", "Could not finish the sign-in", cause));
		}
	}

	async cancelLogin(loginId: string): Promise<Result<void, AppError>> {
		const pending = this.pending.get(loginId);
		if (pending === undefined) return ok(undefined);

		try {
			if (pending.selector.agent === "codex") {
				const codex = this.deps.codex;
				this.forget(loginId);
				if (codex === undefined) return ok(undefined);
				return await codex.cancelLogin(loginId);
			}

			if (pending.selector.agent === "cursor") {
				const cursor = this.deps.cursor;
				this.forget(loginId);
				if (cursor === undefined) return ok(undefined);
				return await cursor.cancelLogin(loginId);
			}

			this.forget(loginId);
			return ok(undefined);
		} catch (cause) {
			this.forget(loginId);
			return err(asAppError("login_cancel_failed", "Could not cancel the sign-in", cause));
		}
	}

	private async detectOne(
		selector: RunnerSelector,
		detect: (env: Readonly<Record<string, string>>) => Promise<{
			path: string;
			version: string;
		} | null>,
		env: Readonly<Record<string, string>>,
	): Promise<AgentInstall> {
		const base: Omit<AgentInstall, "installed"> = { agent: selector.agent };
		if (selector.acpAgent !== undefined) base.acpAgent = selector.acpAgent;

		try {
			const found = await this.findProgram(selector, detect, env);
			if (found === null) return { ...base, installed: false };
			if ("warning" in found) {
				return { ...base, installed: false, warning: found.warning };
			}
			return await this.withAuth(base, selector, found, env);
		} catch (cause) {
			this.deps.logger.warn("Could not detect an agent program", {
				agent: selectorKey(selector),
				message: messageOf(cause),
			});
			return { ...base, installed: false };
		}
	}

	private async findProgram(
		selector: RunnerSelector,
		detect: (env: Readonly<Record<string, string>>) => Promise<{
			path: string;
			version: string;
		} | null>,
		env: Readonly<Record<string, string>>,
	): Promise<ProgramFound | { warning: string } | null> {
		const managed = this.deps.findManagedProgram
			? await this.deps.findManagedProgram(selector, env)
			: null;
		if (managed !== null) {
			return {
				path: managed.path,
				source: "managed",
				...(managed.version === "" ? {} : { version: managed.version }),
			};
		}

		const configured = this.deps.executablePath?.(selector.agent);
		if (configured !== undefined && configured !== "") {
			const probed = await this.probeVersion(configured, env);
			if (probed === null) {
				return {
					warning: `Expected ${programName(selector)} at ${configured} was not found.`,
				};
			}
			return {
				path: configured,
				source: "user",
				...(probed === "" ? {} : { version: probed }),
			};
		}

		const found = await detect(env);
		if (found === null) return null;
		return {
			path: found.path,
			source: "login_path",
			...(found.version === "" ? {} : { version: found.version }),
		};
	}

	private async withAuth(
		base: Omit<AgentInstall, "installed">,
		selector: RunnerSelector,
		found: ProgramFound,
		env: Readonly<Record<string, string>>,
	): Promise<AgentInstall> {
		const install: AgentInstall = {
			...base,
			installed: true,
			path: found.path,
			source: found.source,
		};
		if (found.version !== undefined) install.version = found.version;

		const auth = await this.readAuth(selector, found.path, env);
		if (auth === undefined) return install;
		install.authenticated = auth.authenticated;
		if (auth.authMethod !== undefined) install.authMethod = auth.authMethod;
		return install;
	}

	private async readAuth(
		selector: RunnerSelector,
		path: string,
		env: Readonly<Record<string, string>>,
	): Promise<AuthRead | undefined> {
		if (selector.agent === "claude") return this.readClaudeAuth(path, env);

		if (selector.agent === "codex") {
			const codex = this.deps.codex;
			if (codex === undefined) return undefined;
			const account = await codex.account(env);
			if (!account.ok) {
				this.deps.logger.debug("Could not read the Codex account", {
					code: account.error.code,
				});
				return undefined;
			}
			return normalizeAuth(account.value);
		}

		if (selector.agent === "cursor") {
			const cursor = this.deps.cursor;
			if (cursor?.account !== undefined) {
				const account = await cursor.account(env);
				if (account.ok) return normalizeAuth(account.value);
			}
			const key = this.deps.cursorApiKey?.();
			if (key !== undefined && key !== "") {
				return { authenticated: true, authMethod: "api_key" };
			}
			return undefined;
		}

		return undefined;
	}

	/** Reads the Claude account. A successful answer is reused for 60 s (claude-runner 1.3). */
	private async readClaudeAuth(
		path: string,
		env: Readonly<Record<string, string>>,
	): Promise<AuthRead | undefined> {
		const now = this.now();
		const cached = this.claudeAuth;
		if (
			cached !== undefined &&
			cached.path === path &&
			now - cached.readAt < CLAUDE_AUTH_CACHE_MS
		) {
			return cached.value;
		}

		const result = await this.deps.probe(path, ["auth", "status", "--json"], {
			env,
			timeoutMs: VERSION_PROBE_TIMEOUT_MS,
		});
		if (!result.ok) {
			this.deps.logger.debug("Could not read the Claude account", {
				code: result.error.code,
			});
			return undefined;
		}

		const parsed = parseJsonObject(result.value.stdout);
		if (parsed === undefined) return undefined;
		const authenticated =
			typeof parsed.loggedIn === "boolean"
				? parsed.loggedIn
				: typeof parsed.authenticated === "boolean"
					? parsed.authenticated
					: undefined;
		if (authenticated === undefined) return undefined;

		const method =
			typeof parsed.authMethod === "string" ? normalizeAuthMethod(parsed.authMethod) : undefined;
		const value: AuthRead =
			method === undefined ? { authenticated } : { authenticated, authMethod: method };
		this.claudeAuth = { path, readAt: this.now(), value };
		return value;
	}

	/** Finds the program to probe without asking the runner for its version again. */
	private async resolveProgram(
		selector: RunnerSelector,
		env: Readonly<Record<string, string>>,
	): Promise<string | undefined> {
		const runner = this.deps.runners.get(selector);
		const detect = runner.ok ? runner.value.detect : async () => null;
		const found = await this.findProgram(selector, detect, env);
		if (found === null || "warning" in found) return undefined;
		return found.path;
	}

	private now(): number {
		return (this.deps.clock ?? systemClock).now();
	}

	/** Reads a program's version. null means the program is not there; "" means no version. */
	private async probeVersion(
		path: string,
		env: Readonly<Record<string, string>>,
	): Promise<string | null> {
		const result = await this.deps.probe(path, ["--version"], {
			env,
			timeoutMs: VERSION_PROBE_TIMEOUT_MS,
		});
		if (!result.ok) return null;
		return parseVersion(result.value.stdout) ?? "";
	}

	private async shellEnvironment(): Promise<Readonly<Record<string, string>>> {
		const captured = await this.deps.shellEnv.get();
		if (!captured.ok) {
			this.deps.logger.warn("Could not capture the login-shell environment", {
				code: captured.error.code,
			});
			return {};
		}
		return captured.value.env;
	}

	private claudeLogin(): LoginInstructions {
		return {
			loginId: this.deps.ids.uuid(),
			command: "claude setup-token",
			instructions: "Run `claude setup-token` in a terminal, then paste the code it prints here.",
		};
	}

	private noLoginFlow(selector: RunnerSelector): AppError {
		return appError(
			AGENT_AUTH_REQUIRED,
			`${programName(selector)} signs in with its own program. Sign in there, then check again.`,
		);
	}

	private async cancelPendingCursor(): Promise<void> {
		const pendingId = this.pendingBySelector.get(selectorKey({ agent: "cursor" }));
		if (pendingId === undefined) return;
		const pending = this.pending.get(pendingId);
		this.forget(pendingId);
		if (pending === undefined) return;
		const cursor = this.deps.cursor;
		if (cursor === undefined) return;
		const cancelled = await cursor.cancelLogin(pendingId);
		if (!cancelled.ok) {
			this.deps.logger.warn("Could not cancel the previous Cursor sign-in", {
				code: cancelled.error.code,
			});
		}
	}

	private remember(selector: RunnerSelector, instructions: LoginInstructions): void {
		this.pending.set(instructions.loginId, { selector, instructions });
		this.pendingBySelector.set(selectorKey(selector), instructions.loginId);
	}

	private forget(loginId: string): void {
		const pending = this.pending.get(loginId);
		this.pending.delete(loginId);
		if (pending === undefined) return;
		const key = selectorKey(pending.selector);
		if (this.pendingBySelector.get(key) === loginId) this.pendingBySelector.delete(key);
	}
}

function programName(selector: RunnerSelector): string {
	if (selector.agent === "claude") return "Claude Code";
	if (selector.agent === "codex") return "Codex";
	if (selector.agent === "cursor") return "Cursor";
	return selector.acpAgent === "pi" ? "Pi" : "OpenCode";
}

export function parseVersion(stdout: string): string | undefined {
	const match = stdout.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/);
	return match?.[0];
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		const value: unknown = JSON.parse(text.slice(start, end + 1));
		return typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** One spelling for an auth method, whichever agent reported it (other-runners 5). */
function normalizeAuth(value: AuthRead): AuthRead {
	if (value.authMethod === undefined) return value;
	return {
		authenticated: value.authenticated,
		authMethod: normalizeAuthMethod(value.authMethod),
	};
}

function normalizeAuthMethod(method: string): string {
	const lower = method.toLowerCase();
	if (lower.includes("api")) return "api_key";
	if (lower.includes("bedrock")) return "bedrock";
	if (lower.includes("chatgpt")) return "chatgpt";
	return method;
}

function asAppError(code: string, message: string, cause: unknown): AppError {
	if (isAppError(cause)) return cause;
	return appError(code, `${message}: ${messageOf(cause)}`, cause);
}
