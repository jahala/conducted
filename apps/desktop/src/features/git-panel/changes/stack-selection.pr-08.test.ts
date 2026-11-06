/**
 * @feature PR-08 Choosing stack pull requests for the range view
 * Owns: tests that a click, a Shift-click and a Cmd-click change the chosen pull requests as in
 * Conductor, that the chosen ones follow the diff scope, and that the choice becomes a scope.
 * Behaviour: services-map.md 3.4.1 (view mode `range`); Conductor's stack rail (`yPs`, `xPs`,
 * `wPs`).
 * Test first: a Shift-click chooses every pull request between the anchor and the clicked one.
 */
import { describe, expect, it } from "vitest";
import {
	nextStackSelection,
	scopeForStackSelection,
	selectedStackPrNumbers,
	selectModifierOf,
} from "./stack-selection.ts";

const prNumbers = [10, 11, 12, 13];

describe("PR-08 stack selection", () => {
	it("chooses only the clicked pull request on a plain click", () => {
		expect(
			nextStackSelection({
				prNumbers,
				selected: [10, 11],
				anchor: 10,
				clicked: 12,
				modifier: "none",
			}),
		).toEqual({ selected: [12], anchor: 12 });
	});

	it("chooses every pull request between the anchor and the clicked one on a Shift-click", () => {
		expect(
			nextStackSelection({ prNumbers, selected: [11], anchor: 11, clicked: 13, modifier: "range" }),
		).toEqual({ selected: [11, 12, 13], anchor: 11 });
		// Without an anchor, the first chosen pull request is the anchor.
		expect(
			nextStackSelection({
				prNumbers,
				selected: [12],
				anchor: undefined,
				clicked: 10,
				modifier: "range",
			}),
		).toEqual({ selected: [10, 11, 12], anchor: 12 });
	});

	it("adds or removes the clicked pull request on a Cmd-click, never leaving nothing chosen", () => {
		expect(
			nextStackSelection({
				prNumbers,
				selected: [10],
				anchor: 10,
				clicked: 12,
				modifier: "toggle",
			}),
		).toEqual({ selected: [10, 12], anchor: 12 });
		expect(
			nextStackSelection({
				prNumbers,
				selected: [10, 12],
				anchor: 12,
				clicked: 10,
				modifier: "toggle",
			}),
		).toEqual({ selected: [12], anchor: 10 });
		expect(
			nextStackSelection({
				prNumbers,
				selected: [12],
				anchor: 12,
				clicked: 12,
				modifier: "toggle",
			}),
		).toEqual({ selected: [12], anchor: 12 });
	});

	it("reads the modifier from the click", () => {
		expect(selectModifierOf({ shiftKey: true, metaKey: true })).toBe("range");
		expect(selectModifierOf({ shiftKey: false, metaKey: true })).toBe("toggle");
		expect(selectModifierOf({ shiftKey: false, metaKey: false })).toBe("none");
	});

	it("shows the range's pull requests as chosen, and the current one for the branch scope", () => {
		expect(selectedStackPrNumbers({ kind: "range", prNumbers: [12, 11] }, prNumbers, 11)).toEqual([
			11, 12,
		]);
		expect(selectedStackPrNumbers({ kind: "range", prNumbers: [99] }, prNumbers, 11)).toEqual([11]);
		expect(selectedStackPrNumbers({ kind: "branch" }, prNumbers, 11)).toEqual([11]);
		expect(selectedStackPrNumbers({ kind: "uncommitted" }, prNumbers, 11)).toEqual([]);
		expect(selectedStackPrNumbers({ kind: "branch" }, prNumbers, null)).toEqual([]);
	});

	it("turns the choice into a range scope, or the branch scope when only the current one is chosen", () => {
		expect(scopeForStackSelection([11], 11)).toEqual({ kind: "branch" });
		expect(scopeForStackSelection([10, 11], 11)).toEqual({ kind: "range", prNumbers: [10, 11] });
		expect(scopeForStackSelection([10], null)).toEqual({ kind: "range", prNumbers: [10] });
	});
});
