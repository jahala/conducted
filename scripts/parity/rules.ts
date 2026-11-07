/**
 * Named rules the seeder uses to write decisions into the parity map. A rule names its decision and
 * matches on what an entry is for, never on one odd string; a one-off decision is written by hand in
 * the map instead.
 * Behaviour: docs/plans/parity-harness.md section 2.
 * Must handle: an entry two rules match takes the first, so the order below is the precedence.
 */
import type { Inventory, SpecEntry } from "./lib.ts";

export interface Rule {
	name: string;
	decision: string;
	note: string;
	applies(entry: SpecEntry, inventory: Inventory, context: RuleContext): boolean;
}

export interface RuleContext {
	/** The names of the places our own gazetteer lists (core/services/place-gazetteer.ts). */
	places: Set<string>;
}

export const RULES: Rule[] = [
	{
		name: "place-name",
		decision: "D086",
		note: "A city name both apps can give a workspace. It is sample data, not wording; our list is our own (D002).",
		applies: (entry, inventory, context) =>
			inventory === "literal" && context.places.has(entry.text),
	},
];

export function ruleFor(
	entry: SpecEntry,
	inventory: Inventory,
	context: RuleContext,
): Rule | undefined {
	return RULES.find((rule) => rule.applies(entry, inventory, context));
}
