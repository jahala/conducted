/**
 * The Rust half of the test-shapes guards. It reads the text of one Rust file, blanks comments and
 * string contents so they cannot fool a match, finds each `#[test]` function by matching braces,
 * and lists the tests that cannot fail or that remove their folder with the result thrown away.
 */
import type { Violation } from "./test-shapes.ts";

const ASSERT_MACRO =
	/\b(?:assert|assert_eq|assert_ne|debug_assert|debug_assert_eq|debug_assert_ne)!/;
const PANIC_PATH =
	/\bpanic!|\bunreachable!|\.unwrap\(\)|\.expect\(|\.unwrap_err\(\)|\.expect_err\(|[\w)\]]\s*\?[\s;.),\]}]/;
const CONSTANT_PATH = /^(?:[A-Za-z_]\w*::)*[A-Z][A-Z0-9_]{2,}$/;

/** Replaces comments and the insides of string and char literals with spaces, keeping line breaks. */
export function blankRust(text: string): string {
	const out = text.split("");
	const blank = (from: number, to: number): void => {
		for (let at = from; at < to; at++) if (out[at] !== "\n") out[at] = " ";
	};
	let at = 0;
	while (at < text.length) {
		const two = text.slice(at, at + 2);
		if (two === "//") {
			const end = text.indexOf("\n", at);
			const stop = end === -1 ? text.length : end;
			blank(at, stop);
			at = stop;
		} else if (two === "/*") {
			let depth = 1;
			let cursor = at + 2;
			while (cursor < text.length && depth > 0) {
				if (text.startsWith("/*", cursor)) {
					depth++;
					cursor += 2;
				} else if (text.startsWith("*/", cursor)) {
					depth--;
					cursor += 2;
				} else cursor++;
			}
			blank(at, cursor);
			at = cursor;
		} else if (
			text[at] === "r" &&
			/^r#*"/.test(text.slice(at, at + 40)) &&
			!/\w/.test(text[at - 1] ?? "")
		) {
			const hashes = /^r(#*)"/.exec(text.slice(at, at + 40))?.[1] ?? "";
			const close = `"${hashes}`;
			const start = at + 2 + hashes.length;
			const end = text.indexOf(close, start);
			const stop = end === -1 ? text.length : end;
			blank(start, stop);
			at = stop + close.length;
		} else if (text[at] === '"') {
			let cursor = at + 1;
			while (cursor < text.length && text[cursor] !== '"') cursor += text[cursor] === "\\" ? 2 : 1;
			blank(at + 1, cursor);
			at = cursor + 1;
		} else if (text[at] === "'") {
			const char = /^'(?:\\.[^']*|[^\\'])'/.exec(text.slice(at, at + 12));
			if (char === null) at++;
			else {
				blank(at + 1, at + char[0].length - 1);
				at += char[0].length;
			}
		} else at++;
	}
	return out.join("");
}

/** Index just past the bracket that closes the one at `open`, or -1. */
function matchBracket(text: string, open: number): number {
	const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
	const opener = text[open] ?? "";
	const closer = pairs[opener];
	if (closer === undefined) return -1;
	let depth = 0;
	for (let at = open; at < text.length; at++) {
		if (text[at] === opener) depth++;
		else if (text[at] === closer) {
			depth--;
			if (depth === 0) return at + 1;
		}
	}
	return -1;
}

interface RustFn {
	name: string;
	/** Offset of the `fn` keyword. */
	at: number;
	body: string;
	isTest: boolean;
}

function functionsOf(text: string): RustFn[] {
	const fns: RustFn[] = [];
	const pattern = /\bfn\s+(\w+)/g;
	for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
		const paramsOpen = text.indexOf("(", match.index);
		if (paramsOpen === -1) continue;
		const paramsEnd = matchBracket(text, paramsOpen);
		if (paramsEnd === -1) continue;
		const rest = text.slice(paramsEnd);
		const bodyMatch = /^[^{;]*(\{)/.exec(rest);
		if (bodyMatch === null) continue;
		const open = paramsEnd + bodyMatch[0].length - 1;
		const end = matchBracket(text, open);
		if (end === -1) continue;
		const before = text.slice(Math.max(0, match.index - 400), match.index);
		const attrs = /(?:#\[[^\]]*\]\s*(?:pub\s+|async\s+|unsafe\s+)*)+$/.exec(before)?.[0] ?? "";
		fns.push({
			name: match[1] ?? "",
			at: match.index,
			body: text.slice(open, end),
			isTest: /#\[\s*(?:\w+::)*test\b/.test(attrs),
		});
	}
	return fns;
}

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

/** Names of functions whose body asserts, directly or through another function of the file. */
function assertingFns(fns: RustFn[]): Set<string> {
	const asserting = new Set<string>();
	for (let changed = true; changed; ) {
		changed = false;
		for (const fn of fns) {
			if (asserting.has(fn.name)) continue;
			const direct = ASSERT_MACRO.test(fn.body) || PANIC_PATH.test(fn.body);
			const indirect = [...asserting].some((name) => new RegExp(`\\b${name}\\s*\\(`).test(fn.body));
			if (direct || indirect) {
				asserting.add(fn.name);
				changed = true;
			}
		}
	}
	return asserting;
}

/** Splits macro arguments at top-level commas. */
function splitArgs(inner: string): string[] {
	const args: string[] = [];
	let depth = 0;
	let current = "";
	for (const char of inner) {
		if ("([{".includes(char)) depth++;
		if (")]}".includes(char)) depth--;
		if (char === "," && depth === 0) {
			args.push(current.trim());
			current = "";
		} else current += char;
	}
	if (current.trim() !== "") args.push(current.trim());
	return args;
}

const isRustLiteral = (arg: string): boolean => /^(?:-?\d[\d_.]*\w*|true|false|b?"\s*")$/.test(arg);

/** Every assertion macro call in a body, as its arguments. */
function assertions(body: string): { name: string; args: string[] }[] {
	const found: { name: string; args: string[] }[] = [];
	const pattern =
		/\b(assert|assert_eq|assert_ne|debug_assert|debug_assert_eq|debug_assert_ne)!\s*\(/g;
	for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) {
		const open = match.index + match[0].length - 1;
		const end = matchBracket(body, open);
		if (end === -1) continue;
		found.push({ name: match[1] ?? "", args: splitArgs(body.slice(open + 1, end - 1)) });
	}
	return found;
}

function loopsWithoutNonEmptyCheck(body: string): { offset: number; text: string }[] {
	const found: { offset: number; text: string }[] = [];
	const proves = (root: string): boolean =>
		assertions(body).some(({ name, args }) => {
			const text = args.join(",");
			if (!new RegExp(`\\b${root}\\b`).test(text)) return false;
			if (name === "assert" && /!\s*[^,]*\.is_empty\(\)/.test(text)) return true;
			if (
				name === "assert" &&
				/\.(any|contains|iter\(\)\.position)\(/.test(text) &&
				!/^\s*!/.test(text)
			)
				return true;
			if (name === "assert_eq" && /\.is_empty\(\)/.test(text) && args.includes("false"))
				return true;
			if (!/\.len\(\)|\.count\(\)/.test(text)) return false;
			if (name === "assert") return !/==\s*0\b|<\s*1\b/.test(text);
			if (name === "assert_eq") return args.some((arg) => /^\d+$/.test(arg) && arg !== "0");
			if (name === "assert_ne") return args.includes("0");
			return false;
		});
	const nonEmptyLiteral = (root: string): boolean =>
		new RegExp(`let\\s+(?:mut\\s+)?${root}\\b[^=;]*=\\s*&?(?:vec!\\s*)?\\[\\s*[^\\]\\s]`).test(
			body,
		);
	const forPattern = /\bfor\s+[^{]*?\sin\s+([^{]+?)\s*\{/g;
	for (let match = forPattern.exec(body); match !== null; match = forPattern.exec(body)) {
		const open = match.index + match[0].length - 1;
		const end = matchBracket(body, open);
		if (end === -1) continue;
		const loopBody = body.slice(open, end);
		if (!ASSERT_MACRO.test(loopBody)) continue;
		const collection = (match[1] ?? "").trim();
		if (/^[[(]|^vec!|^-?\d+\s*\.\./.test(collection)) continue;
		const root = /[A-Za-z_]\w*/.exec(collection)?.[0];
		if (root === undefined || nonEmptyLiteral(root) || proves(root)) continue;
		found.push({ offset: match.index, text: collection });
	}
	const allPattern =
		/\b(\w+)\s*(?:\.\s*\w+\s*\([^)]*\)\s*)*\.\s*iter\(\)\s*(?:\.\s*\w+\s*\([^)]*\)\s*)*\.all\(/g;
	for (let match = allPattern.exec(body); match !== null; match = allPattern.exec(body)) {
		const root = match[1] ?? "";
		const before = body.slice(Math.max(0, match.index - 60), match.index);
		if (!/assert[_a-z]*!\s*\(\s*$/.test(before)) continue;
		if (nonEmptyLiteral(root) || proves(root)) continue;
		found.push({ offset: match.index, text: `${root}.iter().all(..)` });
	}
	return found;
}

/** Finds `remove_dir_all(...)` followed by `.ok()`, which throws away the failure. */
function silentRemovals(body: string): number[] {
	const found: number[] = [];
	const pattern = /\bremove_dir_all\s*\(/g;
	for (let match = pattern.exec(body); match !== null; match = pattern.exec(body)) {
		const open = match.index + match[0].length - 1;
		const end = matchBracket(body, open);
		if (end === -1) continue;
		if (/^\s*\.ok\(\)/.test(body.slice(end))) found.push(match.index);
	}
	return found;
}

/** Runs the Rust checks over one file's text. */
export function analyseRust(rel: string, source: string): Violation[] {
	const text = blankRust(source);
	const fns = functionsOf(text);
	const asserting = assertingFns(fns);
	const found: Violation[] = [];
	for (const fn of fns.filter((item) => item.isTest)) {
		const line = lineAt(text, fn.at);
		const calls = [...asserting].filter(
			(name) => name !== fn.name && new RegExp(`\\b${name}\\s*\\(`).test(fn.body),
		);
		if (!ASSERT_MACRO.test(fn.body) && !PANIC_PATH.test(fn.body) && calls.length === 0) {
			found.push({
				guard: "tests-cannot-fail",
				check: "no-assertion",
				file: rel,
				line,
				message: `test ${fn.name} has no assert and no panic path`,
			});
		}
		const all = assertions(fn.body);
		const echo = (item: { name: string; args: string[] }): boolean => {
			const [left = "", right = ""] = item.args;
			if (item.name !== "assert_eq" && item.name !== "assert_ne") return false;
			return (
				(CONSTANT_PATH.test(left) && isRustLiteral(right)) ||
				(CONSTANT_PATH.test(right) && isRustLiteral(left))
			);
		};
		if (all.length > 0 && all.every(echo) && !PANIC_PATH.test(fn.body)) {
			found.push({
				guard: "tests-cannot-fail",
				check: "constant-echo",
				file: rel,
				line,
				message: `test ${fn.name} only compares a constant with a literal`,
			});
		}
		for (const loop of loopsWithoutNonEmptyCheck(fn.body)) {
			found.push({
				guard: "tests-cannot-fail",
				check: "empty-loop",
				file: rel,
				line: lineAt(text, fn.at) + fn.body.slice(0, loop.offset).split("\n").length - 1,
				message: `test ${fn.name} asserts over ${loop.text} with no check that it is not empty`,
			});
		}
		for (const offset of silentRemovals(fn.body)) {
			found.push({
				guard: "time-and-leaks",
				check: "silent-removal",
				file: rel,
				line: lineAt(text, fn.at) + fn.body.slice(0, offset).split("\n").length - 1,
				message: `test ${fn.name} calls remove_dir_all(..).ok(), which hides a failed cleanup`,
			});
		}
	}
	return found;
}
