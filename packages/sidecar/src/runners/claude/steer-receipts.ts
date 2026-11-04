/**
 * @feature AGENT-05 Claude: steer with a "read by the agent" receipt
 * Owns: remembering which steer messages the agent has not read yet, and resolving each one when
 * the agent writes it into its transcript.
 * Behaviour: research/conductor/claude-runner.md section 6: a steer is another user message pushed
 * into the same input stream with a fresh uuid; the CLI mirrors its transcript to a session store
 * (--session-mirror); a mirrored `user` entry, or an `attachment` entry of type `queued_command`
 * with a `source_uuid`, means the agent consumed that message. Until then the app shows the steer
 * as pending.
 * Must handle:
 *  - consume() for a uuid nobody registered is ignored (mirrored entries of ordinary messages)
 *  - the same uuid consumed twice resolves once
 *  - clear() when the turn ends or is cancelled: waiting receipts resolve (the message is no
 *    longer pending in any useful sense) so no promise leaks
 *  - hasPending() lets the turn tracker hold back a result that arrived before the steer was read
 *  - entries with no uuid or a shape we do not know are ignored
 * Test first: register("u1") returns a promise that is still pending; consume("u1") resolves it;
 * hasPending() is then false.
 */
export class SteerReceipts {
	private readonly waiting = new Map<string, () => void>();

	/** Starts waiting for the agent to read the message with this uuid. */
	register(uuid: string): Promise<void> {
		return new Promise<void>((resolve) => {
			this.waiting.set(uuid, resolve);
		});
	}

	consume(uuid: string): boolean {
		const resolve = this.waiting.get(uuid);
		if (!resolve) return false;
		this.waiting.delete(uuid);
		resolve();
		return true;
	}

	hasPending(): boolean {
		return this.waiting.size > 0;
	}

	/** Resolves every waiting receipt and forgets them. */
	clear(): void {
		for (const resolve of this.waiting.values()) resolve();
		this.waiting.clear();
	}
}

/**
 * The uuid of the user message a mirrored transcript entry proves was read, or null.
 * Entries are loosely typed by the SDK (SessionStoreEntry), so every field is checked.
 */
export function consumedUuidFromMirrorEntry(entry: unknown): string | null {
	if (!entry || typeof entry !== "object") return null;
	const record = entry as Record<string, unknown>;
	if (record.type === "user" && typeof record.uuid === "string") return record.uuid;
	if (record.type === "attachment") {
		const attachment = record.attachment;
		if (attachment && typeof attachment === "object") {
			const inner = attachment as Record<string, unknown>;
			if (inner.type === "queued_command" && typeof record.source_uuid === "string") {
				return record.source_uuid;
			}
			if (inner.type === "queued_command" && typeof inner.source_uuid === "string") {
				return inner.source_uuid;
			}
		}
	}
	return null;
}
