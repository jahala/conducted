import { describe, expect, test } from "bun:test";
import {
	fileNameFor,
	OUTBOX_FILE_VERSION,
	sessionIdFromFileName,
	zOutboxFile,
} from "./outbox-file.ts";

describe("SIDE-06 event outbox file", () => {
	test("SIDE-06 a session id with unsafe characters round-trips through a safe file name", () => {
		const name = fileNameFor("a/b ../ü");
		expect(name).not.toContain("/");
		expect(name.endsWith(".json")).toBe(true);
		expect(sessionIdFromFileName(name)).toBe("a/b ../ü");
	});

	test("SIDE-06 the file name is the base64url of the UTF-8 session id", () => {
		const sessionId = "chat/with spaces ü";
		const expected = `${Buffer.from(sessionId, "utf8").toString("base64url")}.json`;
		expect(fileNameFor(sessionId)).toBe(expected);
		expect(sessionIdFromFileName(expected)).toBe(sessionId);
	});

	test("SIDE-06 files that are not outbox files are ignored", () => {
		expect(sessionIdFromFileName("notes.txt")).toBeNull();
		expect(sessionIdFromFileName("a b.json")).toBeNull();
		expect(sessionIdFromFileName(".json")).toBeNull();
	});

	test("SIDE-06 the file holds its version, session id, next sequence and pending list", () => {
		const parsed = zOutboxFile.safeParse({
			version: OUTBOX_FILE_VERSION,
			sessionId: "session-1",
			nextSequence: 4,
			pending: [
				{
					eventId: "event-3",
					sequence: 3,
					event: {
						type: "turn_ended",
						eventId: "event-3",
						at: 10,
						turnId: "turn-1",
						outcome: "success",
					},
					persistedAt: 10,
				},
			],
			updatedAt: 10,
		});
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data.version).toBe(1);
		expect(parsed.data.pending[0]?.sequence).toBe(3);
	});
});
