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

	test("SIDE-02 a long line in many chunks costs time in proportion to its length (#617)", () => {
		// One line of `chars` characters, pushed in 16 KiB chunks as a socket hands them over.
		const CHUNK = 16 * 1024;
		const pushLine = (chars: number): number => {
			const line = `{"output":"${"x".repeat(chars - 14)}"}\n`;
			const decoder = new LineDecoder();
			const started = performance.now();
			let decoded = 0;
			for (let at = 0; at < line.length; at += CHUNK) {
				decoded += decoder.push(line.slice(at, at + CHUNK)).length;
			}
			const took = performance.now() - started;
			expect(decoded).toBe(1);
			return took;
		};
		// The fastest of five runs, so a collector pause in one run does not decide it.
		const fastest = (chars: number): number =>
			Math.min(...Array.from({ length: 5 }, () => pushLine(chars)));
		pushLine(1024 * 1024);
		const short = fastest(2 * 1024 * 1024);
		const long = fastest(8 * 1024 * 1024);
		// Four times the line takes about four times as long when each character is handled once.
		// Searching the whole line again for every chunk takes about sixteen times as long.
		expect(long / short).toBeLessThan(8);
	});

	test("SIDE-02 twenty thousand short lines in one chunk come back in order", () => {
		const decoder = new LineDecoder();
		const chunk = Array.from({ length: 20_000 }, (_, index) => `[${index}]\n`).join("");
		const out = decoder.push(chunk);
		expect(out).toHaveLength(20_000);
		expect(out[19_999]).toEqual({ ok: true, value: [19_999] });
	});
});
