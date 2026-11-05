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
});
