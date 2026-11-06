/**
 * @feature REV-08 CSV parser
 * Tests quoted fields, line endings, the row cap and the unterminated-quote warning.
 */
import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv-parse.ts";

describe("REV-08 parseCsv", () => {
	it("parses a quoted field with a comma inside", () => {
		const parsed = parseCsv('a,"b,c"\n1,2', ",", 100);
		expect(parsed.rows).toEqual([
			["a", "b,c"],
			["1", "2"],
		]);
		expect(parsed.truncated).toBe(false);
	});

	it("keeps a doubled quote inside a quoted field", () => {
		expect(parseCsv('"say ""hi""",b', ",", 100).rows).toEqual([['say "hi"', "b"]]);
	});

	it("keeps a newline inside a quoted field", () => {
		expect(parseCsv('"one\ntwo",b', ",", 100).rows).toEqual([["one\ntwo", "b"]]);
	});

	it("accepts CRLF and LF and ignores a trailing newline", () => {
		expect(parseCsv("a,b\r\n1,2\r\n", ",", 100).rows).toEqual([
			["a", "b"],
			["1", "2"],
		]);
		expect(parseCsv("a,b\n1,2\n", ",", 100).rows).toHaveLength(2);
	});

	it("uses the tab delimiter for a TSV file", () => {
		expect(parseCsv("a\tb\n1\t2", "\t", 100).rows).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	it("warns when the last quote is not closed and keeps the rest as one cell", () => {
		const parsed = parseCsv('a,"b,c', ",", 100);
		expect(parsed.rows).toEqual([["a", "b,c"]]);
		expect(parsed.warnings).toHaveLength(1);
	});

	it("caps the rows and says it truncated", () => {
		const parsed = parseCsv("a\nb\nc\nd", ",", 2);
		expect(parsed.rows).toEqual([["a"], ["b"]]);
		expect(parsed.truncated).toBe(true);
	});

	it("gives no rows for empty text", () => {
		expect(parseCsv("", ",", 10)).toEqual({ rows: [], truncated: false, warnings: [] });
	});
});
