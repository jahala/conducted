import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewerView } from "../../../core/model.ts";
import { ReviewersList } from "./ReviewersList.tsx";

afterEach(cleanup);

const reviewer = (login: string, state: ReviewerView["state"]): ReviewerView => ({
	login,
	avatarUrl: null,
	state,
});

describe("PR-04 reviewers list", () => {
	it("renders an approved and an awaiting reviewer and says review is required", () => {
		render(
			<ReviewersList
				reviewers={[reviewer("ada", "approved"), reviewer("grace", "awaiting")]}
				reviewDecision="review_required"
				canRequestReview
				onRequestReview={vi.fn()}
			/>,
		);
		expect(screen.getByText("ada")).toBeTruthy();
		expect(screen.getByText("Approved")).toBeTruthy();
		expect(screen.getByText("grace")).toBeTruthy();
		expect(screen.getByText("Awaiting review")).toBeTruthy();
		expect(screen.getByText("Review required")).toBeTruthy();
	});

	it("says when no reviewers were requested", () => {
		render(
			<ReviewersList
				reviewers={[]}
				reviewDecision={null}
				canRequestReview={false}
				onRequestReview={vi.fn()}
			/>,
		);
		expect(screen.getByText("No reviewers requested.")).toBeTruthy();
	});
});
