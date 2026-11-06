/**
 * Places a Conductor bundle offset on a screen: the `ui-map.md` or `ui-dimensions.md` section that
 * cites the nearest offset in the same bundle file. The research cites offsets as `R@N` or `M@N`, or
 * as `renderApp @N` and `main @N`; strings of one component sit at nearby offsets.
 * Behaviour: docs/plans/parity-harness.md section 2 (a gap names its screen).
 * Must handle: an offset with no citation within `WINDOW` characters is "Unplaced", never the
 * nearest section however far away; sections are named by their numbered heading.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const WINDOW = 20_000;
export const UNPLACED = "Unplaced";

const FILES: Record<string, string> = { R: "renderApp-DeUrsznk.js", M: "main-BE1h_1MP.js" };

export interface Citation {
	file: string;
	offset: number;
	section: string;
}

/** Every offset a research document cites, with the heading it sits under. */
export function citations(doc: string, name: string): Citation[] {
	const found: Citation[] = [];
	let section = name;
	for (const line of doc.split("\n")) {
		const heading = /^#{2,4} (.+)$/.exec(line);
		if (heading?.[1] !== undefined) {
			section = `${name} ${heading[1].trim()}`;
			continue;
		}
		const pattern = /\b(R|M)@(\d+)|\b(renderApp|main) @(\d+)/g;
		for (const match of line.matchAll(pattern)) {
			const code = match[1] ?? (match[3] === "renderApp" ? "R" : "M");
			const file = FILES[code];
			const offset = Number(match[2] ?? match[4]);
			if (file !== undefined) found.push({ file, offset, section });
		}
	}
	return found;
}

/** A lookup from (file, offset) to the screen whose citation is nearest. */
export function screenIndex(cited: Citation[]): (file: string, offset: number | null) => string {
	const byFile = new Map<string, Citation[]>();
	for (const citation of cited) {
		const list = byFile.get(citation.file) ?? [];
		list.push(citation);
		byFile.set(citation.file, list);
	}
	for (const list of byFile.values()) list.sort((a, b) => a.offset - b.offset);
	return (file, offset) => {
		const list = byFile.get(file);
		if (list === undefined || offset === null) return UNPLACED;
		let best: Citation | undefined;
		for (const citation of list) {
			const distance = Math.abs(citation.offset - offset);
			if (distance > WINDOW) continue;
			if (best === undefined || distance < Math.abs(best.offset - offset)) best = citation;
		}
		return best?.section ?? UNPLACED;
	};
}

/** The screen lookup over this checkout's two research maps. */
export function researchScreens(root: string): (file: string, offset: number | null) => string {
	const cited: Citation[] = [];
	for (const name of ["ui-map.md", "ui-dimensions.md"]) {
		const doc = readFileSync(join(root, "docs/research/conductor", name), "utf8");
		cited.push(...citations(doc, name.replace(/\.md$/, "")));
	}
	return screenIndex(cited);
}
