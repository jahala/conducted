/**
 * @feature CHAT-14 Context window per model
 * Owns: the context window sizes agents reported per model, loaded from model_context_windows at
 * start and kept up to date as the event ingest records new reports, and the lookup the context
 * meter uses for a chat whose own agent has not reported a size yet.
 * Behaviour: services-map.md 1.5 (the context window size is kept per model, store `sg`,
 * `contextWindowsByModel`) and 2.7.2 (Claude context windows are remembered); claude-runner.md 7
 * (agents report usage and window per turn). The research gives no window sizes, so none ship
 * with the app: every size comes from an agent's own report.
 * Must handle: a model with no report (no size: the meter says the size is not available yet), an
 * ACP agent (its sizes are kept apart from other agents' sizes for the same model id), and a
 * failed load (reported, the meter works without remembered sizes).
 * Test first: a chat with no reported window shows the size the same model reported in another
 * chat.
 */
import type { AgentItem, SessionConfig } from "@conducted/protocol";
import { ok, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ModelContextWindowRepository } from "../db/model-context-windows.ts";

export interface ContextWindowsState {
	/** Sizes by `contextWindowKey`. */
	byModel: Readonly<Record<string, number>>;
}

/** The agent part of a remembered size: the agent kind, or "acp:<agent>" for an ACP agent. */
export function contextWindowAgent(config: Pick<SessionConfig, "agent" | "acpAgent">): string {
	return config.agent === "acp" ? `acp:${config.acpAgent ?? ""}` : config.agent;
}

const keyOf = (agent: string, model: string): string => `${agent}\n${model}`;

/** The key of a remembered size: the agent and the model id the chat was started with. */
export function contextWindowKey(
	config: Pick<SessionConfig, "agent" | "acpAgent" | "model">,
): string {
	return keyOf(contextWindowAgent(config), config.model);
}

/** The window size an agent message reports, from its last usage item. Null when it has none. */
export function reportedContextWindow(items: readonly AgentItem[]): number | null {
	let window: number | null = null;
	for (const item of items) {
		if (item.kind === "usage" && item.contextWindowTokens !== undefined) {
			window = item.contextWindowTokens;
		}
	}
	return window;
}

export interface ContextWindowServiceDeps {
	repository: () => Pick<ModelContextWindowRepository, "list">;
}

export class ContextWindowService {
	readonly store: StoreApi<ContextWindowsState> = createStore<ContextWindowsState>(() => ({
		byModel: {},
	}));
	readonly #deps: ContextWindowServiceDeps;

	constructor(deps: ContextWindowServiceDeps) {
		this.#deps = deps;
	}

	/** Loads the stored sizes. A size remembered meanwhile wins over the stored one. */
	async start(): Promise<Result<void>> {
		const listed = await this.#deps.repository().list();
		if (!listed.ok) return listed;
		const loaded: Record<string, number> = {};
		for (const row of listed.value) loaded[keyOf(row.agent, row.model)] = row.windowTokens;
		this.store.setState((state) => ({ byModel: { ...loaded, ...state.byModel } }));
		return ok(undefined);
	}

	/** Called after the ingest stored a report, so open meters see it at once. */
	remember(agent: string, model: string, windowTokens: number): void {
		const key = keyOf(agent, model);
		if (this.store.getState().byModel[key] === windowTokens) return;
		this.store.setState((state) => ({ byModel: { ...state.byModel, [key]: windowTokens } }));
	}
}
