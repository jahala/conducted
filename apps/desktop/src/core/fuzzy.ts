/**
 * @feature APP-15 One shared fuzzy matcher
 * Owns: the one function that scores how well a query matches a text, and the helper that ranks a list
 * with it. Settings search (SET-02), the command palette (NAV-08) and the pickers call it from their
 * own features.
 * Behaviour: ui-map.md 6 (settings search is fuzzy over labels, descriptions and keywords, top 30
 * results, arrow keys and Enter) and 8 ("Fuzzy search util `aO({items, query, fields, threshold})` is
 * shared by settings search and pickers"); native-and-sidecar-map.md (the file search in Rust has its
 * own matcher, `nucleo-matcher`, for file paths; this one is for short labels in the UI).
 * Our design choice: a match is a subsequence match, case and accent insensitive, scored higher for a
 * prefix, a word start, an exact run of letters and a short text. `fields` carry weights, so a title
 * match ranks above a description match, which ranks above a keyword match (the order SET-02 asks
 * for). The ranges are UTF-16 indexes in the original text, so a row can highlight the matched letters.
 * Must handle: an empty or blank query (matches everything with score 0 when ranking); upper and lower
 * case; accents ("e" matches "é"); a query with several words (every word must match somewhere);
 * letters out of order (no match); a candidate that is empty; a limit of zero; ties (keep the input
 * order); 5,000 candidates (no regex built from user text); emoji and characters outside the basic
 * plane (ranges stay valid indexes).
 * Test first: with the titles "App zoom" and "Code theme", the query "zom" matches only "App zoom".
 */

export interface FuzzyRange {
	/** Index of the first matched character in the original text. */
	start: number;
	/** Index after the last matched character. */
	end: number;
}

export interface FuzzyMatch {
	/** Higher is better. Comparable only within one query. */
	score: number;
	ranges: readonly FuzzyRange[];
}

interface Unit {
	/** Start index of this code point in the original text, in UTF-16 units. */
	start: number;
	/** Index after this code point in the original text, in UTF-16 units. */
	end: number;
	/** The lower-case, accent-free characters this code point contributes. Empty for a stray mark. */
	chars: readonly string[];
	/** True at the start of the text, after a separator, and at a lower-to-upper case change. */
	wordStart: boolean;
}

interface FlatChar {
	char: string;
	unit: number;
	wordStart: boolean;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LOWER_OR_DIGIT = /[\p{Ll}\p{Nd}]/u;
const UPPERCASE = /\p{Lu}/u;
const COMBINING_MARK = /\p{M}/gu;

const WORD_START_BONUS = 5;
const PREFIX_BONUS = 3;
const CONSECUTIVE_BONUS = 3;
/** The largest shortness bonus. Longer texts approach zero. */
const SHORT_TEXT_BONUS = 4;

/** Reads an array element and treats a missing index as the programmer error it is. */
function read<T>(values: ArrayLike<T>, index: number): T {
	const value = values[index];
	if (value === undefined) {
		throw new RangeError(`fuzzy: index ${index} is out of range`);
	}
	return value;
}

function fold(text: string): string {
	return text.normalize("NFD").replace(COMBINING_MARK, "").toLowerCase();
}

/** Splits the candidate into code points, keeping the UTF-16 index of each one. */
function unitsOf(text: string): Unit[] {
	const raw: { start: number; end: number; chars: string[]; char: string }[] = [];
	let offset = 0;
	for (const char of text) {
		const end = offset + char.length;
		raw.push({ start: offset, end, chars: Array.from(fold(char)), char });
		offset = end;
	}
	const units: Unit[] = [];
	for (let index = 0; index < raw.length; index += 1) {
		const entry = read(raw, index);
		const previous = index > 0 ? read(raw, index - 1) : undefined;
		let wordStart = previous === undefined;
		if (previous !== undefined) {
			wordStart =
				!LETTER_OR_DIGIT.test(previous.char) ||
				(LOWER_OR_DIGIT.test(previous.char) && UPPERCASE.test(entry.char));
		}
		units.push({ start: entry.start, end: entry.end, chars: entry.chars, wordStart });
	}
	return units;
}

function flatten(units: readonly Unit[]): FlatChar[] {
	const flat: FlatChar[] = [];
	for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
		const unit = read(units, unitIndex);
		for (let charIndex = 0; charIndex < unit.chars.length; charIndex += 1) {
			flat.push({
				char: read(unit.chars, charIndex),
				unit: unitIndex,
				wordStart: unit.wordStart && charIndex === 0,
			});
		}
	}
	return flat;
}

function charScore(entry: FlatChar, first: boolean): number {
	let score = 1;
	if (entry.wordStart) {
		score += WORD_START_BONUS;
	}
	if (first && entry.unit === 0) {
		score += PREFIX_BONUS;
	}
	return score;
}

interface WordMatch {
	score: number;
	units: ReadonlySet<number>;
}

/**
 * Aligns one folded query word with the candidate, keeping the best score. The table holds the best
 * score for each end position, so a consecutive run wins over a match with gaps.
 */
function matchWord(word: readonly string[], flat: readonly FlatChar[]): WordMatch | null {
	const length = word.length;
	const size = flat.length;
	if (length === 0) {
		return { score: 0, units: new Set() };
	}
	if (length > size) {
		return null;
	}

	const parents: Int32Array[] = [];
	let previous = new Float64Array(size).fill(Number.NEGATIVE_INFINITY);
	parents.push(new Int32Array(size).fill(-1));
	const firstWanted = read(word, 0);
	for (let index = 0; index < size; index += 1) {
		const entry = read(flat, index);
		if (entry.char === firstWanted) {
			previous[index] = charScore(entry, true);
		}
	}

	for (let queryIndex = 1; queryIndex < length; queryIndex += 1) {
		const current = new Float64Array(size).fill(Number.NEGATIVE_INFINITY);
		const currentParents = new Int32Array(size).fill(-1);
		const wanted = read(word, queryIndex);
		let bestBefore = Number.NEGATIVE_INFINITY;
		let bestBeforeIndex = -1;
		for (let index = 0; index < size; index += 1) {
			const entry = read(flat, index);
			if (entry.char === wanted) {
				const consecutive =
					index > 0 ? read(previous, index - 1) + CONSECUTIVE_BONUS : Number.NEGATIVE_INFINITY;
				let best = bestBefore;
				let bestIndex = bestBeforeIndex;
				if (consecutive >= best) {
					best = consecutive;
					bestIndex = index - 1;
				}
				if (Number.isFinite(best)) {
					current[index] = charScore(entry, false) + best;
					currentParents[index] = bestIndex;
				}
			}
			if (index > 0) {
				const candidate = read(previous, index - 1);
				if (candidate > bestBefore) {
					bestBefore = candidate;
					bestBeforeIndex = index - 1;
				}
			}
		}
		parents.push(currentParents);
		previous = current;
	}

	let bestIndex = -1;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < size; index += 1) {
		const value = read(previous, index);
		if (value > bestScore) {
			bestScore = value;
			bestIndex = index;
		}
	}
	if (bestIndex < 0 || !Number.isFinite(bestScore)) {
		return null;
	}

	const units = new Set<number>();
	let index = bestIndex;
	for (let queryIndex = length - 1; queryIndex >= 0; queryIndex -= 1) {
		units.add(read(flat, index).unit);
		index = read(read(parents, queryIndex), index);
	}
	return { score: bestScore, units };
}

function rangesOf(units: readonly Unit[], matched: ReadonlySet<number>): FuzzyRange[] {
	const indexes = [...matched].sort((a, b) => a - b);
	const ranges: FuzzyRange[] = [];
	let start = -1;
	let end = -1;
	let previous = -2;
	for (const index of indexes) {
		const unit = read(units, index);
		if (start >= 0 && index === previous + 1) {
			end = unit.end;
		} else {
			if (start >= 0) {
				ranges.push({ start, end });
			}
			start = unit.start;
			end = unit.end;
		}
		previous = index;
	}
	if (start >= 0) {
		ranges.push({ start, end });
	}
	return ranges;
}

/** Null when the query does not match the candidate. */
export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
	const trimmed = query.trim();
	if (trimmed === "") {
		return { score: 0, ranges: [] };
	}
	const words = trimmed
		.split(/\s+/u)
		.map((word) => Array.from(fold(word)))
		.filter((word) => word.length > 0);
	if (words.length === 0) {
		return null;
	}

	const units = unitsOf(candidate);
	if (units.length === 0) {
		return null;
	}
	const flat = flatten(units);
	if (flat.length === 0) {
		return null;
	}

	const matched = new Set<number>();
	let score = 0;
	for (const word of words) {
		const match = matchWord(word, flat);
		if (match === null) {
			return null;
		}
		score += match.score;
		for (const unit of match.units) {
			matched.add(unit);
		}
	}
	score += SHORT_TEXT_BONUS / (units.length + SHORT_TEXT_BONUS);
	return { score, ranges: rangesOf(units, matched) };
}

export interface FuzzyField<T> {
	text: (item: T) => string;
	/** How much a match in this field is worth, relative to the other fields. */
	weight: number;
}

export interface FuzzyRanked<T> {
	item: T;
	score: number;
	/** The ranges in each field, in the order of the `fields` argument. Empty for a field with no match. */
	ranges: readonly (readonly FuzzyRange[])[];
}

/** Ranks `items` by their best weighted field. Items that match no field are left out. */
export function rankFuzzy<T>(
	items: readonly T[],
	query: string,
	fields: readonly FuzzyField<T>[],
	limit: number,
): FuzzyRanked<T>[] {
	if (limit <= 0) {
		return [];
	}
	if (query.trim() === "") {
		return items.slice(0, limit).map((item) => ({
			item,
			score: 0,
			ranges: fields.map(() => []),
		}));
	}

	const ranked: (FuzzyRanked<T> & { order: number })[] = [];
	items.forEach((item, order) => {
		const ranges: FuzzyRange[][] = [];
		let bestScore = Number.NEGATIVE_INFINITY;
		let matchedAny = false;
		for (const field of fields) {
			const match = fuzzyMatch(query, field.text(item));
			ranges.push(match === null ? [] : [...match.ranges]);
			if (match !== null) {
				matchedAny = true;
				const weighted = match.score * field.weight;
				if (weighted > bestScore) {
					bestScore = weighted;
				}
			}
		}
		if (matchedAny) {
			ranked.push({ item, score: bestScore, ranges, order });
		}
	});
	ranked.sort((left, right) => right.score - left.score || left.order - right.order);
	return ranked.slice(0, limit).map(({ item, score, ranges }) => ({ item, score, ranges }));
}
