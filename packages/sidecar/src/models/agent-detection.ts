/**
 * @feature SIDE-15 Agent detection, versions and sign-in flows
 * Owns: finding the installed agent programs, reading their versions, checking whether each is
 * signed in, and starting an agent's own sign-in flow.
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
 * Test first: detectAll() with a runner whose detect() returns null yields installed false and
 * emits no agentInstallsChanged when nothing changed since the last call.
 */
import type { AgentInstall } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { type AppError, notImplemented, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { RunnerRegistry } from "../runners/registry.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";

export const VERSION_PROBE_TIMEOUT_MS = 5_000;

export interface LoginInstructions {
	url?: string;
	code?: string;
	instructions: string;
}

export interface AgentDetector {
	/** Detects every known agent. Sends agentInstallsChanged when the answer changed. */
	detectAll(): Promise<AgentInstall[]>;
	startLogin(agent: AgentKind, acpAgent?: AcpAgent): Promise<Result<LoginInstructions, AppError>>;
}

export class DefaultAgentDetector implements AgentDetector {
	constructor(
		protected readonly deps: {
			runners: RunnerRegistry;
			shellEnv: ShellEnvProvider;
			/** Called with the new list when it differs from the previous one. */
			onChanged(agents: AgentInstall[]): void;
			logger: Logger;
		},
	) {}

	detectAll(): Promise<AgentInstall[]> {
		return notImplemented("SIDE-15");
	}

	startLogin(
		_agent: AgentKind,
		_acpAgent?: AcpAgent,
	): Promise<Result<LoginInstructions, AppError>> {
		return notImplemented("SIDE-15");
	}
}
