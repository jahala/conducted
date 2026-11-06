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
	mergeStateStatus: "CLEAN",
	headSha: "head",
	baseSha: "base",
	...over,
});

/** No pull request chosen for the range view. */
const unchosen = { selectedPrNumbers: [], onSelectPr: () => {} };

const entries: StackEntryView[] = [
	entry({ number: 11, title: "Add the parser", branch: "feature/parser" }),
	entry({ number: 12, title: "Use the parser", branch: "feature/use-parser", isCurrent: true }),
	entry({ number: 13, title: "Document the parser", branch: "feature/docs", state: "draft" }),
];

describe("PR-08 Stack view", () => {
	it("renders three entries from trunk up with the current one marked and the trunk first", () => {
		render(
			<StackView
				trunk="main"
				entries={entries}
				onCheckout={vi.fn()}
				onMarkReady={vi.fn()}
				{...unchosen}
			/>,
		);

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
				{...unchosen}
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
				{...unchosen}
				trunk="main"
				entries={[entry({ number: 21, branch: "feature/a", needsRestack: true })]}
				onCheckout={vi.fn()}
				onMarkReady={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("stack-restack").textContent).toBe("gt restack");
		expect(screen.queryByRole("button", { name: /restack/i })).toBeNull();
	});

	it("asks before switching while an agent is working", () => {
		const onCheckout = vi.fn();
		render(
			<StackView
				{...unchosen}
				trunk="main"
				entries={entries}
				onCheckout={onCheckout}
				onMarkReady={vi.fn()}
				agentRunning
			/>,
		);

		const first = screen.getAllByTestId("stack-entry")[0];
		if (first === undefined) throw new Error("missing first stack entry");
		fireEvent.click(within(first).getByRole("button", { name: "Checkout this branch" }));
		expect(onCheckout).not.toHaveBeenCalled();
		expect(screen.getByText("Switch branch?")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Switch anyway" }));
		expect(onCheckout).toHaveBeenCalledWith("feature/parser");
	});

	it("labels each entry with its readiness and says the stack cannot merge yet", () => {
		render(
			<StackView
				{...unchosen}
				trunk="main"
				entries={[
					entry({ number: 11, headSha: "a1", baseSha: "m0", mergeStateStatus: "BLOCKED" }),
					entry({ number: 12, headSha: "b1", baseSha: "a1", isCurrent: true }),
				]}
				onCheckout={vi.fn()}
				onMarkReady={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("stack-verdict").textContent).toBe("Can't merge this stack yet");
		const rows = screen.getAllByTestId("stack-entry");
		expect(within(rows[0] as HTMLElement).getByTestId("stack-entry-status").textContent).toBe(
			"Not ready",
		);
		expect(within(rows[1] as HTMLElement).getByTestId("stack-entry-status").textContent).toBe(
			"Blocked downstack",
		);
	});

	it("says a ready stack can merge", () => {
		render(
			<StackView
				{...unchosen}
				trunk="main"
				entries={[
					entry({ number: 11, headSha: "a1", baseSha: "m0" }),
					entry({ number: 12, headSha: "b1", baseSha: "a1" }),
				]}
				onCheckout={vi.fn()}
				onMarkReady={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("stack-verdict").textContent).toBe("Ready to merge");
		expect(screen.getAllByTestId("stack-entry-status").map((status) => status.textContent)).toEqual(
			["Ready to merge", "Ready to merge"],
		);
	});

	it("shows no verdict while GitHub's readiness is unknown", () => {
		render(
			<StackView
				{...unchosen}
				trunk="main"
				entries={[entry({ number: 11, mergeStateStatus: null })]}
				onCheckout={vi.fn()}
				onMarkReady={vi.fn()}
			/>,
		);

		expect(screen.queryByTestId("stack-verdict")).toBeNull();
		expect(screen.getByTestId("stack-entry-status").textContent).toBe("Open");
	});

	it("draws nothing when the pull request is not in a stack", () => {
		const { container } = render(
			<StackView
				trunk="main"
				entries={[]}
				onCheckout={vi.fn()}
				onMarkReady={vi.fn()}
				{...unchosen}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("chooses a pull request for the range view with a click, Shift-click or Cmd-click", () => {
		const onSelectPr = vi.fn();
		render(
			<StackView
				trunk="main"
				entries={[entry({ number: 10, title: "Merged first", state: "merged" }), ...entries]}
				onCheckout={vi.fn()}
				onMarkReady={vi.fn()}
				selectedPrNumbers={[12]}
				onSelectPr={onSelectPr}
			/>,
		);

		const chosen = screen.getByRole("button", { name: "#12 Use the parser" });
		expect(chosen.getAttribute("aria-pressed")).toBe("true");
		const other = screen.getByRole("button", { name: "#11 Add the parser" });
		expect(other.getAttribute("aria-pressed")).toBe("false");
		// A merged pull request has no range of its own to show.
		expect(screen.queryByRole("button", { name: "#10 Merged first" })).toBeNull();

		fireEvent.click(other);
		fireEvent.click(screen.getByRole("button", { name: "#13 Document the parser" }), {
			shiftKey: true,
		});
		fireEvent.click(other, { metaKey: true });
		expect(onSelectPr.mock.calls).toEqual([
			[11, "none"],
			[13, "range"],
			[11, "toggle"],
		]);
	});
});
