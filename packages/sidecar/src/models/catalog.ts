/**
 * @feature SIDE-14 Model catalog per agent
 * Owns: the list of models the picker shows for each agent, and the check that a chosen model is
 * valid for an agent before a turn starts.
 * Behaviour: research/conductor/other-runners.md section 5 "Model catalog" and "Dynamic discovery"
 * (Claude and Cursor use a static table with picker, gated and deprecated entries; Codex lists
 * models through `model/list`; ACP agents report them as a `category: model` config option and
 * OpenCode needs up to 15 s for the list to arrive).
 * Must handle:
 *  - an agent that is not installed: return an empty list with the reason, not a guess
 *  - a model id the agent no longer offers: validate() returns an error value naming it
 *  - a slow ACP catalog: the 15 s wait lives in the ACP runner, this class only caches the answer
 *  - two callers at once: one discovery run (single flight)
 *  - the cache is cleared when agentInstallsChanged fires, because a new CLI version can add models
 * Test first: validate() on a model that is not in the runner's list returns an error whose code is
 * "model_unknown".
 * Our design choice: no static model table is shipped in the scaffold. Model ids and effort levels
 * change often, so every runner reports its own list (Claude through supportedModels() on the SDK
 * query object, Codex through model/list, ACP through config options). Entries for Cursor, which
 * has no list call, are added when AGENT-09 is built, from the Cursor documentation.
 */

import type { ModelInfo, SessionConfig } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { type AppError, notImplemented, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { RunnerRegistry } from "../runners/registry.ts";

export interface ModelCatalog {
	list(agent: AgentKind, acpAgent?: AcpAgent): Promise<Result<ModelInfo[], AppError>>;
	/** Checks the model, effort and fast-mode flags of a config against the agent's list. */
	validate(config: SessionConfig): Promise<Result<ModelInfo, AppError>>;
	/** Drops cached lists. */
	invalidate(): void;
}

export class RunnerModelCatalog implements ModelCatalog {
	constructor(
		protected readonly deps: {
			runners: RunnerRegistry;
			logger: Logger;
		},
	) {}

	list(_agent: AgentKind, _acpAgent?: AcpAgent): Promise<Result<ModelInfo[], AppError>> {
		return notImplemented("SIDE-14");
	}

	validate(_config: SessionConfig): Promise<Result<ModelInfo, AppError>> {
		return notImplemented("SIDE-14");
	}

	invalidate(): void {
		notImplemented("SIDE-14");
	}
}
