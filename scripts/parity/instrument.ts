/**
 * The instrument check: the parity report of the commit before #345 (29e65165) must hold the three
 * misses the owner found there by eye. Until it does, no result of the harness is trusted.
 * Behaviour: docs/plans/parity-harness.md section 4.
 * Must handle: each miss is looked for by what it is (the finding's check, code, state and text),
 * so a report that finds it under another name does not pass; the result names every miss found or
 * not found, and exits 1 when any is not found.
 *
 * Usage: bun scripts/parity/instrument.ts <report.json>
 */
import type { Finding } from "./checks.ts";
import { readJson } from "./lib.ts";
import type { Report } from "./report.ts";

export const BEFORE_345 = "29e65165e39c1d389b99621b3f6b1c048b38950a";
/** Conductor's placeholder for a chat's composer (renderApp @9294579). */
export const CONDUCTOR_COMPOSER_PLACEHOLDER = "Ask to make changes, @mention files, run /commands";

export interface KnownMiss {
	name: string;
	/** Every part must be found. */
	parts: { what: string; holds(finding: Finding): boolean }[];
}

export const KNOWN_MISSES: KnownMiss[] = [
	{
		name: 'The sidebar footer\'s "Add a project" button',
		parts: [
			{
				what: 'an ours-only "Add a project" control in state sidebar',
				holds: (f) =>
					f.check === "b" &&
					f.code === "ours-only" &&
					f.state === "sidebar" &&
					f.text === "Add a project",
			},
		],
	},
	{
		name: 'The composer\'s "Write something ..." placeholder',
		parts: [
			{
				what: 'an ours-only "Write something ..." in state composer-empty',
				holds: (f) =>
					f.check === "b" &&
					f.code === "ours-only" &&
					f.state === "composer-empty" &&
					f.text === "Write something ...",
			},
			{
				what: "Conductor's composer placeholder missing from its state",
				holds: (f) =>
					f.check === "b" &&
					f.code === "missing-in-state" &&
					f.text === CONDUCTOR_COMPOSER_PLACEHOLDER,
			},
		],
	},
	{
		name: "Tool calls drawn as boxed cards",
		parts: [
			{
				what: "the tool-call row's layout off Conductor's",
				holds: (f) => f.check === "c" && f.code === "layout-off" && f.id === "tool-call-row",
			},
		],
	},
];

export function instrument(findings: Finding[]): { found: string[]; missing: string[] } {
	const found: string[] = [];
	const missing: string[] = [];
	for (const miss of KNOWN_MISSES) {
		for (const part of miss.parts) {
			const hit = findings.find((finding) => part.holds(finding));
			if (hit === undefined) missing.push(`${miss.name}: ${part.what}`);
			else found.push(`${miss.name}: ${part.what} (${hit.detail})`);
		}
	}
	return { found, missing };
}

if (import.meta.main) {
	const path = process.argv[2];
	if (path === undefined) {
		console.error("Usage: bun scripts/parity/instrument.ts <report.json>");
		process.exit(1);
	}
	const report = readJson<Report>(path);
	const result = instrument(report.findings);
	console.log(`Instrument check on ${report.commit}:`);
	for (const line of result.found) console.log(`found     ${line}`);
	for (const line of result.missing) console.log(`NOT FOUND ${line}`);
	process.exit(result.missing.length === 0 ? 0 : 1);
}
