/**
 * @feature REV-08 CSV preview
 * Tests the table, the empty state and the truncation note.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CsvPreview } from "./CsvPreview.tsx";

afterEach(cleanup);

describe("REV-08 CsvPreview", () => {
	it("renders the first row as headers and the next as one body row", () => {
		render(<CsvPreview text={"a,b\n1,2"} delimiter="," />);
		expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["a", "b"]);
		expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["1", "2"]);
	});

	it("says Empty CSV for a file with no rows", () => {
		render(<CsvPreview text="" delimiter="," />);
		expect(screen.getByText("Empty CSV")).toBeTruthy();
	});

	it("pads a ragged row so the table keeps its columns", () => {
		render(<CsvPreview text={"a,b\n1"} delimiter="," />);
		expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["1", ""]);
	});

	it("notes when it shows only the first 5,000 rows", () => {
		const rows = ["a", ...Array.from({ length: 5_010 }, (_, index) => String(index))];
		render(<CsvPreview text={rows.join("\n")} delimiter="," />);
		expect(screen.getByRole("note").textContent).toContain("first 5,000 rows");
	});
});
