/**
 * @feature CHAT-14 Context window per model
 * Owns: the keys the context window meter reads when it looks up a model's remembered size. The
 * context-windows service and the ingest path share them.
 * Behaviour: services-map.md 1.5 (context window per model), claude-runner.md 7 (agents report
 * usage and window per turn).
 */
import type { SessionConfig } from "@conducted/protocol";

/** The agent part of a remembered size: the agent kind, or "acp:<agent>" for an ACP agent. */
export function contextWindowAgent(config: Pick<SessionConfig, "agent" | "acpAgent">): string {
	return config.agent === "acp" ? `acp:${config.acpAgent ?? ""}` : config.agent;
}

/** The key of a remembered size from its stored agent part and a model id. */
export const contextWindowKeyOf = (agent: string, model: string): string => `${agent}\n${model}`;

/** The key of a remembered size: the agent and the model id the chat was started with. */
export function contextWindowKey(
	config: Pick<SessionConfig, "agent" | "acpAgent" | "model">,
): string {
	return contextWindowKeyOf(contextWindowAgent(config), config.model);
}
