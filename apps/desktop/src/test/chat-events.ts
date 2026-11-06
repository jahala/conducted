/**
 * @feature test support Chat events for screen tests
 * Owns: appending events through the real repository, and the checkpoint event builder that the
 * shared fixtures do not have.
 * Behaviour: not applicable, test support only.
 * Must handle: a failed append throws, so a test never runs on a half-written log.
 * Test first: not applicable.
 */

import type { SessionEvent } from "@conducted/protocol";
import type { CheckpointId, EventId, SessionId, TurnId } from "@conducted/shared";
import type { Container } from "../core/container.ts";
import { createRepositories } from "../core/db/repositories.ts";
import { agentEvent, turnEndedEvent, userMessageEvent } from "../core/db/test-fixtures.ts";

export { agentEvent, turnEndedEvent, userMessageEvent };

export const checkpointEvent = (
	id: string,
	turn: string,
	at: number,
	phase: "start" | "end",
	checkpointId: string,
): SessionEvent => ({
	type: "checkpoint",
	eventId: id as EventId,
	at,
	turnId: turn as TurnId,
	phase,
	checkpointId: checkpointId as CheckpointId,
});

/** Appends events to a chat in order through the app's own repository. */
export async function appendChatEvents(
	container: Container,
	sessionId: SessionId,
	events: readonly SessionEvent[],
): Promise<void> {
	const repositories = createRepositories(container.platform.db, {
		clock: { now: () => 0 },
		ids: { uuid: () => crypto.randomUUID() },
	});
	for (const event of events) {
		const appended = await repositories.sessionEvents.append(sessionId, event, event.at);
		if (!appended.ok) throw new Error(JSON.stringify(appended.error));
	}
}
