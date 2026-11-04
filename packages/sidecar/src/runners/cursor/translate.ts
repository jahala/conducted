/**
 * @feature AGENT-10 Cursor: translate to the neutral format
 * Owns: turning the messages of a Cursor run into AgentMessage values.
 * Behaviour: research/conductor/other-runners.md section 3: Cursor output is text, thinking, tool
 * calls and tool results plus an error message type; Conductor buffers text and thinking chunks
 * (`pendingText`, `pendingThinking`) and flushes them as one message at tool boundaries or at the
 * end of the turn; tool names are renamed (see tool-names.ts); a plan is shown as the exit-plan
 * tool.
 * Must handle:
 *  - chunk buffering: consecutive text chunks join into one text item; a thinking chunk after text
 *    flushes the text first, so order is kept
 *  - flush() at the end of the turn and before a tool call
 *  - tool input keys are renamed to our canonical input names (path to file_path style naming is
 *    not needed; we keep the agent's input as is and rely on the canonical tool for the card)
 *  - tool results: the output text is cut with truncateOutput; an error result sets isError
 *  - an error message type: an error item, retryable false
 *  - unknown message types: debug log, no throw
 *  - the exact message field names come from the SDK's type definitions, which are checked when
 *    the package is added (cursor-sdk.ts); until then the translator reads fields defensively
 * Test first: two text chunks followed by a shell tool call yield [text("ab")] then
 * [tool_call(bash)] in order.
 */
import type { AgentMessage } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type { CursorSdkMessage } from "./cursor-sdk.ts";

export class CursorTranslator {
	constructor(protected readonly deps: { logger: Logger }) {}

	/** Returns the messages ready to emit after this SDK message. May be empty while buffering. */
	push(_message: CursorSdkMessage): AgentMessage[] {
		return notImplemented("AGENT-10");
	}

	/** Emits whatever is still buffered. Call at the end of the turn. */
	flush(): AgentMessage[] {
		return notImplemented("AGENT-10");
	}
}
