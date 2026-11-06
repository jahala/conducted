import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrActivityEntry } from "../../core/model.ts";
import { PrActivityItem } from "./PrActivityItem.tsx";

afterEach(cleanup);

describe("PR-07 PrActivityItem", () => {
	it("renders the author and the state of a changes_requested review", () => {
		const entry: PrActivityEntry = {
			kind: "review",
			id: "review-1",
			at: 1_700_000_000_000,
			authorLogin: "octocat",
			authorAvatarUrl: null,
			state: "changes_requested",
			body: "This needs a test.",
		};
		render(<PrActivityItem entry={entry} onOpen={vi.fn()} />);

		expect(screen.getByText("octocat")).toBeTruthy();
		expect(screen.getByText("Changes requested")).toBeTruthy();
		expect(screen.getByText("This needs a test.")).toBeTruthy();
	});

	it("shows a bare approval as one line without a body card", () => {
		const entry: PrActivityEntry = {
			kind: "review",
			id: "review-2",
			at: 1_700_000_000_000,
			authorLogin: "hubot",
			authorAvatarUrl: null,
			state: "approved",
			body: "",
		};
		render(<PrActivityItem entry={entry} onOpen={vi.fn()} />);

		expect(screen.getByText("hubot")).toBeTruthy();
		expect(screen.getByText("Approved")).toBeTruthy();
	});
});
