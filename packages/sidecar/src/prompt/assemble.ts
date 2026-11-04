/**
 * @feature SIDE-09 Prompt assembly: first-message instruction, mentions, attachments, preferences
 * Owns: building the final text sent to the agent from the user's message, in a fixed order.
 * Behaviour: research/conductor/sessions.md section 9 "Message enrichment" and claude-runner.md
 * section 5: the sidecar, not the app, builds the final message. Order here: workspace instruction
 * (first message only), the expanded message, the attachments block, the preferences block.
 * Must handle:
 *  - the first message gets the instruction block; later messages do not
 *  - the steer case: a steer is assembled like a later message (no instruction block)
 *  - pull-request mentions: write the stub file once, never overwrite, create .context/pull-requests
 *  - a stub that cannot be written: the message still goes out with the link, the failure is
 *    logged (the agent can ask the user), nothing is dropped silently
 *  - the stored user_message event keeps the raw text; only the agent sees the assembled one
 * Test first: assemble with firstMessage true starts with the instruction tag and ends with the
 * user's text when there are no attachments or preferences.
 */
import type { WorkspaceContext } from "@conducted/protocol";
import type { AppError, Result } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";

export interface PromptInput {
	text: string;
	attachmentPaths: readonly string[];
	firstMessage: boolean;
	workspace: WorkspaceContext;
}

export interface PromptAssembler {
	assemble(input: PromptInput): Promise<Result<string, AppError>>;
}

/** Writes `.context/pull-requests/<n>.md` if it does not exist yet. A port; production uses node:fs. */
export type WritePullRequestStub = (
	workspacePath: string,
	number: number,
) => Promise<Result<void, AppError>>;

export class MessagePromptAssembler implements PromptAssembler {
	constructor(
		protected readonly deps: {
			writePullRequestStub: WritePullRequestStub;
			logger: Logger;
		},
	) {}

	assemble(_input: PromptInput): Promise<Result<string, AppError>> {
		return notImplemented("SIDE-09");
	}
}
