import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StackEntryView } from "../../../core/model.ts";
import "../../../test/dom-polyfills.ts";
import { StackView } from "./StackView.tsx";

afterEach(cleanup);

const entry = (over: Partial<StackEntryView> = {}): StackEntryView => ({
	number: 1,
	title: "Add the parser",
	branch: "feature/parser",
	state: "open",
	isCurrent: false,
	needsRestack: false,
	...over,
});

const entries: StackEntryView[] = [
	entry({ number: 11, title: "Add the parser", branch: "feature/parser" }),
	entry({ number: 12, title: "Use the parser", branch: "feature/use-parser", isCurrent: true }),
	entry({ number: 13, title: "Document the parser", branch: "feature/docs", state: "draft" }),
];

describe("PR-08 Stack view", () => {
	it("renders three entries from trunk up with the current one marked and the trunk first", () => {
		render(<StackView trunk="main" entries={entries} onCheckout={vi.fn()} onMarkReady={vi.fn()} />);

		const list = screen.getByRole("list");
		expect(within(list).getAllByRole("listitem")[0]?.dataset.testid).toBe("stack-trunk");
		expect(within(list).getByTestId("stack-trunk").textContent).toContain("main");
		expect(within(list).getByTestId("stack-trunk").textContent).toContain("(trunk)");

		const rows = screen.getAllByTestId("stack-entry");
		expect(rows).toHaveLength(3);
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining("#11 Add the parser"),
			expect.stringContaining("#12 Use the parser"),
			expect.stringContaining("#13 Document the parser"),
		]);
		const current = rows[1];
		expect(current?.dataset.current).toBe("true");
		expect(current?.textContent).toContain("Current");
		expect(rows[0]?.dataset.current).toBeUndefined();
		expect(rows[2]?.dataset.current).toBeUndefined();
	});

	it("checks out another stack branch and marks a draft ready for review", () => {
		const onCheckout = vi.fn();
		const onMarkReady = vi.fn();
		render(
			<StackView
				trunk="main"
				entries={entries}
				onCheckout={onCheckout}
				onMarkReady={onMarkReady}
			/>,
		);

		const rows = screen.getAllByTestId("stack-entry");
		const first = rows[0];
		if (first === undefined) throw new Error("missing first stack entry");
		fireEvent.click(within(first).getByRole("button", { name: "Checkout this branch" }));
		expect(onCheckout).toHaveBeenCalledWith("feature/parser");

		const third = rows[2];
		if (third === undefined) throw new Error("missing third stack entry");
		fireEvent.click(within(third).getByRole("button", { name: "Ready for review" }));
		expect(onMarkReady).toHaveBeenCalledWith(13);
	});

	it("shows the gt restack hint and does not offer to run it", () => {
		render(
			<StackView
				trunk="main"
				entries={[entry({ number: 21, branch: "feature/a", needsRestack: true })]}
				onCheckout={vi.fn()}
				onMarkReady={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("stack-restack").textContent).toBe("gt restack");
		expect(screen.queryByRole("button", { name: /restack/i })).toBeNull();
	});

	it("draws nothing when the pull request is not in a stack", () => {
		const { container } = render(
			<StackView trunk="main" entries={[]} onCheckout={vi.fn()} onMarkReady={vi.fn()} />,
		);
		expect(container.firstChild).toBeNull();
	});
});
