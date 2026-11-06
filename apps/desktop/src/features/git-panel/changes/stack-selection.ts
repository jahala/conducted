/**
 * @feature PR-08 Choosing stack pull requests for the range view
 * Owns: how clicks in the stack view change the chosen pull requests, which pull requests show as
 * chosen for a diff scope, and the diff scope a choice stands for.
 * Behaviour: services-map.md 3.4.1 (view mode `range`, a PR or stack range). The research does not
 * describe the clicks; Conductor's stack rail does (`yPs`, `xPs`, `wPs`): a click chooses one pull
 * request, Shift-click chooses the block from the anchor to the clicked one, Cmd-click adds or
 * removes one, and choosing only the checked-out pull request is the branch's own changes.
 * Must handle: a Shift-click with no anchor (the first chosen pull request is the anchor), a
 * Cmd-click that would leave nothing chosen (the clicked one stays chosen), a range scope naming
 * none of the stack's pull requests (the current one shows as chosen), and a stack with no
 * checked-out pull request.
 * Our design choice: only the branch scope shows the current pull request as chosen. Conductor
 * hides its stack rail for the other scopes; this stack view stays visible, so it marks nothing.
 * Test first: a Shift-click chooses every pull request between the anchor and the clicked one.
 */
import type { DiffScope } from "../../../core/api.ts";

export type StackSelectModifier = "none" | "toggle" | "range";

export function selectModifierOf(event: {
	shiftKey: boolean;
	metaKey: boolean;
}): StackSelectModifier {
	if (event.shiftKey) return "range";
	return event.metaKey ? "toggle" : "none";
}

export interface StackSelectionInput {
	/** The stack's open pull requests, from trunk up. */
	prNumbers: readonly number[];
	selected: readonly number[];
	anchor: number | undefined;
	clicked: number;
	modifier: StackSelectModifier;
}

export function nextStackSelection(input: StackSelectionInput): {
	selected: number[];
	anchor: number;
} {
	const { prNumbers, selected, anchor, clicked } = input;
	switch (input.modifier) {
		case "none":
			return { selected: [clicked], anchor: clicked };
		case "toggle": {
			const chosen = new Set(selected);
			if (!chosen.delete(clicked)) chosen.add(clicked);
			if (chosen.size === 0) return { selected: [clicked], anchor: clicked };
			return { selected: prNumbers.filter((number) => chosen.has(number)), anchor: clicked };
		}
		case "range": {
			const start = [anchor, selected[0]].find(
				(number): number is number => number !== undefined && prNumbers.includes(number),
			);
			if (start === undefined) return { selected: [clicked], anchor: clicked };
			const from = prNumbers.indexOf(start);
			const to = prNumbers.indexOf(clicked);
			return {
				selected: prNumbers.slice(Math.min(from, to), Math.max(from, to) + 1),
				anchor: start,
			};
		}
	}
}

/** The pull requests the stack view shows as chosen for this scope, in the stack's order. */
export function selectedStackPrNumbers(
	scope: DiffScope,
	prNumbers: readonly number[],
	currentPrNumber: number | null,
): number[] {
	const current = currentPrNumber === null ? [] : [currentPrNumber];
	if (scope.kind === "branch") return current;
	if (scope.kind !== "range") return [];
	const chosen = prNumbers.filter((number) => scope.prNumbers.includes(number));
	return chosen.length > 0 ? chosen : current;
}

/** The diff scope a choice stands for: only the checked-out pull request is the branch scope. */
export function scopeForStackSelection(
	selected: readonly number[],
	currentPrNumber: number | null,
): DiffScope {
	if (selected.length === 1 && selected[0] === currentPrNumber) return { kind: "branch" };
	return { kind: "range", prNumbers: [...selected] };
}
