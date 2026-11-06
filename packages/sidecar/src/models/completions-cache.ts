/**
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: the saved list of slash commands and skills per repository and agent, so the
 * new-workspace composer can show them before any workspace folder exists.
 * Behaviour: research/conductor/native-and-sidecar-map.md B3 (slash command snapshots) and D1
 * (`sidecar-v2-completions/slash-command-snapshots.json`), A6 steps 6 and 7 (the Rust launcher
 * passes the folder), frontend.md 3c, ui-map.md 3.5. The RPC is `listSlashCommands` without a
 * `workspacePath`, which answers with `fromCache: true`.
 * Must handle: a missing file or folder (an empty cache, not an error); a file that is not valid
 * JSON or has the wrong shape (logged, treated as empty, replaced by the next write); an entry
 * older than 30 days (dropped on read and on write); a refresh with an unchanged list (the entry
 * is written again with a new save time, so a list that never changes stays cached while it is
 * refreshed); more than 500 entries (the oldest are dropped); a file that would pass 5 MiB (the
 * oldest entries are dropped until it fits); two writers in the sidecar (writes to one file run one
 * at a time, so neither loses the other's entry); a writer in another process (a best-effort check
 * before the rename: the file must still hold the text this write read, else one retry; a writer
 * that renames between that check and ours still wins, because there is no lock); a refresh that
 * fails (log only, the last good list stays); the file written through a temp file at mode 0600
 * in a folder at mode 0700.
 * Our design choice: the folder arrives as a parameter read from `CONDUCTED_COMPLETIONS_DIR`
 * (`SIDECAR_ENV.completionsDir`). `config.ts` (SIDE-01) reads it; the Rust launcher sets it
 * (`sidecar::completions_dir`). Entries are keyed by repository root and agent (and ACP adapter)
 * with a hash of the source list. `createNodeCompletionsFiles` is the production file edge.
 * Test first: after `write`, `read` for the same key returns the commands; a `read` 31 days later
 * returns null.
 */
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type SlashCommand, zAcpAgent, zAgentKind, zSlashCommand } from "@conducted/protocol";
import {
	type AcpAgent,
	type AgentKind,
	type AppError,
	appError,
	type Clock,
	err,
	ok,
	type Result,
} from "@conducted/shared";
import { z } from "zod";
import type { Logger } from "../logging/logger.ts";
import { KeyedSerialQueue } from "../session/serial-queue.ts";
import { messageOf } from "../util/errors.ts";

export const COMPLETIONS_FILE_NAME = "slash-command-snapshots.json";
export const COMPLETIONS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const COMPLETIONS_MAX_ENTRIES = 500;
export const COMPLETIONS_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** The file format version this module reads and writes. */
export const COMPLETIONS_FILE_VERSION = 1;

const CACHE_READ_FAILED = "completions_cache_read_failed";
const CACHE_WRITE_FAILED = "completions_cache_write_failed";
const CACHE_CONFLICT = "completions_cache_conflict";
const CACHE_TOO_LARGE = "completions_cache_too_large";

export interface CompletionsKey {
	repoRootPath: string;
	agent: AgentKind;
	acpAgent?: AcpAgent | undefined;
}

export interface CompletionsSnapshot {
	commands: SlashCommand[];
	/** Hash of the list the agent returned, so an unchanged list is not written again. */
	sourceHash: string;
	/** When the list was saved, in milliseconds since the epoch. */
	savedAt: number;
}

interface CompletionsEntry extends CompletionsSnapshot {
	repoRootPath: string;
	agent: AgentKind;
	acpAgent?: AcpAgent | undefined;
}

const zCompletionsEntry = z.object({
	repoRootPath: z.string().min(1),
	agent: zAgentKind,
	acpAgent: zAcpAgent.optional(),
	sourceHash: z.string().min(1),
	savedAt: z.number().int().nonnegative(),
	commands: z.array(zSlashCommand),
});

const zCompletionsFile = z.object({
	version: z.literal(COMPLETIONS_FILE_VERSION),
	revision: z.number().int().nonnegative(),
	entries: z.array(zCompletionsEntry),
});

interface LoadedCache {
	revision: number;
	entries: CompletionsEntry[];
	/** The file's exact text, or null when it does not exist. Used to detect another writer. */
	raw: string | null;
}

/** The file operations the cache needs. Production passes real ones; tests pass a folder in TMPDIR. */
export interface CompletionsFiles {
	/** Null when the file does not exist. */
	read(path: string): Promise<Result<string | null, AppError>>;
	/**
	 * Writes through a temp file, creates the folder at 0700 and the file at 0600, and only when
	 * the file still holds `expected` (null means it is absent). False means another writer won.
	 * The check runs before the rename and takes no lock, so it is best effort across processes.
	 */
	compareAndSet(
		path: string,
		text: string,
		expected: string | null,
	): Promise<Result<boolean, AppError>>;
}

export interface CompletionsCache {
	read(key: CompletionsKey): Promise<Result<CompletionsSnapshot | null, AppError>>;
	write(key: CompletionsKey, commands: SlashCommand[]): Promise<Result<void, AppError>>;
}

/** A stable hash of one command list. The same list always hashes the same, whatever its source. */
export function sourceHashOf(commands: readonly SlashCommand[]): string {
	const canonical = commands.map((command) => [
		command.name,
		command.description,
		command.argumentHint ?? null,
		command.source,
		command.kind,
	]);
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** `/code/app/` and `/code/app` are the same repository folder. */
function normaliseRepoRoot(repoRootPath: string): string {
	const trimmed = repoRootPath.trim();
	return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

function sameKey(entry: CompletionsEntry, key: CompletionsKey): boolean {
	return (
		entry.repoRootPath === key.repoRootPath &&
		entry.agent === key.agent &&
		entry.acpAgent === key.acpAgent
	);
}

function newestFor(
	entries: readonly CompletionsEntry[],
	key: CompletionsKey,
): CompletionsEntry | null {
	let newest: CompletionsEntry | null = null;
	for (const entry of entries) {
		if (!sameKey(entry, key)) continue;
		if (newest === null || entry.savedAt > newest.savedAt) newest = entry;
	}
	return newest;
}

/** Oldest first, so dropping from the front drops the oldest. */
function oldestFirst(entries: readonly CompletionsEntry[]): CompletionsEntry[] {
	return [...entries].sort((left, right) => left.savedAt - right.savedAt);
}

function isUnexpired(entry: CompletionsEntry, now: number): boolean {
	return now - entry.savedAt < COMPLETIONS_MAX_AGE_MS;
}

export class FileCompletionsCache implements CompletionsCache {
	/** Writes to the cache file run one at a time, so two chats refreshing at once both land. */
	private readonly writes = new KeyedSerialQueue();

	constructor(
		protected readonly deps: {
			/** Absolute folder from `SIDECAR_ENV.completionsDir` (config.ts). */
			dir: string;
			files: CompletionsFiles;
			clock: Clock;
			logger: Logger;
		},
	) {}

	async read(key: CompletionsKey): Promise<Result<CompletionsSnapshot | null, AppError>> {
		const loaded = await this.load();
		if (!loaded.ok) return loaded;
		const normalised: CompletionsKey = {
			...key,
			repoRootPath: normaliseRepoRoot(key.repoRootPath),
		};
		const entry = newestFor(loaded.value.entries, normalised);
		if (entry === null || !isUnexpired(entry, this.deps.clock.now())) return ok(null);
		return ok({
			commands: entry.commands,
			sourceHash: entry.sourceHash,
			savedAt: entry.savedAt,
		});
	}

	write(key: CompletionsKey, commands: SlashCommand[]): Promise<Result<void, AppError>> {
		return this.writes.run(this.filePath(), () => this.writeNow(key, commands));
	}

	private async writeNow(
		key: CompletionsKey,
		commands: SlashCommand[],
	): Promise<Result<void, AppError>> {
		const normalised: CompletionsKey = {
			...key,
			repoRootPath: normaliseRepoRoot(key.repoRootPath),
		};
		const sourceHash = sourceHashOf(commands);
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const loaded = await this.load();
			if (!loaded.ok) return loaded;
			const now = this.deps.clock.now();
			const live = loaded.value.entries.filter((entry) => isUnexpired(entry, now));
			// An unchanged list is written again too: its new save time keeps it from expiring while
			// the repository is still in use.
			const entries = live.filter((entry) => !sameKey(entry, normalised));
			entries.push({
				repoRootPath: normalised.repoRootPath,
				agent: normalised.agent,
				...(normalised.acpAgent === undefined ? {} : { acpAgent: normalised.acpAgent }),
				sourceHash,
				savedAt: now,
				commands: [...commands],
			});
			const kept = oldestFirst(entries).slice(
				Math.max(0, entries.length - COMPLETIONS_MAX_ENTRIES),
			);
			const text = this.serialise(kept, loaded.value.revision + 1);
			if (!text.ok) return text;
			const swapped = await this.deps.files.compareAndSet(
				this.filePath(),
				text.value,
				loaded.value.raw,
			);
			if (!swapped.ok) return swapped;
			if (swapped.value) return ok(undefined);
		}
		return err(
			appError(CACHE_CONFLICT, "Another process changed the slash command cache at the same time."),
		);
	}

	/** The JSON document, with the oldest entries dropped until it fits the file cap. */
	private serialise(
		entries: readonly CompletionsEntry[],
		revision: number,
	): Result<string, AppError> {
		let kept = [...entries];
		while (true) {
			const text = JSON.stringify({
				version: COMPLETIONS_FILE_VERSION,
				revision,
				entries: kept,
			});
			if (Buffer.byteLength(text, "utf8") <= COMPLETIONS_MAX_FILE_BYTES) return ok(text);
			if (kept.length <= 1) {
				return err(
					appError(
						CACHE_TOO_LARGE,
						"The slash command cache entry is larger than the cache file may be.",
					),
				);
			}
			kept = kept.slice(1);
		}
	}

	private filePath(): string {
		return path.join(this.deps.dir, COMPLETIONS_FILE_NAME);
	}

	/** Reads and validates the file. A missing or unreadable file is an empty cache, not an error. */
	private async load(): Promise<Result<LoadedCache, AppError>> {
		const read = await this.deps.files.read(this.filePath());
		if (!read.ok) return read;
		if (read.value === null) return ok({ revision: 0, entries: [], raw: null });
		let parsed: unknown;
		try {
			parsed = JSON.parse(read.value);
		} catch (cause) {
			this.deps.logger.warn("The slash command cache is not valid JSON", {
				reason: messageOf(cause),
			});
			return ok({ revision: 0, entries: [], raw: read.value });
		}
		const validated = zCompletionsFile.safeParse(parsed);
		if (!validated.success) {
			this.deps.logger.warn("The slash command cache has the wrong shape", {
				reason: validated.error.issues[0]?.message ?? "unknown",
			});
			return ok({ revision: 0, entries: [], raw: read.value });
		}
		return ok({
			revision: validated.data.revision,
			entries: validated.data.entries,
			raw: read.value,
		});
	}
}

/** The production file edge: reads, and writes a temp file then renames it into place. */
export function createNodeCompletionsFiles(): CompletionsFiles {
	return {
		async read(file) {
			try {
				return ok(await readFile(file, "utf8"));
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code === "ENOENT") return ok(null);
				return err(
					appError(
						CACHE_READ_FAILED,
						`Could not read the slash command cache: ${messageOf(cause)}`,
						cause,
					),
				);
			}
		},

		async compareAndSet(file, text, expected) {
			const current = await this.read(file);
			if (!current.ok) return current;
			if (current.value !== expected) return ok(false);
			const folder = path.dirname(file);
			const temp = path.join(folder, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
			try {
				await mkdir(folder, { recursive: true, mode: 0o700 });
				await chmod(folder, 0o700);
				await writeFile(temp, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
				await chmod(temp, 0o600);
				await rename(temp, file);
				return ok(true);
			} catch (cause) {
				const cleanup = await rm(temp, { force: true }).then(
					() => null,
					(error: unknown) => error,
				);
				const suffix =
					cleanup === null ? "" : ` The temporary file could not be removed: ${messageOf(cleanup)}`;
				return err(
					appError(
						CACHE_WRITE_FAILED,
						`Could not write the slash command cache: ${messageOf(cause)}.${suffix}`,
						cause,
					),
				);
			}
		},
	};
}
