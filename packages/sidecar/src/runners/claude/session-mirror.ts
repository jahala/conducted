/**
 * @feature AGENT-05 Claude: the transcript mirror that proves a steer was read
 * Owns: the tiny SessionStore adapter given to the Agent SDK. It keeps no transcript. It only
 * tells the runner which user messages the agent wrote into its own transcript.
 * Behaviour: research/conductor/claude-runner.md section 6: with a sessionStore the SDK starts the
 * CLI with --session-mirror and calls store.append for every batch of transcript entries; load
 * returns null so a resume still reads the CLI's own files under ~/.claude/projects; listing
 * methods are left out.
 * Must handle: append must not throw (a throw would surface as a mirror error in the stream),
 * entries of any shape (checked in steer-receipts.ts), load always null, and flush mode "eager" so
 * the receipt is not delayed by batching.
 * Test first: append([{ type: "user", uuid: "u1" }]) calls the consumed callback with "u1".
 */
import type { SessionStore } from "@anthropic-ai/claude-agent-sdk";
import { consumedUuidFromMirrorEntry } from "./steer-receipts.ts";

export function createMirrorStore(onConsumed: (uuid: string) => void): SessionStore {
	return {
		append: async (_key, entries) => {
			for (const entry of entries) {
				const uuid = consumedUuidFromMirrorEntry(entry);
				if (uuid !== null) onConsumed(uuid);
			}
		},
		load: async () => null,
	};
}
