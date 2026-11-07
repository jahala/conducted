/**
 * @feature SIDE-25 Sidecar adapters in their own edge modules
 * @feature SIDE-01 Entry point and modes
 * Owns: the sidecar's file edges: the startup folder check, a private temp folder, the prompt
 * files the session manager reads, `realpath`, and the program lookup on a PATH.
 * Behaviour: research/conductor/native-and-sidecar-map.md B1 and D2. A missing bin folder or an
 * unwritable outbox is a startup failure: there is no silent fallback to a default path under the
 * user's home (D027). A name with a slash is a path and is checked as it is, as a shell does.
 * Must handle: a missing folder (`directoryExists` is false), an unwritable outbox (an error that
 * names the folder), a file that disappears between `stat` and `readFile` (an error that names the
 * file), a missing file for a size (`null`), and a PATH entry that is empty or not a file.
 * Test first: the startup folder check accepts a writable outbox and refuses a read-only one.
 * Our design choice: the factory takes the file system, the temp root and the fallback PATH, so
 * the composition root only wires real ones and the tests make their own temp folder.
 */

import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type AppError, appError, err, messageOf, ok, type Result } from "@conducted/shared";
import type { SidecarConfig } from "../config.ts";
import type { PromptFiles } from "../prompt/assemble.ts";
import type { FindExecutable } from "../runners/deps.ts";

/** The file operations the sidecar's edges use. */
export interface FileSystem {
	stat(target: string): Promise<Stats>;
	access(target: string, mode: number): Promise<void>;
	mkdir(folder: string, options: { recursive: true; mode: number }): Promise<unknown>;
	mkdtemp(prefix: string): Promise<string>;
	open(target: string, flags: string, mode?: number): Promise<{ close(): Promise<void> }>;
	readFile(target: string, encoding: "utf8"): Promise<string>;
	realpath(target: string): Promise<string>;
	rm(target: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
}

/** The real file system. */
export const nodeFileSystem: FileSystem = {
	stat,
	access,
	mkdir,
	mkdtemp,
	open,
	readFile,
	realpath,
	rm,
};

export interface FilesAdapters {
	/** Checks that the host can write where it must. A failure names the folder. */
	preflight(config: Pick<SidecarConfig, "binDir" | "outboxRoot">): Promise<Result<void, AppError>>;
	/** Makes a private folder in the temp root and returns its path. */
	makeTempDir(prefix: string): Promise<string>;
	/** The file facts prompt assembly needs. */
	promptFiles: PromptFiles;
	/** Resolves a path, or null when it does not exist. */
	realPath(target: string): Promise<string | null>;
	/** Finds a program on a PATH, falling back to the launcher's PATH. */
	findExecutable: FindExecutable;
}

export interface FilesAdaptersDeps {
	fs: FileSystem;
	/** The root temp folders are made in. Production passes `os.tmpdir()`. */
	tempRoot: string;
	/** The sidecar's own pid, used to make the write probe's name unique. */
	pid(): number;
	/** The launcher's PATH, used when a caller passes no PATH. */
	fallbackPath: string | undefined;
}

/** Builds the file edges from the file system and the folders passed in. */
export function createFilesAdapters(deps: FilesAdaptersDeps): FilesAdapters {
	const { fs } = deps;
	return {
		preflight: (config) => preflightDirectories(fs, deps.pid(), config),
		makeTempDir: (prefix) => fs.mkdtemp(path.join(deps.tempRoot, prefix)),
		promptFiles: createPromptFiles(fs),
		realPath: (target) => realPath(fs, target),
		findExecutable: createFindExecutable(fs, deps.fallbackPath),
	};
}

/** The production wiring: the real file system, the OS temp root and the process's pid. */
export function createNodeFilesAdapters(options: {
	fallbackPath?: string | undefined;
}): FilesAdapters {
	return createFilesAdapters({
		fs: nodeFileSystem,
		tempRoot: tmpdir(),
		pid: () => process.pid,
		fallbackPath: options.fallbackPath,
	});
}

/**
 * Checks the folders the sidecar writes to. A missing bin folder or an unwritable outbox is a
 * startup failure: there is no silent fallback to a default path under the user's home (D027,
 * native-and-sidecar-map D2). The log folder is required by config.ts but is not probed here: the
 * Rust launcher creates it and writes the sidecar's stderr there (D026).
 */
export async function preflightDirectories(
	fs: FileSystem,
	pid: number,
	config: Pick<SidecarConfig, "binDir" | "outboxRoot">,
): Promise<Result<void, AppError>> {
	const bin = await directoryExists(fs, config.binDir);
	if (!bin) {
		return err(
			appError("bin_dir_missing", `The sidecar's bin folder (${config.binDir}) does not exist.`),
		);
	}
	return probeWritable(fs, pid, "outbox folder", config.outboxRoot);
}

async function directoryExists(fs: FileSystem, folder: string): Promise<boolean> {
	try {
		return (await fs.stat(folder)).isDirectory();
	} catch {
		return false;
	}
}

async function probeWritable(
	fs: FileSystem,
	pid: number,
	label: string,
	folder: string,
): Promise<Result<void, AppError>> {
	const probe = path.join(folder, `.conducted-write-${pid}-${randomUUID()}`);
	try {
		await fs.mkdir(folder, { recursive: true, mode: 0o700 });
		const handle = await fs.open(probe, "wx", 0o600);
		await handle.close();
		await fs.rm(probe);
		return ok(undefined);
	} catch (cause) {
		await fs.rm(probe, { force: true }).catch(() => {});
		return err(
			appError(
				"folder_not_writable",
				`The sidecar cannot write to its ${label} (${folder}): ${messageOf(cause)}`,
			),
		);
	}
}

/** Reads the file facts prompt assembly needs, straight from the file system. */
export function createPromptFiles(fs: FileSystem): PromptFiles {
	return {
		async size(target) {
			try {
				return (await fs.stat(target)).size;
			} catch {
				return null;
			}
		},
		async readText(target) {
			try {
				return ok(await fs.readFile(target, "utf8"));
			} catch (cause) {
				return err(
					appError(
						"prompt_file_read_failed",
						`Could not read ${target}: ${messageOf(cause)}`,
						cause,
					),
				);
			}
		},
	};
}

async function realPath(fs: FileSystem, target: string): Promise<string | null> {
	try {
		return await fs.realpath(target);
	} catch {
		return null;
	}
}

/**
 * Finds a program on the PATH of the environment it is given, else on the launcher's PATH. A name
 * with a slash is a path, checked as it is, as a shell does.
 */
function createFindExecutable(fs: FileSystem, fallbackPath: string | undefined): FindExecutable {
	return async (name, searchEnv) => {
		if (name.includes("/")) return (await isExecutableFile(fs, name)) ? name : null;
		const pathValue = searchEnv.PATH ?? fallbackPath ?? "";
		for (const folder of pathValue.split(":")) {
			if (folder === "") continue;
			const candidate = path.join(folder, name);
			if (await isExecutableFile(fs, candidate)) return candidate;
		}
		return null;
	};
}

async function isExecutableFile(fs: FileSystem, candidate: string): Promise<boolean> {
	try {
		await fs.access(candidate, fsConstants.X_OK);
		return (await fs.stat(candidate)).isFile();
	} catch {
		return false;
	}
}
