/**
 * @feature REV-11 Resolve conflicts inline: current, incoming or both
 * Owns: the shape of a conflict region and the rule that reads its markers, plus the error code
 * for a resolution written but not staged. The workspace-files service and the conflict resolver
 * share them.
 * Behaviour: services-map.md 5B.1.9 (inline conflict resolution).
 */
import { appError, err, ok, type Result } from "@conducted/shared";

/** A conflict resolution was written to disk, but `git add` failed afterwards. */
export const CONFLICT_SAVED_NOT_STAGED = "conflict_saved_not_staged";

/** One conflict region in a file, in the order it appears. */
export interface ConflictHunk {
	/** 0-based, top to bottom. */
	index: number;
	/** 1-based line of the `<<<<<<<` marker. */
	startLine: number;
	/** 1-based line of the `>>>>>>>` marker. */
	endLine: number;
	/** The lines between `<<<<<<<` and `=======` (or the diff3 base marker), joined by `\n`. */
	currentText: string;
	/** The lines between `=======` and `>>>>>>>`, joined by `\n`. */
	incomingText: string;
	/** The current side split into lines, so a blank side stays empty when it is applied. */
	currentLines: readonly string[];
	/** The incoming side split into lines, so a blank side stays empty when it is applied. */
	incomingLines: readonly string[];
}

type ConflictMarker = "start" | "base" | "separator" | "end";

/** The marker a line is, ignoring a Windows line ending. Any other line is null. */
const conflictMarkerOf = (line: string): ConflictMarker | null => {
	const body = line.endsWith("\r") ? line.slice(0, -1) : line;
	if (/^<{7}(?: .*)?$/.test(body)) return "start";
	if (/^\|{7}(?: .*)?$/.test(body)) return "base";
	if (/^={7}$/.test(body)) return "separator";
	if (/^>{7}(?: .*)?$/.test(body)) return "end";
	return null;
};

/** A malformed marker can leave a file half resolved, so it is refused before anything is written. */
const malformedConflict = (line: number): Result<never> =>
	err(
		appError(
			"conflict_markers_malformed",
			`The conflict markers in this file are malformed near line ${line}. Fix them by hand.`,
		),
	);

/**
 * Reads the conflict regions top to bottom. Malformed markers return an Err, so a caller never
 * writes a file it only partly understood.
 */
export function parseConflictMarkers(text: string): Result<ConflictHunk[]> {
	const lines = text.split("\n");
	const hunks: ConflictHunk[] = [];
	let at = 0;
	while (at < lines.length) {
		const marker = conflictMarkerOf(lines[at] ?? "");
		if (marker === "start") {
			const startLine = at + 1;
			const currentLines: string[] = [];
			at += 1;
			while (
				at < lines.length &&
				conflictMarkerOf(lines[at] ?? "") !== "separator" &&
				conflictMarkerOf(lines[at] ?? "") !== "base"
			) {
				const inside = conflictMarkerOf(lines[at] ?? "");
				if (inside === "start" || inside === "end") return malformedConflict(at + 1);
				currentLines.push(lines[at] ?? "");
				at += 1;
			}
			if (at >= lines.length) return malformedConflict(startLine);
			if (conflictMarkerOf(lines[at] ?? "") === "base") {
				at += 1;
				while (at < lines.length && conflictMarkerOf(lines[at] ?? "") !== "separator") {
					const inside = conflictMarkerOf(lines[at] ?? "");
					if (inside !== null) return malformedConflict(at + 1);
					at += 1;
				}
				if (at >= lines.length) return malformedConflict(startLine);
			}
			if (conflictMarkerOf(lines[at] ?? "") !== "separator") return malformedConflict(at + 1);
			at += 1;
			const incomingLines: string[] = [];
			while (at < lines.length && conflictMarkerOf(lines[at] ?? "") !== "end") {
				const inside = conflictMarkerOf(lines[at] ?? "");
				if (inside !== null) return malformedConflict(at + 1);
				incomingLines.push(lines[at] ?? "");
				at += 1;
			}
			if (at >= lines.length) return malformedConflict(startLine);
			hunks.push({
				index: hunks.length,
				startLine,
				endLine: at + 1,
				currentText: currentLines.join("\n"),
				incomingText: incomingLines.join("\n"),
				currentLines,
				incomingLines,
			});
			at += 1;
			continue;
		}
		if (marker === "end" || marker === "base") return malformedConflict(at + 1);
		at += 1;
	}
	return ok(hunks);
}
