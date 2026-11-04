/**
 * @feature SET-02 Default models settings page
 * Owns: the Default models page of Settings: which agent and model new chats start with, and the
 * defaults for review.
 * Behaviour: ui-map.md 6, "Default models" table; services-map.md 4.2.3 (models and providers).
 * Data: useModels(agent) for each agent, useAgentInstalls() to hide agents that are not installed,
 * useSetting and useActions().settings.
 * Rows (our wording), key, control:
 *   Model for new chats           default_model                select grouped by agent
 *   Fast mode by default          default_fast_mode            toggle (only if the model supports it)
 *   Plan mode by default          default_plan_mode            toggle
 *   Claude effort level           default_claude_effort_level  select from the model's efforts
 *   Claude style                  default_claude_personality   select
 *   Codex thinking level          default_codex_thinking_level select
 *   Codex personality             default_codex_personality    select
 *   Model for reviews             review_model                 select
 *   Review fast mode and effort   review_fast_mode,
 *                                 review_claude_effort_level,
 *                                 review_codex_thinking_level  as above
 * Must handle: models loading (disabled select with skeleton), no agent installed (explain and
 * link to the Agents page), a stored model that no longer exists (shown as unavailable and a new
 * pick required, no silent switch), and an effort that the chosen model does not support (reset
 * with a visible note).
 * Test first: picking a model without fast mode support disables the fast mode toggle.
 */
import { notImplemented } from "@conducted/shared";

export function DefaultModelsPage(): never {
	return notImplemented("SET-02");
}
