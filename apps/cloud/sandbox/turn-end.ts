/**
 * @feature CLOUD-06 Keep work across sandbox restarts
 * Owns: the container entry's turn-end hook: it follows the chats a relayed `liveState` line says
 * are working and reports the moment the last of them goes idle.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 ("Keeping work": the backup must run at each
 * turn end) and D105 (the entry reports the turn end to the Worker over an internal hostname).
 * Must handle: several chats running in one sandbox (the backup waits for the last one); an idle
 * line for a chat this connection never saw working; a disconnect, which forgets the chats that
 * connection reported.
 * Our design choice: the tracker is per container process, not per WebSocket, because every chat
 * in the sandbox shares `/workspace`. It is reset when the app's connection closes, because a turn
 * that ends while nobody is connected cannot be seen through the relay.
 * Test first: reports a turn end only when the last running chat goes idle.
 */
import type { TurnChange } from "../src/relay.ts";

export class TurnEndTracker {
	private readonly working = new Set<string>();

	/**
	 * Notes one relayed turn change. True only when this was the change that left no chat working,
	 * which is the moment the entry asks the Worker to save the sandbox.
	 */
	note(change: TurnChange | null): boolean {
		if (change === null || change.sessionId === null) return false;
		if (change.status === "working") {
			this.working.add(change.sessionId);
			return false;
		}
		if (!this.working.delete(change.sessionId)) return false;
		return this.working.size === 0;
	}

	/** Forgets every running chat, after the app's connection closes. */
	reset(): void {
		this.working.clear();
	}
}
