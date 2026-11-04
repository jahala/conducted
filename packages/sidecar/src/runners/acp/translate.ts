/**
 * @feature AGENT-12 ACP adapters for OpenCode and Pi: translate ACP updates
 * Owns: turning `session/update` notifications into AgentMessage values.
 * Behaviour: research/conductor/other-runners.md section 3: streaming text and thought chunks are
 * buffered and flushed as one message at tool boundaries or the end of the turn; a plan becomes a
 * todo list; diff content is shown as an edit; usage updates feed the context wheel; questions
 * (permission requests with several allow options) become question interactions elsewhere, not
 * messages. ACP update kinds (from @agentclientprotocol/sdk SessionUpdate): user_message_chunk,
 * agent_message_chunk, agent_thought_chunk, tool_call, tool_call_update, plan,
 * available_commands_update, current_mode_update, config_option_update, session_info_update,
 * usage_update, notice, compaction_update, compaction_summary_chunk.
 * Mapping:
 *  - agent_message_chunk: text, buffered; agent_thought_chunk: thinking, buffered
 *  - tool_call: tool_call with canonicalToolForAcp, rawName from `name` or `title`, rawInput as
 *    input; tool_call_update with a terminal status (completed, failed): tool_result with the
 *    text content, isError for failed, output cut with truncateOutput
 *  - plan: todo item (pending, in_progress, completed map to pending, in_progress, done)
 *  - usage_update: usage item with contextUsedTokens = used and contextWindowTokens = size
 *  - notice: notice "info" (severity error: error item); compaction_update: notice "compacted"
 *  - ignored: user_message_chunk (our own message echoed back), available_commands_update,
 *    current_mode_update, config_option_update, session_info_update (handled by the session)
 * Must handle: a tool_call_update that arrives before its tool_call (kept until the call is seen,
 * dropped at the end of the turn with a debug log), several updates for one call (only the last
 * terminal one makes a result), a flush before every tool call so order is kept, content blocks
 * that are not text (image and audio are skipped with a placeholder text such as "[image]"), and a
 * turn that ends while text is buffered (flush() emits it).
 * Test first: two agent_message_chunk updates then a tool_call yield text("ab") then tool_call in
 * order.
 */
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentMessage, CanonicalTool } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";

export class AcpTranslator {
	constructor(
		protected readonly deps: {
			/** The adapter's name hints (adapters/adapter.ts). */
			toolNameHints: Readonly<Record<string, CanonicalTool>>;
			logger: Logger;
		},
	) {}

	push(_update: SessionUpdate): AgentMessage[] {
		return notImplemented("AGENT-12");
	}

	flush(): AgentMessage[] {
		return notImplemented("AGENT-12");
	}
}
