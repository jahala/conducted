/**
 * @feature REV-08 CSV preview
 * Owns: showing a CSV or TSV file as a table.
 * Behaviour: ui-map.md 3.2 (previews include CSV) and 7.2 (empty text "Empty CSV").
 * Children: uses parseCsv from csv-parse.ts.
 * Must handle: an empty file, a ragged row (padded for display only), quoted fields with commas
 * and newlines, a header row guess (Our design choice: first row is a header), a very large file
 * (first 5,000 rows with a note), and wide tables (horizontal scroll, sticky first column).
 * Test first: "a,b\n1,2" renders a header row a, b and one body row 1, 2.
 */
import { notImplemented } from "@conducted/shared";

export interface CsvPreviewProps {
	text: string;
	delimiter: "," | "\t";
}

export function CsvPreview(_props: CsvPreviewProps): never {
	return notImplemented("REV-08");
}
