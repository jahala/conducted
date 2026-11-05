/**
 * @feature REV-02 File diff content for the diff viewer
 * Owns: producing the old text, new text and patch of one file for a diff scope, with a cache and
 * prefetch of the next files.
 * Behaviour: services-map.md 3.4.2 and 3.4.3 (file contents from git and disk, patch form,
 * guard counts), 2.7.2 (diff cache limit 25 MB), ui-map.md 3.6 (warnings: whitespace only,
 * binary, updating).
 * Must handle: a file added (no old side) or deleted (no new side); the new side of the
 * working-tree comparison is read from disk, not from git;
 * binary files return `binary: true` and no text; files over the size or line limit return
 * `tooLarge: true` and no text; an untracked file is diffed against /dev/null; the cache key
 * includes the two refs and the file's modified time, so an edit invalidates it; the cache
 * evicts the oldest entries beyond 25 MB; a late answer for an older key is dropped.
 * Our design choice: the diff itself is computed in the browser by the diff viewer from old and
 * new text; `patch` is only filled when a renderer asks for it (`withPatch`).
 * Test first: a deleted file returns oldText and a null newText.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import type { FileSystem } from "../../platform/platform.ts";
import type { DiffScope, FileDiff } from "../api.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import {
	diffFilePatch,
	diffNumstatForFile,
	diffUntrackedFilePatch,
	showFileAt,
} from "../git/commands.ts";
import { isTooLargeToRender } from "../git/diff.ts";
import type { GitRunner } from "../git/runner.ts";
import { parseNumstat } from "../git/status.ts";

export const FILE_DIFF_CACHE_BYTES = 25 * 1024 * 1024;

export interface FileDiffServiceDeps {
	git: GitRunner;
	fs: Pick<FileSystem, "readText" | "stat">;
	/** Workspace folder and the facts the scope needs (merge bases, checkpoint refs). */
	resolveScope: (
		workspaceId: WorkspaceId,
		scope: DiffScope,
	) => Promise<Result<{ cwd: string; from: string; to: string | null }>>;
}

interface CacheEntry {
	diff: FileDiff;
	bytes: number;
}

const textBytes = (text: string | null): number => (text === null ? 0 : text.length);

/** Reads one side from a ref. A file missing at that ref is null, not an error. */
async function readAtRef(
	git: GitRunner,
	cwd: string,
	ref: string,
	path: string,
): Promise<Result<string | null>> {
	const result = await git.run(showFileAt(ref, path), { cwd });
	if (!result.ok) return result;
	if (result.value.exitCode === 0) return ok(result.value.stdout);
	if (result.value.exitCode === 128) return ok(null);
	return err(
		appError(
			"git_failed",
			result.value.stderr.trim() || `git show exited with code ${result.value.exitCode}`,
		),
	);
}

interface GuardFacts {
	changedLines: number;
	sizeBytes: number;
	binary: boolean;
}

/** The guard counts git reports, before any file text is read (services-map 3.4.2). */
async function readGuardFacts(
	deps: FileDiffServiceDeps,
	cwd: string,
	path: string,
	from: string,
	to: string | null,
): Promise<Result<GuardFacts>> {
	const [numstat, stat] = await Promise.all([
		deps.git.stdout(diffNumstatForFile(from, to, path), { cwd }),
		to === null ? deps.fs.stat(`${cwd}/${path}`) : Promise.resolve(ok(null)),
	]);
	if (!numstat.ok) return numstat;
	const entry = parseNumstat(numstat.value).find((candidate) => candidate.path === path);
	const changedLines = entry === undefined ? 0 : entry.linesAdded + entry.linesRemoved;
	const binary = entry?.binary ?? false;
	const sizeBytes = stat.ok && stat.value !== null ? stat.value.size : 0;
	return ok({ changedLines, sizeBytes, binary });
}

export class FileDiffService {
	readonly #deps: FileDiffServiceDeps;
	/** Insertion order is the eviction order; a cache hit moves its entry to the end. */
	readonly #cache = new Map<string, CacheEntry>();
	readonly #latest = createLatestWins<string>();
	/** Bumped by `invalidate`, so a request already running does not refill the cache. */
	readonly #generations = new Map<string, number>();
	#cachedBytes = 0;

	constructor(deps: FileDiffServiceDeps) {
		this.#deps = deps;
	}

	/** Backs `useFileDiff`. */
	async load(
		workspaceId: WorkspaceId,
		path: string,
		scope: DiffScope,
		options: { withPatch: boolean; ignoreWhitespace: boolean },
	): Promise<Result<FileDiff>> {
		const workspaceKey = String(workspaceId);
		const generation = this.#generations.get(workspaceKey) ?? 0;
		const resolved = await this.#deps.resolveScope(workspaceId, scope);
		if (!resolved.ok) return resolved;
		const { cwd, from, to } = resolved.value;

		const stat = to === null ? await this.#deps.fs.stat(`${cwd}/${path}`) : ok(null);
		const mtimeMs = stat.ok && stat.value !== null ? stat.value.modifiedAt : 0;
		const key = [
			String(workspaceId),
			from,
			to ?? "",
			path,
			String(mtimeMs),
			options.withPatch ? "patch" : "",
			options.ignoreWhitespace ? "space" : "",
		].join("\u0000");
		const ticket = this.#latest.begin(key);

		const cached = this.#cache.get(key);
		if (cached !== undefined) {
			this.#cache.delete(key);
			this.#cache.set(key, cached);
			this.#latest.settle(ticket);
			return ok(cached.diff);
		}

		const built = await this.#build(cwd, path, from, to, options);
		if (!built.ok) {
			this.#latest.settle(ticket);
			return built;
		}

		if (
			!this.#latest.isLatest(ticket) ||
			(this.#generations.get(workspaceKey) ?? 0) !== generation
		) {
			this.#latest.settle(ticket);
			return ok(built.value);
		}
		this.#latest.settle(ticket);
		this.#remember(key, built.value);
		return ok(built.value);
	}

	/** Warms the cache for files the user is likely to open next. Errors are ignored. */
	async prefetch(
		workspaceId: WorkspaceId,
		paths: readonly string[],
		scope: DiffScope,
	): Promise<void> {
		for (const path of paths) {
			await this.load(workspaceId, path, scope, {
				withPatch: false,
				ignoreWhitespace: false,
			});
		}
	}

	/** Drops cached entries of a workspace, for example after a revert. */
	invalidate(workspaceId: WorkspaceId): void {
		const prefix = `${String(workspaceId)}\u0000`;
		for (const [key, entry] of this.#cache) {
			if (key.startsWith(prefix)) {
				this.#cache.delete(key);
				this.#cachedBytes -= entry.bytes;
			}
		}
		this.#generations.set(
			String(workspaceId),
			(this.#generations.get(String(workspaceId)) ?? 0) + 1,
		);
	}

	#remember(key: string, diff: FileDiff): void {
		const bytes = textBytes(diff.oldText) + textBytes(diff.newText) + diff.patch.length;
		if (bytes > FILE_DIFF_CACHE_BYTES) return;
		const existing = this.#cache.get(key);
		if (existing !== undefined) {
			this.#cache.delete(key);
			this.#cachedBytes -= existing.bytes;
		}
		this.#cache.set(key, { diff, bytes });
		this.#cachedBytes += bytes;
		for (const [oldKey, entry] of this.#cache) {
			if (this.#cachedBytes <= FILE_DIFF_CACHE_BYTES) break;
			if (oldKey === key) continue;
			this.#cache.delete(oldKey);
			this.#cachedBytes -= entry.bytes;
		}
	}

	async #build(
		cwd: string,
		path: string,
		from: string,
		to: string | null,
		options: { withPatch: boolean; ignoreWhitespace: boolean },
	): Promise<Result<FileDiff>> {
		const facts = await readGuardFacts(this.#deps, cwd, path, from, to);
		if (!facts.ok) return facts;
		const { changedLines, sizeBytes, binary } = facts.value;

		if (isTooLargeToRender(sizeBytes, changedLines)) {
			return ok({
				path,
				oldText: null,
				newText: null,
				patch: "",
				binary: false,
				tooLarge: true,
			});
		}
		if (binary) {
			return ok({ path, oldText: null, newText: null, patch: "", binary: true, tooLarge: false });
		}

		const oldText = await readAtRef(this.#deps.git, cwd, from, path);
		if (!oldText.ok) return oldText;

		let newText: Result<string | null>;
		if (to === null) {
			const onDisk = await this.#deps.fs.readText(`${cwd}/${path}`);
			if (!onDisk.ok && sizeBytes > 0) {
				// The file exists but its text could not be read: treat it as binary.
				return ok({
					path,
					oldText: null,
					newText: null,
					patch: "",
					binary: true,
					tooLarge: false,
				});
			}
			newText = onDisk.ok ? ok(onDisk.value) : ok(null);
		} else {
			newText = await readAtRef(this.#deps.git, cwd, to, path);
		}
		if (!newText.ok) return newText;

		// A NUL inside a text side means git called it text but the file is binary.
		if ((oldText.value ?? "").includes("\u0000") || (newText.value ?? "").includes("\u0000")) {
			return ok({
				path,
				oldText: null,
				newText: null,
				patch: "",
				binary: true,
				tooLarge: false,
			});
		}

		let patch = "";
		if (options.withPatch) {
			const builtPatch = await this.#buildPatch(cwd, path, from, to, oldText.value, options);
			if (!builtPatch.ok) return builtPatch;
			patch = builtPatch.value;
		}

		return ok({
			path,
			oldText: oldText.value,
			newText: newText.value,
			patch,
			binary: false,
			tooLarge: false,
		});
	}

	async #buildPatch(
		cwd: string,
		path: string,
		from: string,
		to: string | null,
		oldText: string | null,
		options: { ignoreWhitespace: boolean },
	): Promise<Result<string>> {
		const tracked = await this.#deps.git.stdout(
			diffFilePatch(from, to, path, options.ignoreWhitespace),
			{ cwd },
		);
		if (!tracked.ok) return tracked;
		if (tracked.value.length > 0) return ok(tracked.value);
		// An untracked file has no git diff against the ref; diff it against /dev/null instead.
		if (to === null && oldText === null) {
			return this.#deps.git.stdout(diffUntrackedFilePatch(path, options.ignoreWhitespace), { cwd });
		}
		return ok(tracked.value);
	}
}
