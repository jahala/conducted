/**
 * @feature SIDE-14 Model catalog per agent
 * Owns: the list of models the picker shows for each agent, and the check that a chosen model is
 * valid for an agent before a turn starts.
 * Behaviour: research/conductor/other-runners.md section 5 "Model catalog" and "Dynamic discovery"
 * (Claude and Cursor use a static table with picker, gated and deprecated entries; Codex lists
 * models through `model/list`; ACP agents report them as a `category: model` config option and
 * OpenCode needs up to 15 s for the list to arrive).
 * Must handle:
 *  - an agent that is not installed: return the runner's reason, never a guessed list
 *  - a model id the agent no longer offers: validate() returns an error value naming it
 *  - a slow ACP catalog: the 15 s wait lives in the ACP runner, this class only caches the answer
 *  - two callers at once: one discovery run (single flight)
 *  - the cache is cleared when agentInstallsChanged fires, because a new CLI version can add models
 *  - a discovery that was already running when the cache was cleared never overwrites the new one
 * Test first: validate() on a model that is not in the runner's list returns an error whose code is
 * "model_unknown".
 * Our design choice: no static model table is shipped in the scaffold. Model ids and effort levels
 * change often, so every runner reports its own list (Claude through supportedModels() on the SDK
 * query object, Codex through model/list, ACP through config options). Entries for Cursor, which
 * has no list call, are added when AGENT-09 is built, from the Cursor documentation.
 * Our design choice: the cache is in memory only and lives for one hour, the interval at which
 * Conductor refreshes its hosted catalog (services-map 5B.5.1). It is never written to disk. The
 * default model is the entry the runner marks `isDefault`; when none is marked the caller uses the
 * user's default_model setting (sessions-agents-native, section 5).
 */
import type { ModelInfo, SessionConfig } from "@conducted/protocol";
import type { AcpAgent, AgentKind, Clock } from "@conducted/shared";
import { type AppError, appError, err, ok, type Result, systemClock } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { type RunnerRegistry, selectorKey } from "../runners/registry.ts";
import type { Runner } from "../runners/runner.ts";

/** How long a discovered list is reused. Conductor refreshes its catalog every hour. */
export const MODEL_CATALOG_TTL_MS = 60 * 60 * 1000;

/** The chosen model is not in the agent's current list. */
export const MODEL_UNKNOWN = "model_unknown";
/** The chosen model does not accept this effort level. */
export const EFFORT_UNKNOWN = "effort_unknown";
/** The chosen model does not offer fast mode. */
export const FAST_MODE_UNSUPPORTED = "fast_mode_unsupported";
/** The agent's list could not be read for a reason other than a missing program. */
export const MODEL_LIST_FAILED = "model_list_failed";
/** The agent program is missing, so there is no list to show. */
export const AGENT_NOT_INSTALLED = "agent_not_installed";

interface CacheEntry {
	models: ModelInfo[];
	/** When the list was read, in milliseconds since the epoch. */
	at: number;
}

export interface ModelCatalog {
	list(agent: AgentKind, acpAgent?: AcpAgent): Promise<Result<ModelInfo[], AppError>>;
	/** Checks the model, effort and fast-mode flags of a config against the agent's list. */
	validate(config: SessionConfig): Promise<Result<ModelInfo, AppError>>;
	/** Drops cached lists. */
	invalidate(): void;
}

export class RunnerModelCatalog implements ModelCatalog {
	private readonly cache = new Map<string, CacheEntry>();
	private readonly inFlight = new Map<string, Promise<Result<ModelInfo[], AppError>>>();
	private readonly clock: Clock;
	/** Bumped by invalidate() so an older discovery cannot fill the cache again. */
	private generation = 0;

	constructor(
		protected readonly deps: {
			runners: RunnerRegistry;
			logger: Logger;
			/** Optional so existing wiring keeps working; tests pass their own clock. */
			clock?: Clock;
		},
	) {
		this.clock = deps.clock ?? systemClock;
	}

	async list(agent: AgentKind, acpAgent?: AcpAgent): Promise<Result<ModelInfo[], AppError>> {
		const runner = this.deps.runners.get({ agent, acpAgent });
		if (!runner.ok) return runner;

		const selector = { agent, acpAgent };
		const key = selectorKey(selector);
		const cached = this.cache.get(key);
		if (cached !== undefined && this.clock.now() - cached.at < MODEL_CATALOG_TTL_MS) {
			this.deps.logger.debug("Model catalog cache hit", {
				agent: key,
				models: cached.models.length,
			});
			return ok([...cached.models]);
		}

		const pending = this.inFlight.get(key);
		if (pending !== undefined) return pending;

		const started = this.discover(key, runner.value);
		this.inFlight.set(key, started);
		void started.finally(() => {
			if (this.inFlight.get(key) === started) this.inFlight.delete(key);
		});
		return started;
	}

	async validate(config: SessionConfig): Promise<Result<ModelInfo, AppError>> {
		const listed = await this.list(config.agent, config.acpAgent);
		if (!listed.ok) return listed;

		const model = listed.value.find((entry) => entry.id === config.model);
		if (model === undefined) {
			return err(
				appError(
					MODEL_UNKNOWN,
					`This agent no longer offers the model "${config.model}". Choose another model.`,
				),
			);
		}

		if (model.efforts.length > 0 && !model.efforts.includes(config.effort)) {
			return err(
				appError(
					EFFORT_UNKNOWN,
					`The model "${model.label}" does not support the ${config.effort} effort level.`,
				),
			);
		}

		if (config.fastMode && !model.supportsFastMode) {
			return err(
				appError(FAST_MODE_UNSUPPORTED, `The model "${model.label}" does not support fast mode.`),
			);
		}

		return ok(model);
	}

	invalidate(): void {
		this.generation += 1;
		this.cache.clear();
		this.inFlight.clear();
		this.deps.logger.debug("Model catalog cache cleared");
	}

	private async discover(key: string, runner: Runner): Promise<Result<ModelInfo[], AppError>> {
		const generation = this.generation;
		try {
			const models = await runner.listModels();
			if (generation === this.generation) {
				this.cache.set(key, { models, at: this.clock.now() });
			}
			this.deps.logger.debug("Listed agent models", { agent: key, models: models.length });
			return ok([...models]);
		} catch (cause) {
			const error = asAppError(cause, key);
			this.deps.logger.warn("Could not list agent models", { agent: key, code: error.code });
			return err(error);
		}
	}
}

/**
 * Runners report a missing program as an ordinary Error or as an AppError. Keep the AppError code
 * so the app can answer agentNotInstalled; wrap anything else so callers always get a value.
 */
function asAppError(cause: unknown, key: string): AppError {
	if (isAppError(cause)) return cause;
	const message = cause instanceof Error ? cause.message : String(cause);
	if (NOT_INSTALLED.test(message)) return appError(AGENT_NOT_INSTALLED, message, cause);
	return appError(MODEL_LIST_FAILED, `Could not list models for ${key}: ${message}`, cause);
}

const NOT_INSTALLED = /not installed|not found on (the )?PATH|missing from PATH/i;

function isAppError(value: unknown): value is AppError {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { code?: unknown; message?: unknown };
	return typeof candidate.code === "string" && typeof candidate.message === "string";
}
