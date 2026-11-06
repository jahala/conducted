/**
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: the tests for completions-cache.ts: keyed snapshots, expiry, limits, atomic owner-only
 * writes, compare-and-set and the production file edge.
 * Behaviour: research/conductor/native-and-sidecar-map.md B3 and D1.
 * Test first: after `write`, `read` for the same key returns the commands; a `read` 31 days later
 * returns null.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SlashCommand } from "@conducted/protocol";
import { type AppError, ok, type Result } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import {
	COMPLETIONS_FILE_NAME,
	COMPLETIONS_MAX_AGE_MS,
	COMPLETIONS_MAX_ENTRIES,
	COMPLETIONS_MAX_FILE_BYTES,
	type CompletionsFiles,
	createNodeCompletionsFiles,
	FileCompletionsCache,
} from "./completions-cache.ts";

const folders: string[] = [];

afterEach(async () => {
	for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function tempFolder(): Promise<string> {
	const folder = await mkdtemp(path.join(tmpdir(), "conducted-side-22-"));
	folders.push(folder);
	return folder;
}

function loggerWith(records: LogRecord[] = []) {
	return {
		records,
		logger: createLogger({
			sink: (record) => records.push(record),
			clock: { now: () => 0 },
			level: "debug",
			scope: "test",
		}),
	};
}

function clockAt(start: number) {
	let now = start;
	return {
		clock: { now: () => now },
		advance(ms: number) {
			now += ms;
		},
	};
}

function command(over: Partial<SlashCommand> = {}): SlashCommand {
	return {
		name: "review",
		description: "Review the working tree",
		source: "project",
		kind: "command",
		...over,
	};
}

function cacheAt(folder: string, clock: { now(): number }, records: LogRecord[] = []) {
	return new FileCompletionsCache({
		dir: folder,
		files: createNodeCompletionsFiles(),
		clock,
		logger: loggerWith(records).logger,
	});
}

describe("SIDE-22 completions cache", () => {
	test("SIDE-22 after a write, a read for the same key returns the commands", async () => {
		const folder = await tempFolder();
		const { clock } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		const commands = [command(), command({ name: "skill-creator", kind: "skill", source: "user" })];

		expect(await cache.write({ repoRootPath: "/code/app", agent: "claude" }, commands)).toEqual(
			ok(undefined),
		);

		const read = await cache.read({ repoRootPath: "/code/app", agent: "claude" });
		expect(read.ok && read.value?.commands).toEqual(commands);
		expect(read.ok && read.value?.savedAt).toBe(1_700_000_000_000);
	});

	test("SIDE-22 a read 31 days later returns null", async () => {
		const folder = await tempFolder();
		const { clock, advance } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()]);

		advance(31 * 24 * 60 * 60 * 1000);

		expect(await cache.read({ repoRootPath: "/code/app", agent: "claude" })).toEqual(ok(null));
	});

	test("SIDE-22 keys by repository root, agent and ACP adapter", async () => {
		const folder = await tempFolder();
		const { clock } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		await cache.write({ repoRootPath: "/code/app", agent: "acp", acpAgent: "opencode" }, [
			command({ name: "opencode-only" }),
		]);

		expect(
			await cache.read({ repoRootPath: "/code/app", agent: "acp", acpAgent: "opencode" }),
		).toEqual(
			ok({
				commands: [command({ name: "opencode-only" })],
				sourceHash: expect.any(String),
				savedAt: 1_700_000_000_000,
			}),
		);
		expect(await cache.read({ repoRootPath: "/code/app", agent: "acp", acpAgent: "pi" })).toEqual(
			ok(null),
		);
		expect(
			await cache.read({ repoRootPath: "/code/other", agent: "acp", acpAgent: "opencode" }),
		).toEqual(ok(null));
	});

	test("SIDE-22 a missing file is an empty cache", async () => {
		const folder = await tempFolder();
		const { clock } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		expect(await cache.read({ repoRootPath: "/code/app", agent: "claude" })).toEqual(ok(null));
	});

	test("SIDE-22 invalid JSON is logged, treated as empty and replaced by the next write", async () => {
		const folder = await tempFolder();
		const { clock } = clockAt(1_700_000_000_000);
		const records: LogRecord[] = [];
		const cache = cacheAt(folder, clock, records);
		await writeFile(path.join(folder, COMPLETIONS_FILE_NAME), "{not json", "utf8");

		expect(await cache.read({ repoRootPath: "/code/app", agent: "claude" })).toEqual(ok(null));
		expect(records.some((record) => record.message.includes("not valid JSON"))).toBe(true);

		await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()]);
		const read = await cache.read({ repoRootPath: "/code/app", agent: "claude" });
		expect(read.ok && read.value?.commands).toEqual([command()]);
	});

	test("SIDE-22 a file with the wrong shape is logged and treated as empty", async () => {
		const folder = await tempFolder();
		const { clock } = clockAt(1_700_000_000_000);
		const records: LogRecord[] = [];
		const cache = cacheAt(folder, clock, records);
		await writeFile(
			path.join(folder, COMPLETIONS_FILE_NAME),
			JSON.stringify({ version: 1, revision: 0, entries: [{ name: "not a snapshot" }] }),
			"utf8",
		);

		expect(await cache.read({ repoRootPath: "/code/app", agent: "claude" })).toEqual(ok(null));
		expect(records.some((record) => record.message.includes("wrong shape"))).toBe(true);
	});

	test("SIDE-22 an unchanged list keeps its commands and moves its save time forward", async () => {
		const folder = await tempFolder();
		const { clock, advance } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()]);
		advance(60 * 60 * 1000);
		await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()]);

		const read = await cache.read({ repoRootPath: "/code/app", agent: "claude" });
		expect(read.ok && read.value?.savedAt).toBe(1_700_000_000_000 + 60 * 60 * 1000);
		expect(read.ok && read.value?.commands).toEqual([command()]);
	});

	test("SIDE-22 a list refreshed unchanged at day 20 is still cached at day 40", async () => {
		const folder = await tempFolder();
		const day = 24 * 60 * 60 * 1000;
		const { clock, advance } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()]);
		advance(20 * day);
		await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()]);
		advance(20 * day);

		const read = await cache.read({ repoRootPath: "/code/app", agent: "claude" });
		expect(read.ok && read.value?.commands).toEqual([command()]);
	});

	test("SIDE-22 writes for different repositories at the same time all land", async () => {
		const folder = await tempFolder();
		const { clock } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		const roots = Array.from({ length: 8 }, (_unused, index) => `/code/app-${index}`);

		const results = await Promise.all(
			roots.map((repoRootPath) =>
				cache.write({ repoRootPath, agent: "claude" }, [command({ name: repoRootPath })]),
			),
		);

		expect(roots).toHaveLength(8);
		expect(results).toEqual(roots.map(() => ok(undefined)));
		for (const repoRootPath of roots) {
			const read = await cache.read({ repoRootPath, agent: "claude" });
			expect(read.ok && read.value?.commands.map((entry) => entry.name)).toEqual([repoRootPath]);
		}
	});

	test("SIDE-22 an expired entry is dropped by the next write", async () => {
		const folder = await tempFolder();
		const { clock, advance } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		await cache.write({ repoRootPath: "/code/old", agent: "claude" }, [command()]);
		advance(COMPLETIONS_MAX_AGE_MS + 1);
		await cache.write({ repoRootPath: "/code/new", agent: "claude" }, [command()]);

		expect(await cache.read({ repoRootPath: "/code/old", agent: "claude" })).toEqual(ok(null));
		const fresh = await cache.read({ repoRootPath: "/code/new", agent: "claude" });
		expect(fresh.ok && fresh.value !== null).toBe(true);

		const text = await readFile(path.join(folder, COMPLETIONS_FILE_NAME), "utf8");
		expect(text).not.toContain("/code/old");
	});

	test("SIDE-22 keeps at most 500 entries, dropping the oldest", async () => {
		const folder = await tempFolder();
		const { clock, advance } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		for (let index = 0; index < COMPLETIONS_MAX_ENTRIES + 1; index += 1) {
			advance(1);
			await cache.write({ repoRootPath: `/code/repo-${index}`, agent: "claude" }, [
				command({ name: `command-${index}` }),
			]);
		}

		expect(await cache.read({ repoRootPath: "/code/repo-0", agent: "claude" })).toEqual(ok(null));
		const newest = await cache.read({
			repoRootPath: `/code/repo-${COMPLETIONS_MAX_ENTRIES}`,
			agent: "claude",
		});
		expect(newest.ok && newest.value?.commands[0]?.name).toBe(`command-${COMPLETIONS_MAX_ENTRIES}`);
		const raw = JSON.parse(await readFile(path.join(folder, COMPLETIONS_FILE_NAME), "utf8"));
		expect(raw.entries).toHaveLength(COMPLETIONS_MAX_ENTRIES);
	});

	test("SIDE-22 drops the oldest entries until the file fits 5 MiB", async () => {
		const folder = await tempFolder();
		const { clock, advance } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		const big = "x".repeat(1024 * 1024);
		for (let index = 0; index < 6; index += 1) {
			advance(1);
			await cache.write({ repoRootPath: `/code/repo-${index}`, agent: "claude" }, [
				command({ name: `command-${index}`, description: big }),
			]);
		}

		const size = (await stat(path.join(folder, COMPLETIONS_FILE_NAME))).size;
		expect(size).toBeLessThanOrEqual(COMPLETIONS_MAX_FILE_BYTES);
		expect(await cache.read({ repoRootPath: "/code/repo-0", agent: "claude" })).toEqual(ok(null));
		const newest = await cache.read({ repoRootPath: "/code/repo-5", agent: "claude" });
		expect(newest.ok && newest.value?.commands[0]?.name).toBe("command-5");
	});

	test("SIDE-22 refuses one entry larger than the file cap and leaves the file alone", async () => {
		const folder = await tempFolder();
		const { clock } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		const result = await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [
			command({ description: "x".repeat(COMPLETIONS_MAX_FILE_BYTES + 1) }),
		]);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("completions_cache_too_large");
		expect(await stat(path.join(folder, COMPLETIONS_FILE_NAME)).catch(() => null)).toBeNull();
	});

	test("SIDE-22 writes the file at mode 0600 inside a folder at mode 0700", async () => {
		const folder = await tempFolder();
		const { clock } = clockAt(1_700_000_000_000);
		const cache = cacheAt(folder, clock);
		await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()]);

		const folderMode = (await stat(folder)).mode & 0o777;
		const fileMode = (await stat(path.join(folder, COMPLETIONS_FILE_NAME))).mode & 0o777;
		expect(folderMode).toBe(0o700);
		expect(fileMode).toBe(0o600);
	});

	test("SIDE-22 a lost compare-and-set is retried once", async () => {
		const { clock } = clockAt(1_700_000_000_000);
		let calls = 0;
		let stored: string | null = null;
		const files: CompletionsFiles = {
			read: async () => ok(stored),
			compareAndSet: async (_path, text): Promise<Result<boolean, AppError>> => {
				calls += 1;
				if (calls === 1) return ok(false);
				stored = text;
				return ok(true);
			},
		};
		const cache = new FileCompletionsCache({
			dir: "/unused",
			files,
			clock,
			logger: loggerWith().logger,
		});

		expect(await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()])).toEqual(
			ok(undefined),
		);
		expect(calls).toBe(2);
	});

	test("SIDE-22 gives up after a second lost compare-and-set", async () => {
		const { clock } = clockAt(1_700_000_000_000);
		let calls = 0;
		const files: CompletionsFiles = {
			read: async () => ok(null),
			compareAndSet: async () => {
				calls += 1;
				return ok(false);
			},
		};
		const cache = new FileCompletionsCache({
			dir: "/unused",
			files,
			clock,
			logger: loggerWith().logger,
		});

		const result = await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("completions_cache_conflict");
		expect(calls).toBe(2);
	});
});
