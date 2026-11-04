/**
 * @feature CHAT-13 Progress tracker
 * Owns: The one-line progress display above the composer, fed by the agent's UpdateProgress tool.
 * Behaviour: ui-map.md 3.3 (Progress tracker: the agent sends {title?, blocks[]}; block types bar
 * {label,value,max,detail}, steps [{label,status pending|in_progress|done|failed}], text; the
 * composer shows the current step with '· 2/5' and a status colour), claude-runner.md 4.2.
 * Data: ChatView.progress (ProgressView in core/model.ts: a title and blocks of kind bar, steps
 * or text).
 * Our design choice: Conductor gates this behind an internal flag. Here it is on whenever the
 * session's appTools.progressUpdates is on.
 * Must handle: No progress (renders nothing); all steps done (shows 'Done' then hides after the
 * turn ends); a failed step (danger colour and the word 'Failed'); several bars; progress cleared
 * when a new turn starts.
 * Test first: Steps [done, in_progress, pending] render the current step's label and '2/3'.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ProgressTrackerProps {
	sessionId: SessionId;
}

export function ProgressTracker(_props: ProgressTrackerProps): never {
	return notImplemented("CHAT-13");
}
