import { describe, expect, test } from "bun:test";
import { encodeLine, LineDecoder } from "./ndjson.ts";

describe("SIDE-02 NDJSON framing", () => {
	test("SIDE-02 a message split across chunks is decoded once complete", () => {
		const decoder = new LineDecoder();
		expect(decoder.push('{"a":1}\n{"b"')).toEqual([{ ok: true, value: { a: 1 } }]);
		expect(decoder.push(":2}\n")).toEqual([{ ok: true, value: { b: 2 } }]);
	});

	test("SIDE-02 several messages in one chunk, CRLF and blank lines", () => {
		const decoder = new LineDecoder();
		const out = decoder.push('{"a":1}\r\n\n{"b":2}\n');
		expect(out).toEqual([
			{ ok: true, value: { a: 1 } },
			{ ok: true, value: { b: 2 } },
		]);
	});

	test("SIDE-02 invalid JSON is reported and the next line still parses", () => {
		const decoder = new LineDecoder();
		const out = decoder.push("nope\n[1]\n");
		expect(out[0]?.ok).toBe(false);
		expect(out[1]).toEqual({ ok: true, value: [1] });
	});

	test("SIDE-02 an oversize line is dropped once and decoding resumes after its newline", () => {
		const decoder = new LineDecoder(10);
		const first = decoder.push("x".repeat(25));
		expect(first).toHaveLength(1);
		expect(first[0]?.ok).toBe(false);
		expect(decoder.push("yyy")).toEqual([]);
		expect(decoder.push("\n[2]\n")).toEqual([{ ok: true, value: [2] }]);
	});

	test("SIDE-02 encodeLine ends with exactly one newline", () => {
		expect(encodeLine({ a: 1 })).toBe('{"a":1}\n');
	});

	test("SIDE-02 a long line in many chunks is searched for its end once, not again per chunk (#617)", () => {
		// One line of 8 MiB, pushed in 16 KiB chunks as a socket hands them over. The work is
		// counted, not timed, so a busy machine cannot change the answer: every character searched
		// for a newline, through indexOf or split, is counted while the line arrives.
		const CHUNK = 16 * 1024;
		const line = `{"output":"${"x".repeat(8 * 1024 * 1024 - 14)}"}\n`;
		const decoder = new LineDecoder();
		let searched = 0;
		const indexOf = String.prototype.indexOf;
		const split = String.prototype.split;
		String.prototype.indexOf = function (this: string, search: string, from?: number) {
			if (search === "\n") searched += this.length - Math.max(0, from ?? 0);
			return indexOf.call(this, search, from);
		};
		String.prototype.split = function (this: string, separator: unknown, limit?: number) {
			if (separator === "\n") searched += this.length;
			return (split as (this: string, separator: string, limit?: number) => string[]).call(
				this,
				separator as string,
				limit,
			);
		} as typeof String.prototype.split;
		let decoded = 0;
		try {
			for (let at = 0; at < line.length; at += CHUNK) {
				decoded += decoder.push(line.slice(at, at + CHUNK)).length;
			}
		} finally {
			String.prototype.indexOf = indexOf;
			String.prototype.split = split;
		}
		expect(decoded).toBe(1);
		// Each character is searched once. Searching the held text again for every chunk would
		// search about (length / chunk) / 2 times the line: some 256 times here.
		expect(searched).toBeLessThanOrEqual(line.length);
	});

	test("SIDE-02 twenty thousand short lines in one chunk come back in order", () => {
		const decoder = new LineDecoder();
		const chunk = Array.from({ length: 20_000 }, (_, index) => `[${index}]\n`).join("");
		const out = decoder.push(chunk);
		expect(out).toHaveLength(20_000);
		expect(out[19_999]).toEqual({ ok: true, value: [19_999] });
	});
});
