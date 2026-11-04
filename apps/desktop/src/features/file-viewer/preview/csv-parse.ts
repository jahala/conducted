/**
 * @feature REV-08 CSV parser
 * Owns: a pure parser from CSV text to rows of cells, with a row cap.
 * Behaviour: ui-map.md 3.2 (CSV preview).
 * Must handle: quoted fields, doubled quotes inside quotes, newlines inside quotes, CRLF and LF,
 * a trailing newline (no empty last row), an unterminated quote (the rest is one cell, reported
 * in `warnings`), and the row cap (truncated is true when rows were dropped).
 * Test first: 'a,"b,c"\n1,2' parses to [["a", "b,c"], ["1", "2"]].
 */
import { notImplemented } from "@conducted/shared";

export interface ParsedCsv {
	rows: string[][];
	truncated: boolean;
	warnings: string[];
}

export function parseCsv(_text: string, _delimiter: "," | "\t", _maxRows: number): ParsedCsv {
	return notImplemented("REV-08");
}
