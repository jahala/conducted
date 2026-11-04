/**
 * @feature CHAT-04 Follow-up queue
 * Owns: The box above the composer that lists queued messages, with edit, reorder, delete, pause
 * and send-as-steer.
 * Behaviour: ui-map.md 3.4 (queue box role listbox 'Queued messages'; header status and 'Resume'
 * when paused, 'Collapse queue' or 'Expand queue'; rows with attachment thumbs, preview, Edit or
 * 'Save edit', Steer, Delete; keys E edit, Backspace delete, Enter steer, Escape cancel edit,
 * Cmd+Enter 'Save and steer'; reorder by drag; errors such as 'Failed to delete queued message').
 * Our design choice: OpenCode and Pi cannot be steered: their Steer button is disabled with 'This
 * agent can't be steered'. The default follow-up behaviour (queue or steer) is the setting
 * 'Follow-up behavior'.
 * Must handle: Empty queue (renders nothing); paused queue (shows 'Resume'); a message that failed
 * to send (row shows the error and Retry); editing a message that the agent has just started (the
 * edit is refused with a message); drag reorder fails (order returns, toast); many rows (collapsed
 * to the first few).
 * Test first: Deleting a queued message calls sessions.queue.remove(id); a failure restores the row
 * and shows 'Failed to delete queued message'.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface QueueBoxProps {
	sessionId: SessionId;
}

export function QueueBox(_props: QueueBoxProps): never {
	return notImplemented("CHAT-04");
}
