import { describe, expect, test } from "bun:test";
import type { Logger } from "../../logging/logger.ts";
import { createMirrorStore } from "./session-mirror.ts";

function recordingLogger(): { logger: Logger; warnings: { message: string }[] } {
	const warnings: { message: string }[] = [];
	const logger: Logger = {
		error: () => {},
		warn: (message) => warnings.push({ message }),
		info: () => {},
		debug: () => {},
		child: () => logger,
		setLevel: () => {},
	};
	return { logger, warnings };
}

describe("AGENT-05 session mirror", () => {
	test("append reports the uuids of consumed user messages and load returns nothing", async () => {
		const seen: string[] = [];
		const { logger } = recordingLogger();
		const store = createMirrorStore((uuid) => seen.push(uuid), logger);
		const key = { projectKey: "p", sessionId: "s" };
		await store.append(key, [
			{ type: "user", uuid: "u1" },
			{ type: "assistant", uuid: "a1" },
			{
				type: "attachment",
				attachment: { type: "queued_command" },
				source_uuid: "u2",
			},
		]);
		expect(seen).toEqual(["u1", "u2"]);
		expect(await store.load(key)).toBeNull();
	});

	test("the adapter keeps no transcript and never writes from the key", async () => {
		const seen: string[] = [];
		const { logger } = recordingLogger();
		const store = createMirrorStore((uuid) => seen.push(uuid), logger);
		// A key with path traversal must not be turned into a path or a write.
		const key = { projectKey: "../../outside", sessionId: "../session" };
		await store.append(key, [{ type: "user", uuid: "u1" }]);
		expect(seen).toEqual(["u1"]);
		expect(await store.load(key)).toBeNull();
	});

	test("a throwing consumed callback is logged and does not fail the append", async () => {
		const seen: string[] = [];
		const { logger, warnings } = recordingLogger();
		const store = createMirrorStore((uuid) => {
			if (uuid === "bad") throw new Error("receipt failed");
			seen.push(uuid);
		}, logger);

		await store.append({ projectKey: "p", sessionId: "s" }, [
			{ type: "user", uuid: "bad" },
			{ type: "user", uuid: "after" },
		]);

		expect(seen).toEqual(["after"]);
		expect(warnings.map((warning) => warning.message)).toContain(
			"A mirrored transcript entry could not be handled",
		);
	});
});
