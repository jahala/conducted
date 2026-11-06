/**
 * @feature REV-08 CSV parser
 * Owns: a pure parser from CSV text to rows of cells, with a row cap.
 * Behaviour: ui-map.md 3.2 (CSV preview).
 * Must handle: quoted fields, doubled quotes inside quotes, newlines inside quotes, CRLF and LF,
 * a trailing newline (no empty last row), an unterminated quote (the rest is one cell, reported
 * in `warnings`), and the row cap (truncated is true when rows were dropped).
 * Test first: 'a,"b,c"\n1,2' parses to [["a", "b,c"], ["1", "2"]].
 */

export interface ParsedCsv {
	rows: string[][];
	truncated: boolean;
	warnings: string[];
}

export function parseCsv(text: string, delimiter: "," | "\t", maxRows: number): ParsedCsv {
	const rows: string[][] = [];
	const warnings: string[] = [];
	const cap = Math.max(0, Math.floor(maxRows));
	let row: string[] = [];
	let cell = "";
	let inQuotes = false;
	let parsedRows = 0;
	let index = 0;

	const endRow = (): void => {
		parsedRows += 1;
		if (rows.length < cap) rows.push(row);
		row = [];
	};

	while (index < text.length) {
		const character = text[index];
		if (inQuotes) {
			if (character === '"') {
				if (text[index + 1] === '"') {
					cell += '"';
					index += 2;
					continue;
				}
				inQuotes = false;
				index += 1;
				continue;
			}
			cell += character;
			index += 1;
			continue;
		}
		if (character === '"') {
			inQuotes = true;
			index += 1;
			continue;
		}
		if (character === delimiter) {
			row.push(cell);
			cell = "";
			index += 1;
			continue;
		}
		if (character === "\r" && text[index + 1] === "\n") {
			row.push(cell);
			cell = "";
			endRow();
			index += 2;
			continue;
		}
		if (character === "\n" || character === "\r") {
			row.push(cell);
			cell = "";
			endRow();
			index += 1;
			continue;
		}
		cell += character;
		index += 1;
	}

	if (inQuotes) warnings.push("The last quoted field is not closed.");
	if (cell.length > 0 || row.length > 0) {
		row.push(cell);
		endRow();
	}

	return { rows, truncated: parsedRows > rows.length, warnings };
}
