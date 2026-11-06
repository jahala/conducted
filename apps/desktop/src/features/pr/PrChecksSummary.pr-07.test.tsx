import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckRun, CheckState } from "../../core/model.ts";
import { PrChecksSummary } from "./PrChecksSummary.tsx";

afterEach(cleanup);

const check = (name: string, state: CheckState): CheckRun => ({
	name,
	state,
	url: null,
	startedAt: null,
	completedAt: null,
	required: true,
});

describe("PR-07 PrChecksSummary", () => {
	it("shows two failed and both failing names next to one passing check", () => {
		render(
			<PrChecksSummary
				checks={[check("build", "failure"), check("lint", "failure"), check("test", "success")]}
				onShowDetails={vi.fn()}
			/>,
		);

		expect(screen.getByText("2 failed")).toBeTruthy();
		expect(screen.getByText("build")).toBeTruthy();
		expect(screen.getByText("lint")).toBeTruthy();
		expect(screen.getByText("1 passed")).toBeTruthy();
	});

	it("opens the full checks list from its link", () => {
		const onShowDetails = vi.fn();
		render(<PrChecksSummary checks={[]} onShowDetails={onShowDetails} />);

		expect(screen.getByText("No checks reported.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "View checks" }));
		expect(onShowDetails).toHaveBeenCalledTimes(1);
	});
});
