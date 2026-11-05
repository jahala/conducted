/**
 * @feature SIDE-08 Checkpoints: end-of-turn file summary
 * Owns: turning the output of `checkpointer.sh diff <start> <end> -- --name-status -z` and
 * `... -- --numstat -z` into the FileChange list stored on the end checkpoint event.
 * Behaviour: research/conductor/sessions.md section 7 ("End checkpoints also compute a diff
 * summary ... parsed to [{path,status,linesAdded,linesRemoved,isBinary,oldPath}]. Over 200 files
 * the diff is omitted").
 * Must handle: renames and copies (two paths, old path kept), binary files (numstat prints "-" and
 * "-", counted as 0 lines with binary true), paths with spaces, tabs or newlines (the -z form
 * makes them safe), a path in only one of the two outputs (kept with zero counts), a type change
 * (reported as modified), and more than 200 files (the list is omitted, not cut).
 * Test first: a rename with 3 added lines parses to status renamed, oldPath set, linesAdded 3.
 * Our design choice: -z output, so no unquoting of paths is needed.
 */
import type { FileChange } from "@conducted/protocol";

/** Above this many files the summary is left out, as in Conductor. */
export const MAX_SUMMARY_FILES = 200;

const STATUS_BY_LETTER: Record<string, FileChange["status"]> = {
	A: "added",
	M: "modified",
	D: "deleted",
	R: "renamed",
	C: "copied",
	T: "modified",
	U: "modified",
};

interface NameStatusEntry {
	path: string;
	oldPath?: string;
	status: FileChange["status"];
}

function parseNameStatus(text: string): NameStatusEntry[] {
	const tokens = text.split("\0");
	const entries: NameStatusEntry[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const code = tokens[i];
		if (!code) continue;
		// A letter git prints that we do not know (X, B) still has one path after it, so it is
		// read as a modified file and the path token is never mistaken for a status.
		const status = STATUS_BY_LETTER[code[0] ?? ""] ?? "modified";
		if (status === "renamed" || status === "copied") {
			const oldPath = tokens[i + 1];
			const path = tokens[i + 2];
			i += 2;
			if (oldPath !== undefined && path !== undefined) entries.push({ path, oldPath, status });
		} else {
			const path = tokens[i + 1];
			i += 1;
			if (path !== undefined) entries.push({ path, status });
		}
	}
	return entries;
}

interface NumstatEntry {
	path: string;
	added: number;
	removed: number;
	binary: boolean;
}

function parseNumstat(text: string): NumstatEntry[] {
	const tokens = text.split("\0");
	const entries: NumstatEntry[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token) continue;
		const first = token.indexOf("\t");
		const second = token.indexOf("\t", first + 1);
		if (first === -1 || second === -1) continue;
		const addedText = token.slice(0, first);
		const removedText = token.slice(first + 1, second);
		const rest = token.slice(second + 1);
		const binary = addedText === "-" && removedText === "-";
		let path = rest;
		if (rest === "") {
			// A rename or copy: the next two tokens are the old and the new path.
			path = tokens[i + 2] ?? "";
			i += 2;
		}
		entries.push({
			path,
			added: binary ? 0 : Number(addedText),
			removed: binary ? 0 : Number(removedText),
			binary,
		});
	}
	return entries;
}

export function parseDiffSummary(nameStatus: string, numstat: string): FileChange[] {
	const counts = new Map(parseNumstat(numstat).map((entry) => [entry.path, entry]));
	const seen = new Set<string>();
	const changes: FileChange[] = [];
	for (const entry of parseNameStatus(nameStatus)) {
		const count = counts.get(entry.path);
		seen.add(entry.path);
		changes.push({
			path: entry.path,
			...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
			status: entry.status,
			linesAdded: count?.added ?? 0,
			linesRemoved: count?.removed ?? 0,
			binary: count?.binary ?? false,
		});
	}
	for (const [path, count] of counts) {
		if (seen.has(path)) continue;
		changes.push({
			path,
			status: "modified",
			linesAdded: count.added,
			linesRemoved: count.removed,
			binary: count.binary,
		});
	}
	return changes;
}

/** Returns the list, or undefined when it is too long to store. */
export function capSummary(changes: FileChange[]): FileChange[] | undefined {
	return changes.length > MAX_SUMMARY_FILES ? undefined : changes;
}
