/**
 * @feature DATA-05 Settings store and settings files
 * @feature SET-14 Keep comments when the app rewrites a settings file
 * Owns: the production TOML reader and writer the settings service calls. smol-toml parses and
 * writes a new file; @decimalturn/toml-patch (MIT, D010) edits an existing file in place (SET-14).
 * Also lists a text's comments, so the settings service can tell when a rewrite would drop one.
 * Behaviour: services-map.md 4.2.1 (settings files are TOML), 4.2.4 (schema, named actions and env
 * var tables are TOML tables).
 * Our design choice: Conductor rewrites the whole file and drops its comments (main @290816). A
 * patch changes only the entries whose values differ, so comments, blank lines and key order stay.
 * Must handle: invalid text returns an error Result and never throws; a document with `$schema`,
 * nested tables and string arrays survives a parse and a write; a `#` inside any of TOML's four
 * kinds of string is not a comment.
 * Test first: a written document parses back to the same object.
 * SET-14 test first: patching one value of a hand-written file changes only that value's text.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { patch } from "@decimalturn/toml-patch";
import { parse, stringify } from "smol-toml";
import type { TomlCodec } from "./settings.ts";

const invalid = (cause: unknown, fallback: string) =>
	err(appError("toml_invalid", cause instanceof Error ? cause.message : fallback, cause));

/** The index just past the string that opens at `start`, or the end of the text when it never closes. */
function stringEnd(text: string, start: number): number {
	const quote = text[start] ?? "";
	const escapes = quote === '"';
	const fence = quote.repeat(3);
	if (text.startsWith(fence, start)) {
		let index = start + 3;
		while (index < text.length) {
			if (escapes && text[index] === "\\") {
				index += 2;
				continue;
			}
			if (text.startsWith(fence, index)) {
				// Up to two more quotes belong to the string: `"""a""""` holds `a"`.
				let end = index + 3;
				while (end < index + 5 && text[end] === quote) end += 1;
				return end;
			}
			index += 1;
		}
		return text.length;
	}
	let index = start + 1;
	while (index < text.length && text[index] !== "\n") {
		if (escapes && text[index] === "\\") {
			index += 2;
			continue;
		}
		if (text[index] === quote) return index + 1;
		index += 1;
	}
	return index;
}

/** Every comment of a TOML text in order, from its `#` to the end of its line, trailing spaces cut. */
function comments(text: string): string[] {
	const found: string[] = [];
	let index = 0;
	while (index < text.length) {
		const char = text[index];
		if (char === "#") {
			const newline = text.indexOf("\n", index);
			const end = newline === -1 ? text.length : newline;
			found.push(text.slice(index, end).trimEnd());
			index = end;
		} else if (char === '"' || char === "'") {
			index = stringEnd(text, index);
		} else {
			index += 1;
		}
	}
	return found;
}

/** Reads and writes the TOML of settings files. Values are plain objects, never class instances. */
export const tomlCodec: TomlCodec = {
	parse(text): Result<Record<string, unknown>> {
		try {
			const value: unknown = parse(text);
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				return err(appError("toml_invalid", "A settings file must be a TOML table."));
			}
			return ok(value as Record<string, unknown>);
		} catch (cause) {
			return invalid(cause, "The settings file is not valid TOML.");
		}
	},
	stringify(value): Result<string> {
		try {
			return ok(stringify(value));
		} catch (cause) {
			return invalid(cause, "The settings could not be written as TOML.");
		}
	},
	patch(text, value): Result<string> {
		try {
			return ok(patch(text, value));
		} catch (cause) {
			return invalid(cause, "The settings file could not be edited in place.");
		}
	},
	comments,
};
