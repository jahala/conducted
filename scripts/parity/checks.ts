/**
 * The parity harness's checks, as functions of their data: map completeness (a), text and controls
 * both ways per catalogue state (b), layout (c) and backend lists (e). Reading files and writing the
 * report are the caller's (scripts/parity/check.ts).
 * Behaviour: docs/plans/parity-harness.md section 3.
 * Our design choice: a finding is a `gap` (a difference from Conductor to resolve) or `broken` (the
 * harness or its data is wrong). Only gaps wait for the workflow's enforce mode; broken always fails.
 * Must handle: a state that failed to render is one broken finding, and its entries are not also
 * reported as missing; a state the checked app does not have is a gap per entry; a name of ours that
 * is sample data or a formatted value is never an ours-only gap.
 */
import type { LayoutSpec } from "./dump.ts";
import {
	type BackendInventory,
	type Dump,
	type DumpState,
	type GapClass,
	gapClass,
	type Inventory,
	isUiInventory,
	type MapEntry,
	type MapFile,
	normalise,
	type OursOnly,
	type SpecFile,
	UI_INVENTORIES,
} from "./lib.ts";

export type Check = "a" | "b" | "c" | "d" | "e";

export interface Finding {
	check: Check;
	severity: "gap" | "broken";
	code: string;
	screen: string;
	detail: string;
	inventory?: string;
	id?: string;
	state?: string;
	text?: string;
	/** Check a's gaps: how the gap is closed (docs/plans/parity-harness.md section 2). */
	class?: GapClass;
	/** A gap's backlog row, when the map names one. */
	backlog?: string;
	/** The row's checklist item that owns the gap, when the map names one. */
	item?: string;
}

export interface Inputs {
	specs: Map<Inventory, SpecFile>;
	maps: Map<Inventory, MapFile>;
	decisions: Set<string>;
	/** The rows of docs/plans/backlog.md, each with the texts of its items in docs/plans/items/. */
	items: Map<string, Set<string>>;
	/** Every state the catalogue of the checked app has, or null with no dump (state names go unchecked). */
	states: Set<string> | null;
	oursOnly: OursOnly[];
	strayMaps: string[];
	/** Conductor's wording with values in it (`tests/parity/spec/templates.json`). */
	templates: string[];
	screenFor: (file: string, offset: number | null) => string;
}

const BACKEND_SCREEN = "Backend";

/** Check a: every spec entry is mapped, every map entry is a spec entry, every id it names exists. */
export function checkCompleteness(inputs: Inputs): Finding[] {
	const findings: Finding[] = [];
	for (const stray of inputs.strayMaps) {
		findings.push({
			check: "a",
			severity: "broken",
			code: "stray-map",
			screen: "Harness",
			detail: `tests/parity/map/${stray}.json names no inventory`,
		});
	}
	for (const [inventory, spec] of inputs.specs) {
		const map = inputs.maps.get(inventory) ?? {};
		const ids = new Set(spec.entries.map((entry) => entry.id));
		for (const id of Object.keys(map)) {
			if (!ids.has(id)) {
				findings.push({
					check: "a",
					severity: "broken",
					code: "unknown-id",
					screen: "Harness",
					inventory,
					id,
					detail: `the map names ${id}, which the spec does not have`,
				});
			}
		}
		for (const entry of spec.entries) {
			const mapped = map[entry.id];
			const base = { check: "a" as const, inventory, id: entry.id, text: entry.text };
			if (mapped === undefined) {
				findings.push({
					...base,
					severity: "gap",
					code: "unmapped",
					screen: isUiInventory(inventory)
						? inputs.screenFor(entry.file, entry.offset)
						: BACKEND_SCREEN,
					detail: "no map entry",
				});
				continue;
			}
			findings.push(...entryProblems(inventory, mapped, inputs, base));
		}
	}
	for (const item of inputs.oursOnly) {
		const base = { check: "a" as const, text: item.text, screen: "Harness" };
		if (item.decision === undefined && item.keep === undefined) {
			findings.push({
				...base,
				severity: "broken",
				code: "ours-only-unsupported",
				detail: "an ours-only entry needs a decision id or the owner's keep ruling",
			});
		}
		if (item.decision !== undefined && !inputs.decisions.has(item.decision)) {
			findings.push({
				...base,
				severity: "broken",
				code: "unknown-decision",
				detail: `ours-only names ${item.decision}, which docs/decisions.md does not define`,
			});
		}
		if (item.state !== undefined && inputs.states !== null && !inputs.states.has(item.state)) {
			findings.push({
				...base,
				severity: "broken",
				code: "unknown-state",
				detail: `ours-only names state ${item.state}, which the catalogue does not have`,
			});
		}
	}
	return findings;
}

/** A gap's owner must exist: its row in the backlog, and its item under that row. */
function ownerProblems(
	mapped: Extract<MapEntry, { status: "gap" }>,
	inputs: Inputs,
	base: { check: "a"; inventory: string; id: string; text: string },
): Finding[] {
	if (mapped.backlog === undefined) {
		if (mapped.item === undefined) return [];
		return [
			{
				...base,
				severity: "broken",
				code: "unknown-owner",
				screen: "Harness",
				detail: "the map names an item but no backlog row",
			},
		];
	}
	const texts = inputs.items.get(mapped.backlog);
	if (texts === undefined) {
		return [
			{
				...base,
				severity: "broken",
				code: "unknown-owner",
				screen: "Harness",
				detail: `the map names ${mapped.backlog}, which docs/plans/backlog.md does not define`,
			},
		];
	}
	if (mapped.item !== undefined && !texts.has(mapped.item)) {
		return [
			{
				...base,
				severity: "broken",
				code: "unknown-owner",
				screen: "Harness",
				detail: `the map names an item of ${mapped.backlog} that docs/plans/items/ does not hold: ${mapped.item}`,
			},
		];
	}
	return [];
}

function entryProblems(
	inventory: Inventory,
	mapped: MapEntry,
	inputs: Inputs,
	base: { check: "a"; inventory: string; id: string; text: string },
): Finding[] {
	if (mapped.status === "gap") {
		const gap: Finding = {
			...base,
			severity: "gap",
			code: `gap-${mapped.reason}`,
			screen: mapped.screen,
			class: gapClass(mapped),
			...(mapped.backlog === undefined ? {} : { backlog: mapped.backlog }),
			...(mapped.item === undefined ? {} : { item: mapped.item }),
			detail:
				mapped.note ??
				(mapped.reason === "unshown" ? "no catalogue state shows it" : "not in our UI"),
		};
		return [gap, ...ownerProblems(mapped, inputs, base)];
	}
	if (mapped.status === "decided") {
		if (inputs.decisions.has(mapped.decision)) return [];
		return [
			{
				...base,
				severity: "broken",
				code: "unknown-decision",
				screen: "Harness",
				detail: `the map names ${mapped.decision}, which docs/decisions.md does not define`,
			},
		];
	}
	if (isUiInventory(inventory) && inventory !== "route") {
		const unknown = inputs.states !== null && !inputs.states.has(mapped.state ?? "");
		if (mapped.state === undefined || unknown) {
			return [
				{
					...base,
					severity: "broken",
					code: "unknown-state",
					screen: "Harness",
					detail: `matched to state ${mapped.state ?? "(none)"}, which the catalogue does not have`,
				},
			];
		}
	} else if (mapped.ours === undefined) {
		return [
			{
				...base,
				severity: "broken",
				code: "matched-without-name",
				screen: "Harness",
				detail: "a matched backend or route entry must name ours",
			},
		];
	}
	return [];
}

/** Matched texts of every UI inventory: Conductor wording a state of ours may show. */
export function matchedTexts(inputs: Pick<Inputs, "specs" | "maps">): Set<string> {
	const texts = new Set<string>();
	for (const inventory of UI_INVENTORIES) {
		const spec = inputs.specs.get(inventory);
		const map = inputs.maps.get(inventory) ?? {};
		for (const entry of spec?.entries ?? []) {
			if (map[entry.id]?.status === "matched") texts.add(normalise(entry.text));
		}
	}
	return texts;
}

/** Numbers, sizes, durations, times, counts and the punctuation around them. */
const FORMATTED =
	/[+\-−]?\d+(?:[.,:]\d+)*\s*(?:%|k|K|M|ms|s|m|h|d|w|mo|y|AM|PM|KB|MB|GB|B)?\b|\b(?:now|ago|just now|yesterday|today)\b|[+\-−·•/×()#@,.:;|<>=~*_[\]{}'"`!?&]/g;

/** True when nothing with two letters is left once sample data, matched texts and formatting go. */
export function accountedFor(text: string, removable: string[]): boolean {
	let rest = ` ${text} `;
	for (const piece of removable) {
		if (piece.length < 3) continue;
		const escaped = piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"), " ");
	}
	rest = rest.replace(FORMATTED, " ");
	return !/\p{L}{2,}/u.test(rest);
}

/** Letters and digits only: a value split over several elements still reads as one. */
export const squash = (text: string): string => text.replace(/[^\p{L}\p{N}]/gu, "");

/**
 * An environment variable's name, such as ANTHROPIC_API_KEY: an identifier both apps show as it is,
 * never wording. It needs an underscore, so a capitalised word or "TOKEN" is still read as wording.
 */
const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** A piece this long can be part of a sample value; a shorter one must be all of it. */
const SAMPLE_PIECE = 12;

/**
 * True when the name is a sample value, however the screen split or punctuated it: all of one, or a
 * long piece of one (a path split into folder and file, a line of a sample reply). A short word is
 * never taken as part of a sample sentence, so a label of ours cannot hide inside sample prose.
 */
export function isSample(text: string, squashedSample: string[]): boolean {
	const piece = squash(text);
	if (piece.length < 4) return false;
	return squashedSample.some(
		(sample) => sample === piece || (piece.length >= SAMPLE_PIECE && sample.includes(piece)),
	);
}

/** A Conductor template ("{} tool calls") as a pattern a whole name must match. */
export function templatePattern(template: string): RegExp {
	const parts = normalise(template)
		.split("{}")
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`^${parts.join(".+?")}$`, "u");
}

/** Check b: per state, every matched entry is on screen, and every string of ours is accounted for. */
export function checkText(inputs: Inputs, dump: Dump): Finding[] {
	const findings: Finding[] = [];
	const byId = new Map(dump.states.map((state) => [state.id, state]));
	for (const state of dump.states) {
		if (state.error !== null) {
			findings.push({
				check: "b",
				severity: "broken",
				code: "state-failed",
				screen: state.group,
				state: state.id,
				detail: state.error.split("\n")[0] ?? "failed",
			});
		}
	}
	const seenRoutes = new Set(dump.states.map((state) => routePath(state.route)));
	for (const inventory of UI_INVENTORIES) {
		const spec = inputs.specs.get(inventory);
		const map = inputs.maps.get(inventory) ?? {};
		for (const entry of spec?.entries ?? []) {
			const mapped = map[entry.id];
			if (mapped?.status !== "matched") continue;
			const base = { check: "b" as const, inventory, id: entry.id, text: entry.text };
			if (inventory === "route") {
				if (mapped.ours !== undefined && !seenRoutes.has(mapped.ours)) {
					findings.push({
						...base,
						severity: "gap",
						code: "missing-route",
						screen: "Routes",
						detail: `no catalogue state opens ${mapped.ours}`,
					});
				}
				continue;
			}
			const state = mapped.state === undefined ? undefined : byId.get(mapped.state);
			if (state === undefined) {
				findings.push({
					...base,
					severity: "gap",
					code: "missing-in-state",
					screen: mapped.state ?? "Unplaced",
					state: mapped.state,
					detail: "the checked app's catalogue has no such state",
				});
				continue;
			}
			if (state.error !== null) continue;
			const wanted = normalise(entry.text);
			const testId = inventory === "test_id";
			const present = state.names.some(
				(name) => name.text === wanted && (name.via === "testid") === testId,
			);
			if (!present) {
				findings.push({
					...base,
					severity: "gap",
					code: "missing-in-state",
					screen: state.group,
					state: state.id,
					detail: `not on screen in ${state.id}`,
				});
			}
		}
	}
	findings.push(...oursOnlyGaps(inputs, dump));
	return findings;
}

export function routePath(route: string | null): string {
	return (route ?? "").split("?")[0] ?? "";
}

/**
 * The lines of a multi-line sample value, without Markdown's line marks: a reply's heading or list
 * item, a file's line of code. A line counts when it has two words or code punctuation, so a
 * one-word line (a table cell, "Done") cannot hide a label of ours.
 */
export function sampleLines(sample: string): string[] {
	if (!sample.includes("\n")) return [];
	return sample
		.replace(/\\`/g, "`")
		.replace(/\$\{[^}]*\}/g, "\n")
		.split("\n")
		.map((line) => normalise(line.replace(/^\s*(?:#{1,6}\s|[-*>]\s|\d+\.\s)/, "")))
		.filter((line) => /\S\s+\S/.test(line) || /[{}();=]/.test(line));
}

function oursOnlyGaps(inputs: Inputs, dump: Dump): Finding[] {
	const findings: Finding[] = [];
	const matched = matchedTexts(inputs);
	const removable = [...new Set([...dump.sample, ...matched])].sort((a, b) => b.length - a.length);
	const kept = inputs.oursOnly.filter((item) => item.inventory === undefined);
	const templates = inputs.templates.map(templatePattern);
	const squashedSample = dump.sample.map(squash).filter((text) => text.length >= 4);
	for (const state of dump.states) {
		if (state.error !== null) continue;
		for (const name of state.names) {
			if (name.via === "testid") continue;
			if (matched.has(name.text)) continue;
			if (
				kept.some(
					(item) => normalise(item.text) === name.text && (item.state ?? state.id) === state.id,
				)
			) {
				continue;
			}
			if (templates.some((template) => template.test(name.text))) continue;
			if (ENV_NAME.test(name.text)) continue;
			if (isSample(name.text, squashedSample)) continue;
			if (accountedFor(name.text, removable)) continue;
			findings.push({
				check: "b",
				severity: "gap",
				code: "ours-only",
				screen: state.group,
				state: state.id,
				text: name.text,
				detail: `${name.role} ${name.via}: ${name.selector}`,
			});
		}
	}
	return findings;
}

/** Check c: each measured element's computed values against Conductor's, within the tolerance. */
export function checkLayout(layout: LayoutSpec, dump: Dump): Finding[] {
	const findings: Finding[] = [];
	const byId = new Map<string, DumpState>(dump.states.map((state) => [state.id, state]));
	for (const entry of layout.entries) {
		const base = { check: "c" as const, id: entry.id, state: entry.state, text: entry.what };
		const state = byId.get(entry.state);
		if (state === undefined) {
			findings.push({
				...base,
				severity: "gap",
				code: "layout-state-missing",
				screen: entry.state,
				detail: "the checked app's catalogue has no such state",
			});
			continue;
		}
		if (state.error !== null) continue;
		const reading = state.layout.find((item) => item.id === entry.id);
		if (reading === undefined || !reading.found) {
			findings.push({
				...base,
				severity: "gap",
				code: "layout-not-found",
				screen: state.group,
				detail: `nothing matches ${entry.locator.css}${entry.locator.hasText === undefined ? "" : ` with "${entry.locator.hasText}"`}`,
			});
			continue;
		}
		const off: string[] = [];
		for (const [key, want] of Object.entries(entry.expect)) {
			const got = reading.values[key];
			const tolerance =
				key === "font-weight"
					? layout.tolerance.weight
					: key === "height" || key === "width"
						? layout.tolerance.box
						: layout.tolerance.style;
			if (got === undefined) off.push(`${key} unreadable (Conductor ${want})`);
			else if (Math.abs(got - want) > tolerance)
				off.push(`${key} ${round(got)} (Conductor ${want})`);
		}
		if (off.length > 0) {
			findings.push({
				...base,
				severity: "gap",
				code: "layout-off",
				screen: state.group,
				detail: `${off.join(", ")}; ${entry.evidence}; at ${reading.selector ?? "?"}`,
			});
		}
	}
	return findings;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** Inventories whose names come from one list of ours, so the reverse direction counts them together. */
const BACKEND_GROUPS: BackendInventory[][] = [
	["sidecar_rpc_method", "sidecar_call"],
	["sidecar_tool_name"],
	["tauri_command"],
	["tauri_plugin_command"],
	["tauri_event"],
	["settings_key"],
	["table"],
];

/** Check e: our backend names against Conductor's, both ways. */
export function checkBackend(inputs: Inputs, ours: Record<BackendInventory, string[]>): Finding[] {
	const findings: Finding[] = [];
	for (const group of BACKEND_GROUPS) {
		const accounted = new Set<string>();
		for (const inventory of group) {
			const spec = inputs.specs.get(inventory);
			const map = inputs.maps.get(inventory) ?? {};
			const names = new Set(ours[inventory]);
			for (const entry of spec?.entries ?? []) {
				const mapped = map[entry.id];
				if (mapped?.status !== "matched" || mapped.ours === undefined) continue;
				accounted.add(mapped.ours);
				if (!names.has(mapped.ours)) {
					findings.push({
						check: "e",
						severity: "gap",
						code: "backend-missing",
						screen: BACKEND_SCREEN,
						inventory,
						id: entry.id,
						text: entry.text,
						detail: `matched to ${mapped.ours}, which our ${inventory} list does not have`,
					});
				}
			}
		}
		const first = group[0];
		if (first === undefined) continue;
		const kept = new Set(
			inputs.oursOnly
				.filter((item) => item.inventory !== undefined && group.includes(item.inventory))
				.map((item) => item.text),
		);
		for (const name of ours[first]) {
			if (accounted.has(name) || kept.has(name)) continue;
			findings.push({
				check: "e",
				severity: "gap",
				code: "backend-ours-only",
				screen: BACKEND_SCREEN,
				inventory: group.join(", "),
				text: name,
				detail: "ours only: no Conductor name is matched to it",
			});
		}
	}
	return findings;
}
