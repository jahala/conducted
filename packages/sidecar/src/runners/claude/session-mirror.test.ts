import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

	test("a key that names real folders creates no file or folder at any of them", async () => {
		const base = await mkdtemp(path.join(tmpdir(), "conducted-mirror-"));
		try {
			const projectFolder = path.join(base, "project");
			const sibling = path.join(base, "escaped");
			const { logger } = recordingLogger();
			const store = createMirrorStore(() => {}, logger);
			// If the adapter built a path from the key, it would write into one of these places.
			const keys = [
				{ projectKey: projectFolder, sessionId: "session-1" },
				{ projectKey: projectFolder, sessionId: "../escaped" },
				{ projectKey: base, sessionId: "../../escaped" },
				{ projectKey: "/", sessionId: path.relative("/", sibling) },
			];

			for (const key of keys) {
				await store.append(key, [{ type: "user", uuid: "u1" }]);
				expect(await store.load(key)).toBeNull();
			}

			expect(await readdir(base)).toEqual([]);
			await expect(stat(sibling)).rejects.toThrow();
		} finally {
			await rm(base, { recursive: true, force: true });
		}
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
