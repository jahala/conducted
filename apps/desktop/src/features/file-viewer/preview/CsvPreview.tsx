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
// biome-ignore-all lint/suspicious/noArrayIndexKey: the row and column order is the file's order.
import { useMemo } from "react";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../ui/Table.tsx";
import { parseCsv } from "./csv-parse.ts";

export const CSV_ROW_LIMIT = 5_000;

export interface CsvPreviewProps {
	text: string;
	delimiter: "," | "\t";
}

export function CsvPreview({ text, delimiter }: CsvPreviewProps) {
	const parsed = useMemo(() => parseCsv(text, delimiter, CSV_ROW_LIMIT + 1), [text, delimiter]);
	if (parsed.rows.length === 0) {
		return <EmptyState title="Empty CSV" body="This file has no rows to show." compact />;
	}
	const header = parsed.rows[0] ?? [];
	const body = parsed.rows.slice(1, CSV_ROW_LIMIT);
	const columns = Math.max(header.length, ...parsed.rows.map((row) => row.length));
	const cellAt = (row: readonly string[], column: number): string => row[column] ?? "";
	const truncated = parsed.truncated || parsed.rows.length > CSV_ROW_LIMIT;

	return (
		<div className="flex h-full flex-col gap-2 overflow-hidden p-3">
			<div className="min-h-0 flex-1 overflow-auto">
				<Table>
					<TableHeader>
						<TableRow>
							{Array.from({ length: columns }, (_, column) => (
								<TableHead
									key={`header-${column}`}
									className={column === 0 ? "sticky left-0 bg-surface" : undefined}
								>
									{cellAt(header, column)}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{body.map((row, rowIndex) => (
							<TableRow key={`row-${rowIndex}`}>
								{Array.from({ length: columns }, (_, column) => (
									<TableCell
										key={`cell-${rowIndex}-${column}`}
										className={
											column === 0
												? "sticky left-0 bg-canvas font-mono text-code"
												: "font-mono text-code"
										}
									>
										{cellAt(row, column)}
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			{truncated ? (
				<p role="note" className="text-xs text-fg-muted">
					Showing the first 5,000 rows.
				</p>
			) : null}
			{parsed.warnings.map((warning) => (
				<p key={warning} role="note" className="text-xs text-fg-muted">
					{warning}
				</p>
			))}
		</div>
	);
}
