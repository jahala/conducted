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
 * older than 30 days (dropped on read and on write); more than 500 entries (the oldest are
 * dropped); a file that would pass 5 MiB (the oldest entries are dropped until it fits); two
 * writers (compare-and-set on the file's revision, one retry); a refresh that fails (log only,
 * the last good list stays); the file written through a temp file at mode 0600 in a folder at
 * mode 0700.
 * Our design choice: the folder arrives as a parameter read from `CONDUCTED_COMPLETIONS_DIR`
 * (`COMPLETIONS_ENV`). `config.ts` (SIDE-01) reads it when this feature is built; the Rust
 * launcher sets it (`sidecar::completions_dir`). Entries are keyed by repository root and agent
 * (and ACP adapter) with a hash of the source list, so an unchanged list is not rewritten.
 * Test first: after `write`, `read` for the same key returns the commands; a `read` 31 days later
 * returns null.
 */
import type { SlashCommand } from "@conducted/protocol";
import type { AcpAgent, AgentKind, Clock } from "@conducted/shared";
import { type AppError, notImplemented, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";

/** Name of the environment variable that holds the cache folder. */
export const COMPLETIONS_ENV = "CONDUCTED_COMPLETIONS_DIR";
export const COMPLETIONS_FILE_NAME = "slash-command-snapshots.json";
export const COMPLETIONS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const COMPLETIONS_MAX_ENTRIES = 500;
export const COMPLETIONS_MAX_FILE_BYTES = 5 * 1024 * 1024;

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

/** The file operations the cache needs. Production passes real ones; tests pass a folder in TMPDIR. */
export interface CompletionsFiles {
	/** Null when the file does not exist. */
	read(path: string): Promise<Result<string | null, AppError>>;
	/** Writes through a temp file, creates the folder at 0700 and the file at 0600. */
	writeAtomic(path: string, text: string): Promise<Result<void, AppError>>;
}

export interface CompletionsCache {
	read(key: CompletionsKey): Promise<Result<CompletionsSnapshot | null, AppError>>;
	write(key: CompletionsKey, commands: SlashCommand[]): Promise<Result<void, AppError>>;
}

export class FileCompletionsCache implements CompletionsCache {
	constructor(
		protected readonly deps: {
			/** Absolute folder from `COMPLETIONS_ENV`. */
			dir: string;
			files: CompletionsFiles;
			clock: Clock;
			logger: Logger;
		},
	) {}

	read(_key: CompletionsKey): Promise<Result<CompletionsSnapshot | null, AppError>> {
		return notImplemented("SIDE-22");
	}

	write(_key: CompletionsKey, _commands: SlashCommand[]): Promise<Result<void, AppError>> {
		return notImplemented("SIDE-22");
	}
}
