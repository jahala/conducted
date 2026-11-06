/**
 * @feature PR-08 Graphite stack list in the Changes tab
 * Owns: tests for the read-only Graphite list: its order and marks, the restack hint, the one
 * checkout control and when it is offered, and the current branch's files under its row.
 * Behaviour: ui-map.md 3.6 ("(trunk)", "gt restack", "Checkout this branch", "Ready for review");
 * services-map.md 3.8.1 and 5B.1.8 (read-only plus `gt checkout`).
 * Test first: four branches render top first with the trunk last and the current one marked.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "../../../core/api.ts";
import type { GraphiteBranch } from "../../../core/services/graphite.ts";
import { GraphiteStackView, type GraphiteStackViewProps } from "./GraphiteStackView.tsx";

afterEach(cleanup);

const branch = (
	name: string,
	parentBranch: string | null,
	extra: Partial<GraphiteBranch> = {},
): GraphiteBranch => ({ name, trunk: false, needsRestack: false, parentBranch, ...extra });

const branches: GraphiteBranch[] = [
	branch("feat-c", "feat-b", { needsRestack: true }),
	branch("feat-b", "feat-a"),
	branch("feat-a", "main"),
	branch("main", null, { trunk: true }),
];

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({
	path,
	status: "modified",
	linesAdded: 1,
	linesRemoved: 0,
	binary: false,
	conflicted: false,
	viewed: false,
	...over,
});

function renderView(over: Partial<GraphiteStackViewProps> = {}) {
	const props: GraphiteStackViewProps = {
		branches,
		currentBranch: "feat-b",
		files: [],
		selectedPath: null,
		onOpenFile: vi.fn(),
		checkingOut: null,
		onCheckout: vi.fn(),
		...over,
	};
	render(<GraphiteStackView {...props} />);
	return props;
}

const rows = () => screen.getAllByTestId("graphite-branch");

describe("PR-08 Graphite stack list", () => {
	it("lists the branches top first, the trunk last, and marks the current one", () => {
		renderView();

		expect(rows().map((row) => row.dataset.branch)).toEqual(["feat-c", "feat-b", "feat-a", "main"]);
		expect(rows()[1]?.getAttribute("aria-current")).toBe("true");
		expect(rows().filter((row) => row.getAttribute("aria-current") === "true")).toHaveLength(1);
		expect(rows()[3]?.textContent).toContain("(trunk)");
		expect(rows()[0]?.textContent).not.toContain("(trunk)");
	});

	it("hints at gt restack only on a branch that needs it", () => {
		renderView();

		const hint = "This branch needs to be restacked. Use gt restack";
		expect(within(rows()[0] as HTMLElement).getByLabelText(hint)).toBeTruthy();
		expect(within(rows()[1] as HTMLElement).queryByLabelText(hint)).toBeNull();
	});

	it("offers Checkout this branch on every branch but the current one and the trunk", () => {
		const props = renderView();

		const offered = rows().map(
			(row) => within(row).queryByRole("button", { name: "Checkout this branch" }) !== null,
		);
		expect(offered).toEqual([true, false, true, false]);

		fireEvent.click(
			within(rows()[2] as HTMLElement).getByRole("button", { name: "Checkout this branch" }),
		);
		expect(props.onCheckout).toHaveBeenCalledWith("feat-a");
	});

	it("holds every checkout while one runs and shows which", () => {
		const props = renderView({ checkingOut: "feat-c" });

		const buttons = screen.getAllByRole("button", { name: "Checkout this branch" });
		expect(buttons).toHaveLength(2);
		expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
		expect(within(rows()[0] as HTMLElement).getByRole("status")).toBeTruthy();
		fireEvent.click(buttons[1] as HTMLElement);
		expect(props.onCheckout).not.toHaveBeenCalled();
	});

	it("lists the current branch's files under its row and opens one on click", () => {
		const props = renderView({ files: [file("src/b.ts"), file("src/a.ts")] });

		const current = rows()[1] as HTMLElement;
		const opens = within(current).getAllByRole("button", { name: /^Open / });
		expect(opens.map((button) => button.getAttribute("aria-label"))).toEqual([
			"Open src/a.ts",
			"Open src/b.ts",
		]);
		expect(within(rows()[0] as HTMLElement).queryByRole("button", { name: /^Open / })).toBeNull();
		expect(screen.queryByText("Ready for review")).toBeNull();

		fireEvent.click(opens[1] as HTMLElement);
		expect(props.onOpenFile).toHaveBeenCalledWith("src/b.ts");
	});

	it("groups the files into Conflicts, Ready for review and Viewed once one is viewed", () => {
		renderView({
			files: [
				file("src/seen.ts", { viewed: true }),
				file("src/new.ts"),
				file("src/clash.ts", { conflicted: true }),
			],
		});

		const current = rows()[1] as HTMLElement;
		const groups = within(current).getAllByRole("rowgroup");
		expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
			"Conflicts",
			"Ready for review",
			"Viewed",
		]);
		expect(groups.map((group) => group.firstElementChild?.textContent)).toEqual([
			"Conflicts",
			"Ready for review",
			"Viewed",
		]);
		const names = within(current)
			.getAllByRole("button", { name: /^Open / })
			.map((button) => button.getAttribute("aria-label"));
		expect(names).toEqual(["Open src/clash.ts", "Open src/new.ts", "Open src/seen.ts"]);
	});
});
