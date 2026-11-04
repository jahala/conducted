/**
 * @feature AGENT-01 The runner contract: the runner registry
 * Owns: finding the Runner for a chat's config. There is one Runner per agent, and one per ACP
 * adapter (OpenCode and Pi are separate runners that share the ACP client code).
 * Behaviour: research/conductor/other-runners.md section 0 (the runner factory returns the Claude,
 * Codex, Cursor or ACP runner for an agent type) and section 6 (per-harness env and launch).
 * Must handle: an ACP config without acpAgent (error value naming the missing field), an unknown
 * adapter (error value), and a runner that is registered twice (refused at construction).
 * Test first: get({ agent: "acp", acpAgent: "pi" }) returns the runner registered for pi, and
 * get({ agent: "acp" }) returns an error with code "acp_agent_missing".
 */

import type { AcpAgent, AgentKind } from "@conducted/shared";
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type { Runner } from "./runner.ts";

export interface RunnerSelector {
	agent: AgentKind;
	acpAgent?: AcpAgent | undefined;
}

export interface RunnerRegistry {
	get(selector: RunnerSelector): Result<Runner, AppError>;
	all(): readonly { selector: RunnerSelector; runner: Runner }[];
}

export function selectorKey(selector: RunnerSelector): string {
	return selector.agent === "acp" ? `acp:${selector.acpAgent ?? ""}` : selector.agent;
}

export class MapRunnerRegistry implements RunnerRegistry {
	private readonly byKey = new Map<string, { selector: RunnerSelector; runner: Runner }>();

	constructor(entries: readonly { selector: RunnerSelector; runner: Runner }[]) {
		for (const entry of entries) {
			const key = selectorKey(entry.selector);
			if (this.byKey.has(key)) throw new Error(`Runner registered twice: ${key}`);
			this.byKey.set(key, entry);
		}
	}

	get(selector: RunnerSelector): Result<Runner, AppError> {
		if (selector.agent === "acp" && selector.acpAgent === undefined) {
			return err(appError("acp_agent_missing", "An ACP chat needs an ACP agent (OpenCode or Pi)"));
		}
		const entry = this.byKey.get(selectorKey(selector));
		if (!entry) {
			return err(appError("runner_unknown", `No runner for ${selectorKey(selector)}`));
		}
		return ok(entry.runner);
	}

	all(): readonly { selector: RunnerSelector; runner: Runner }[] {
		return [...this.byKey.values()];
	}
}
