/**
 * @feature AGENT-09 Cursor: SDK in process: reading loose records
 * Owns: tests for the record helpers, and the check that no other sidecar file keeps its own copy.
 * Test first: asRecord([]) is null and readString({ a: 1 }, "a") is null.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { asRecord, isRecord, readString } from "./records.ts";

const SRC = path.join(import.meta.dir, "..");
const COPY = /\bfunction\s+(isRecord|asRecord|readString)\s*\(/;

/** The sidecar source files, other than tests and this helper. */
function sourceFiles(folder: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(folder, { withFileTypes: true })) {
		const full = path.join(folder, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
	}
	return out;
}

describe("AGENT-09 record helpers", () => {
	test("arrays and null are never records", () => {
		expect(isRecord({ a: 1 })).toBe(true);
		expect(isRecord([])).toBe(false);
		expect(isRecord(null)).toBe(false);
		expect(asRecord([])).toBeNull();
		expect(asRecord("text")).toBeNull();
		expect(asRecord({ a: 1 })).toEqual({ a: 1 });
	});

	test("a string field reads as the string, anything else as null", () => {
		expect(readString({ a: "x" }, "a")).toBe("x");
		expect(readString({ a: 1 }, "a")).toBeNull();
		expect(readString(null, "a")).toBeNull();
		expect(readString(undefined, "a")).toBeNull();
	});

	test("no other sidecar file defines its own copy", () => {
		expect(COPY.test("function asRecord(value: unknown) {")).toBe(true);
		const own = path.join(import.meta.dir, "records.ts");
		const copies = sourceFiles(SRC)
			.filter((file) => file !== own && COPY.test(readFileSync(file, "utf8")))
			.map((file) => path.relative(SRC, file));
		expect(copies).toEqual([]);
	});
});
