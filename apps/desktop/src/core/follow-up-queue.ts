/**
 * @feature CHAT-04 Follow-up queue and steering
 * Owns: the rule that an ACP agent cannot take a steer, and the order queue rows are shown in. The
 * follow-up queue service and the queue box share them.
 * Behaviour: services-map.md 5B.4 (steering, queueing).
 */
import type { SessionConfig } from "@conducted/protocol";
import type { QueuedMessage } from "./model.ts";

/** ACP agents (OpenCode, Pi) cannot take a message in the middle of a turn. */
export const agentCanSteer = (config: Pick<SessionConfig, "agent">): boolean =>
	config.agent !== "acp";

/** Queue rows are shown in their stored order. */
export function byPosition(a: QueuedMessage, b: QueuedMessage): number {
	return a.position - b.position || a.id.localeCompare(b.id);
}
