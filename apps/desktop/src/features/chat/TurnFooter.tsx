/**
 * @feature CHAT-06 Turn footer
 * Owns: The footer under a finished turn: copy actions, token and time details, the file-change
 * summary and the fork and reset menu.
 * Behaviour: ui-map.md 3.3 (Turn footer: 'Copy final message', 'Copy summary', hover card with
 * start and end time and Input, Output, Cache read, Cache write tokens; More menu: 'Fork to new
 * tab', 'Fork to new workspace', 'Reset chat', copy options).
 * Our design choice: Fork to a new workspace is not in the scaffold backlog beyond CHAT-16; its
 * item is shown disabled with the reason until built.
 * Must handle: A running turn (no footer); no usage reported (the hover card says so); no
 * checkpoint (Fork and Reset disabled with a reason); a cancelled or errored turn (footer still
 * copies); reduced width (actions collapse into the More menu).
 * Test first: A finished turn with usage shows token counts in the hover card; without a checkpoint
 * Reset is disabled.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { ChatTurn } from "../../core/model.ts";

export interface TurnFooterProps {
	turn: ChatTurn;
	sessionId: SessionId;
}

export function TurnFooter(_props: TurnFooterProps): never {
	return notImplemented("CHAT-06");
}
