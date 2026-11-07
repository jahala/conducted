import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrActivityEntry } from "../../core/model.ts";
import { PrActivityItem } from "./PrActivityItem.tsx";

afterEach(cleanup);

describe("PR-07 PrActivityItem", () => {
	it("renders a review thread comment's author, file and line, and body", () => {
		const entry: PrActivityEntry = {
			kind: "comment",
			id: "comment-1",
			at: 1_700_000_000_000,
			authorLogin: "octocat",
			authorAvatarUrl: null,
			body: "This needs a test.",
			filePath: "src/app.ts",
			line: 12,
			commentId: "comment-1",
		};
		render(<PrActivityItem entry={entry} onOpen={vi.fn()} />);

		expect(screen.getByText("octocat")).toBeTruthy();
		expect(screen.getByText("src/app.ts:12")).toBeTruthy();
		expect(screen.getByText("This needs a test.")).toBeTruthy();
	});

	it("shows a commit as its subject, short sha and author", () => {
		const entry: PrActivityEntry = {
			kind: "commit",
			id: "commit:abcdef1234",
			at: 1_700_000_000_000,
			sha: "abcdef1234",
			subject: "Add the activity list",
			authorName: "Ada",
		};
		render(<PrActivityItem entry={entry} onOpen={vi.fn()} />);

		expect(screen.getByText("Add the activity list")).toBeTruthy();
		expect(screen.getByText("abcdef1")).toBeTruthy();
	});
});
