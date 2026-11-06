/**
 * Seeds the parity map from a dump: each spec entry whose text a catalogue state shows is matched to
 * that state and element, each backend name we also have is matched to ours, a named rule writes a
 * decision, and everything else becomes a gap with its screen and whether our UI source has it.
 * Behaviour: docs/plans/parity-harness.md section 2.
 * Must handle: an entry a person checked (`"by": "hand"`, a match or a gap) or a decision is never
 * overwritten; a match that needs case folding or dropped end punctuation is `seed-unsure`, for a
 * person to check; the first state in catalogue order wins when several show the same text, and the
 * seed is the same on every run for one dump.
 *
 * Usage: bun scripts/parity/seed.ts <dump.json>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLACE_GAZETTEER } from "../../apps/desktop/src/core/services/place-gazetteer.ts";
import { routePath } from "./checks.ts";
import {
	BACKEND_INVENTORIES,
	type BackendInventory,
	type DomName,
	type Dump,
	type Inventory,
	isUiInventory,
	loose,
	MAP_DIR,
	type MapEntry,
	type MapFile,
	normalise,
	ROOT,
	readJson,
	readMaps,
	readSpec,
	type SpecFile,
	writeJsonFiles,
} from "./lib.ts";
import { ourNames } from "./ours.ts";
import { type RuleContext, ruleFor } from "./rules.ts";
import { researchScreens } from "./screens.ts";
import { sourceStrings, uiSourceFiles } from "./spec.ts";

export interface SeedInputs {
	specs: Map<Inventory, SpecFile>;
	maps: Map<Inventory, MapFile>;
	dump: Dump;
	ours: Record<BackendInventory, string[]>;
	/** Normalised strings of our UI source, to tell an unshown gap from a missing one. */
	ourStrings: Set<string>;
	screenFor: (file: string, offset: number | null) => string;
	rules: RuleContext;
}

const kept = (entry: MapEntry | undefined): boolean =>
	entry !== undefined && (entry.status === "decided" || entry.by === "hand");

interface Hit {
	state: string;
	name: DomName;
}

/** Every place in the dump that shows `text`, in catalogue order, exactly or loosely. */
function hits(dump: Dump, text: string, testId: boolean): { exact: Hit[]; loose: Hit[] } {
	const exact: Hit[] = [];
	const looser: Hit[] = [];
	const wanted = normalise(text);
	const wantedLoose = loose(text);
	for (const state of dump.states) {
		if (state.error !== null) continue;
		for (const name of state.names) {
			if ((name.via === "testid") !== testId) continue;
			if (name.text === wanted) exact.push({ state: state.id, name });
			else if (loose(name.text) === wantedLoose) looser.push({ state: state.id, name });
		}
	}
	return { exact, loose: looser };
}

const matchedAt = (hit: Hit, by: "seed" | "seed-unsure"): MapEntry => ({
	status: "matched",
	state: hit.state,
	via: hit.name.via,
	role: hit.name.role,
	selector: hit.name.selector,
	by,
});

export function seedMaps(inputs: SeedInputs): Map<Inventory, MapFile> {
	const seeded = new Map<Inventory, MapFile>();
	const routes = new Set(inputs.dump.states.map((state) => routePath(state.route)));
	for (const [inventory, spec] of inputs.specs) {
		const old = inputs.maps.get(inventory) ?? {};
		const next: MapFile = {};
		for (const entry of spec.entries) {
			const previous = old[entry.id];
			if (previous !== undefined && kept(previous)) {
				next[entry.id] = previous;
				continue;
			}
			next[entry.id] = seedOne(inventory, entry, inputs, routes);
		}
		seeded.set(inventory, next);
	}
	return seeded;
}

function seedOne(
	inventory: Inventory,
	entry: SpecFile["entries"][number],
	inputs: SeedInputs,
	routes: Set<string>,
): MapEntry {
	if (isUiInventory(inventory) && inventory !== "route") {
		const found = hits(inputs.dump, entry.text, inventory === "test_id");
		const first = found.exact[0] ?? found.loose[0];
		if (first !== undefined) return matchedAt(first, found.exact[0] ? "seed" : "seed-unsure");
	} else if (inventory === "route") {
		if (routes.has(entry.text)) return { status: "matched", ours: entry.text, by: "seed" };
	} else {
		const ours = inputs.ours[inventory as BackendInventory];
		const plugin = inventory === "tauri_plugin_command" ? `${entry.text.split("|")[0]}|*` : null;
		const name = plugin ?? entry.text;
		if (ours.includes(name)) return { status: "matched", ours: name, by: "seed" };
	}
	const rule = ruleFor(entry, inventory, inputs.rules);
	if (rule !== undefined) {
		return { status: "decided", decision: rule.decision, note: rule.note, by: `rule:${rule.name}` };
	}
	const backend = (BACKEND_INVENTORIES as readonly string[]).includes(inventory);
	return {
		status: "gap",
		reason: !backend && inputs.ourStrings.has(normalise(entry.text)) ? "unshown" : "missing",
		screen: backend ? "Backend" : inputs.screenFor(entry.file, entry.offset),
	};
}

function main(dumpPath: string | undefined): void {
	if (dumpPath === undefined) throw new Error("Usage: bun scripts/parity/seed.ts <dump.json>");
	const specs = readSpec();
	const maps = readMaps();
	const ourStrings = new Set<string>();
	for (const path of uiSourceFiles()) {
		for (const text of sourceStrings(readFileSync(path, "utf8"))) ourStrings.add(normalise(text));
	}
	const seeded = seedMaps({
		specs,
		maps,
		dump: readJson<Dump>(dumpPath),
		ours: ourNames(ROOT),
		ourStrings,
		screenFor: researchScreens(ROOT),
		rules: { places: new Set(PLACE_GAZETTEER.map((place) => place.name)) },
	});
	writeJsonFiles(
		[...seeded].map(([inventory, map]) => ({
			path: join(MAP_DIR, `${inventory}.json`),
			value: map,
		})),
	);
	for (const [inventory, map] of seeded) {
		const counts: Record<string, number> = {};
		for (const entry of Object.values(map)) {
			const key = entry.status === "matched" ? `matched:${entry.by}` : entry.status;
			counts[key] = (counts[key] ?? 0) + 1;
		}
		console.log(inventory.padEnd(22), JSON.stringify(counts));
	}
}

if (import.meta.main) main(process.argv[2]);
