/**
 * Guard: none of Conductor's code is in the repository (D002, and the owner's ruling that a check fails
 * if any of the reference run reaches our app or repo). It reads every file git tracks or would track
 * (untracked files that are not ignored) and fails on any of three matches:
 *
 * - a file named like one of the bundle's hashed chunk files (`<name>-<8 characters>.<ext>`), which is
 *   how a copied bundle or chunk shows up;
 * - a file whose bytes are one of the bundle's code files (JavaScript, CSS or HTML), under any name;
 * - a file holding one of a set of 64-character windows of the bundle's own code, taken at the call
 *   sites the call inventory found (scripts/conductor-reference/fingerprints.ts).
 *
 * The data file (`conductor-fingerprints.json`) holds only SHA-256 hashes, plus a 32-bit rolling hash
 * per window so a file can be scanned in one pass; no text from the bundle is in the repository. Our
 * research cites chunk names in prose and comments, so a mention of a name is not a match; a copy is.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Problem } from "./lib.ts";

export const FINGERPRINTS = "scripts/guards/conductor-fingerprints.json";

/** The length of each code window, in UTF-16 code units. */
export const WINDOW = 64;

export interface Fingerprints {
	/** What the hashes were taken from. */
	source: string;
	/** SHA-256 of each hashed chunk file's name. */
	names: string[];
	/** SHA-256 of each code file's bytes. */
	contents: string[];
	/** Each code window: its rolling hash (see `rollingHash`) and its SHA-256. */
	windows: { rolling: number; sha256: string }[];
}

const BASE = 257;
/** BASE to the power WINDOW - 1, modulo 2^32: what the leaving character was multiplied by. */
const LEAVING = (() => {
	let power = 1;
	for (let index = 0; index < WINDOW - 1; index++) power = Math.imul(power, BASE) >>> 0;
	return power;
})();

/** A polynomial hash of `text`, modulo 2^32, the same one `scanWindows` rolls along a file. */
export function rollingHash(text: string): number {
	let hash = 0;
	for (let index = 0; index < text.length; index++) {
		hash = (Math.imul(hash, BASE) + text.charCodeAt(index)) >>> 0;
	}
	return hash;
}

export const sha256 = (data: string | Uint8Array): string =>
	new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** A hashed chunk file name, as a bundler writes them. */
export const CHUNK_NAME = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

/** Every WINDOW-long window of `text` whose hashes are in `windows`, by offset. */
export function scanWindows(text: string, windows: Map<number, Set<string>>): number[] {
	const found: number[] = [];
	if (text.length < WINDOW || windows.size === 0) return found;
	let hash = rollingHash(text.slice(0, WINDOW));
	for (let start = 0; ; start++) {
		const candidates = windows.get(hash);
		if (candidates?.has(sha256(text.slice(start, start + WINDOW)))) found.push(start);
		const next = start + WINDOW;
		if (next >= text.length) return found;
		const leaving = Math.imul(text.charCodeAt(start), LEAVING) >>> 0;
		hash = (Math.imul((hash - leaving) >>> 0, BASE) + text.charCodeAt(next)) >>> 0;
	}
}

/** Files git tracks, and untracked files it does not ignore, as paths from the root. */
export function repositoryFiles(root: string): string[] {
	const listed = spawnSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{
			cwd: root,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
	return [...new Set(listed.stdout.split("\0").filter((path) => path !== ""))].sort();
}

export const readFingerprints = (root: string): Fingerprints =>
	JSON.parse(readFileSync(join(root, FINGERPRINTS), "utf8")) as Fingerprints;

const problem = (message: string): Problem => ({ guard: "conductor-code", message });

/** Checks `files` (paths from `root`) against the fingerprints. Pure apart from reading the files. */
export function findConductorCode(
	root: string,
	files: readonly string[],
	fingerprints: Fingerprints,
): Problem[] {
	const names = new Set(fingerprints.names);
	const contents = new Set(fingerprints.contents);
	const windows = new Map<number, Set<string>>();
	for (const { rolling, sha256: hash } of fingerprints.windows) {
		const set = windows.get(rolling) ?? new Set<string>();
		set.add(hash);
		windows.set(rolling, set);
	}
	const problems: Problem[] = [];
	for (const file of files) {
		if (file === FINGERPRINTS) continue;
		const path = join(root, file);
		if (!existsSync(path) || !statSync(path).isFile()) continue;
		const name = basename(file);
		if (CHUNK_NAME.test(name) && names.has(sha256(name))) {
			problems.push(problem(`${file} is named like a file of Conductor's bundle`));
		}
		const bytes = readFileSync(path);
		if (contents.has(sha256(bytes))) {
			problems.push(problem(`${file} is a copy of a file of Conductor's bundle`));
			continue;
		}
		if (bytes.includes(0)) continue;
		const hits = scanWindows(bytes.toString("utf8"), windows);
		if (hits.length > 0) {
			problems.push(
				problem(
					`${file} holds ${hits.length} stretch(es) of Conductor's code, the first at character ${hits[0]}`,
				),
			);
		}
	}
	return problems;
}

export function checkConductorCode(root: string): Problem[] {
	return findConductorCode(root, repositoryFiles(root), readFingerprints(root));
}
