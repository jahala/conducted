/**
 * @feature SET-02 General settings page
 * Owns: the General page of Settings: how messages are sent, notifications, sound, and everyday
 * app behaviour.
 * Behaviour: ui-map.md 6, "General" table and "Control values" (send key, follow-up behaviour,
 * completion sound). Left out as cloud or team: "@ notifications" (teammates), "Workspace API
 * access", "Show Artifacts tab". Keys below are the research keys (services-map.md 4.2.3);
 * the settings registry (SET-01) owns the final names.
 * Rows (our wording), key, control:
 *   Send messages with            message_send_key             select: Enter, Cmd+Enter
 *   When the agent is busy        default_message_send_mode    select: queue the message, steer the turn
 *   Notify when an agent finishes notifications_enabled        toggle
 *   Sound when a chat finishes    sound_type                   select: none plus our own sounds,
 *                                                              with a play button
 *   Full disk access              (no key)                     status and a button that opens the
 *                                                              macOS privacy pane
 *   Arrange workspaces by hand    manual_workspace_order       toggle
 *   Turn long pasted text into    auto_convert_long_text       toggle (threshold 5,000 characters)
 *   an attachment
 *   Always show context usage     always_show_context_wheel    toggle (otherwise shown above 70%)
 *   Keep the Mac awake while      caffeinate_while_agents_running toggle (stops below 10% battery)
 *   agents work
 *   Restart on update when idle   auto_restart_on_update_when_idle toggle
 *   Expand tool calls by default  garry_mode                   toggle
 *   Share agent configs between   (key set by SET-01)          toggle: copy skills, slash commands
 *   Claude Code and Codex                                      and MCP servers between them
 * Sounds: Conductor's sound files are its own assets and are not copied. Open question: which
 * sounds we ship.
 * Must handle: loading and error of settings, a save that fails (value reverts, message under the
 * row), caffeinate unavailable (row disabled with reason), notification permission denied (row
 * shows how to allow it), and a sound that fails to play.
 * Test first: changing "Send messages with" calls settings.set with the new value once.
 */
import { notImplemented } from "@conducted/shared";

export function GeneralPage(): never {
	return notImplemented("SET-02");
}
