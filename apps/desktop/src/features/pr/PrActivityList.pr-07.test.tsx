import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrActivityEntry } from "../../core/model.ts";
import { PrActivityList } from "./PrActivityList.tsx";

afterEach(cleanup);

const commit = (id: string, at: number, subject: string): PrActivityEntry => ({
	kind: "commit",
	id,
	at,
	sha: `${id}0000000`,
	subject,
	authorName: "Ada",
});

describe("PR-07 PrActivityList", () => {
	it("renders three items newest first when the order is newest-first", () => {
		const entries = [
			commit("old", 1_000, "Oldest change"),
			commit("new", 3_000, "Newest change"),
			commit("mid", 2_000, "Middle change"),
		];
		render(<PrActivityList entries={entries} order="newest-first" onOpenEntry={vi.fn()} />);

		const rows = screen.getAllByRole("button");
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining("Newest change"),
			expect.stringContaining("Middle change"),
			expect.stringContaining("Oldest change"),
		]);
	});

	it("shows commits and comments together, as Conductor's list does (D078)", () => {
		const entries: PrActivityEntry[] = [
			commit("c", 4_000, "Add the activity list"),
			{
				kind: "comment",
				id: "r",
				at: 3_000,
				authorLogin: "octocat",
				authorAvatarUrl: null,
				body: "Please add a test.",
				filePath: null,
				line: null,
				commentId: "comment-0",
			},
			{
				kind: "comment",
				id: "m",
				at: 2_000,
				authorLogin: "hubot",
				authorAvatarUrl: null,
				body: "Looks good now.",
				filePath: "src/app.ts",
				line: 12,
				commentId: "comment-1",
			},
			commit("s", 1_000, "Mark the pull request ready"),
		];
		render(<PrActivityList entries={entries} order="newest-first" onOpenEntry={vi.fn()} />);

		expect(screen.getByText("Add the activity list")).toBeTruthy();
		expect(screen.getByText("Please add a test.")).toBeTruthy();
		expect(screen.getByText("Looks good now.")).toBeTruthy();
		expect(screen.getByText("src/app.ts:12")).toBeTruthy();
		expect(screen.getByText("Mark the pull request ready")).toBeTruthy();
	});

	it("lists an entry with no usable time last, with no time shown", () => {
		const entries = [
			commit("undated", Number.NaN, "Undated change"),
			commit("dated", 2_000, "Dated"),
		];
		render(<PrActivityList entries={entries} order="newest-first" onOpenEntry={vi.fn()} />);

		const rows = screen.getAllByRole("button");
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining("Dated"),
			expect.stringContaining("Undated change"),
		]);
		expect(rows[1]?.querySelector("time")).toBeNull();
		expect(rows[0]?.querySelector("time")).not.toBeNull();
	});

	it("says when there is no activity", () => {
		render(<PrActivityList entries={[]} order="newest-first" onOpenEntry={vi.fn()} />);
		expect(screen.getByText("No activity yet.")).toBeTruthy();
	});
});
