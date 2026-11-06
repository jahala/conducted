/**
 * Small readers for minified JavaScript, used by the call inventory (inventory.ts). They read a string
 * literal, find the end of a bracketed span, and list the top-level keys of an object literal. They
 * know strings and template literals; they do not know regular-expression literals, so every reader
 * stops after a bounded distance and says it could not finish instead of guessing.
 */

/** How far a balanced scan reads before it gives up. */
export const SCAN_LIMIT = 6_000;

const CLOSER: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/**
 * Reads the string literal that starts at `start` (a quote or backtick). Returns its decoded text and
 * the offset just past the closing quote, or null when there is no literal there. A template literal's
 * `${...}` parts are kept as written, and `dynamic` says it had any.
 */
export function readString(
	text: string,
	start: number,
): { value: string; end: number; dynamic: boolean } | null {
	const quote = text[start];
	if (quote !== '"' && quote !== "'" && quote !== "`") return null;
	let value = "";
	let dynamic = false;
	let index = start + 1;
	while (index < text.length && index - start < SCAN_LIMIT) {
		const char = text[index] as string;
		if (char === "\\") {
			const next = text[index + 1] ?? "";
			value += next === "n" ? "\n" : next === "t" ? "\t" : next;
			index += 2;
			continue;
		}
		if (char === quote) return { value, end: index + 1, dynamic };
		if (quote !== "`" && char === "\n") return null;
		if (quote === "`" && char === "$" && text[index + 1] === "{") {
			const close = balancedEnd(text, index + 1);
			if (close === null) return null;
			value += text.slice(index, close);
			dynamic = true;
			index = close;
			continue;
		}
		value += char;
		index += 1;
	}
	return null;
}

/**
 * The offset just past the bracket that closes the one at `open` (`(`, `[` or `{`), skipping strings
 * and template literals. Null when it is not closed within SCAN_LIMIT characters.
 */
export function balancedEnd(text: string, open: number): number | null {
	const first = text[open] ?? "";
	const firstCloser = CLOSER[first];
	if (firstCloser === undefined) return null;
	const stack: string[] = [firstCloser];
	let index = open + 1;
	while (index < text.length && index - open < SCAN_LIMIT) {
		const char = text[index] as string;
		if (char === '"' || char === "'" || char === "`") {
			const literal = readString(text, index);
			if (literal === null) return null;
			index = literal.end;
			continue;
		}
		const closer = CLOSER[char];
		if (closer !== undefined) stack.push(closer);
		else if (char === stack[stack.length - 1]) {
			stack.pop();
			if (stack.length === 0) return index + 1;
		} else if (char === ")" || char === "]" || char === "}") return null;
		index += 1;
	}
	return null;
}

/** Splits the inside of a bracketed span at its top-level commas. */
export function splitTopLevel(inner: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	let index = 0;
	while (index < inner.length) {
		const char = inner[index] as string;
		if (char === '"' || char === "'" || char === "`") {
			const literal = readString(inner, index);
			const end = literal?.end ?? inner.length;
			current += inner.slice(index, end);
			index = end;
			continue;
		}
		if (char === "(" || char === "[" || char === "{") depth += 1;
		if (char === ")" || char === "]" || char === "}") depth -= 1;
		if (char === "," && depth === 0) {
			parts.push(current);
			current = "";
		} else current += char;
		index += 1;
	}
	if (current.trim() !== "") parts.push(current);
	return parts;
}

const KEY = /^\s*(?:\.\.\.\s*([\w$.]+)|"([^"]*)"|'([^']*)'|\[([^\]]*)\]|([\w$]+))\s*(?::|$|\()/;

/**
 * The top-level keys of the object literal that starts at `open`. A spread is listed as `...name` and
 * a computed key as `[expression]`. Null when the literal does not close within the scan limit.
 */
export function objectKeys(text: string, open: number): string[] | null {
	if (text[open] !== "{") return null;
	const end = balancedEnd(text, open);
	if (end === null) return null;
	const keys: string[] = [];
	for (const part of splitTopLevel(text.slice(open + 1, end - 1))) {
		const match = KEY.exec(part);
		if (match === null) continue;
		const [, spread, double, single, computed, plain] = match;
		if (spread !== undefined) keys.push(`...${spread}`);
		else if (computed !== undefined) keys.push(`[${computed}]`);
		else keys.push(double ?? single ?? plain ?? "");
	}
	return keys;
}

/** The offset of the first character at or after `from` that is not white space. */
export function skipSpace(text: string, from: number): number {
	let index = from;
	while (index < text.length && /\s/.test(text[index] as string)) index += 1;
	return index;
}

/** A regular-expression source that matches `name` as a whole identifier, not a property. */
export const identifier = (name: string): string =>
	`(?<![\\w$.#])${name.replace(/\$/g, "\\$")}(?![\\w$])`;
