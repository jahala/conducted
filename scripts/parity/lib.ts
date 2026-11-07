/**
 * The parity harness's shared shapes and helpers: spec entries, map entries, the dump a catalogue run
 * writes, text normalising, and reading and writing the committed data under `tests/parity/`.
 * Behaviour: docs/plans/parity-harness.md, sections 1 to 3.
 * Must handle: a data file that is missing or malformed is a thrown error naming the file, never an
 * empty list; JSON is written in Biome's format, so a regenerated file has no formatting diff.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");
export const DATA = join(ROOT, "tests/parity");
export const SPEC_DIR = join(DATA, "spec");
export const MAP_DIR = join(DATA, "map");

/** Inventories of wording a person reads on screen. They are matched against catalogue states. */
export const UI_INVENTORIES = [
	"text",
	"label",
	"aria_label",
	"placeholder",
	"title",
	"tooltip",
	"description",
	"toast",
	"literal",
	"route",
	"test_id",
] as const;
/** Inventories of names our backend must have: matched by name against our own lists. */
export const BACKEND_INVENTORIES = [
	"sidecar_rpc_method",
	"sidecar_tool_name",
	"sidecar_call",
	"tauri_command",
	"tauri_plugin_command",
	"tauri_event",
	"settings_key",
	"table",
] as const;
export type UiInventory = (typeof UI_INVENTORIES)[number];
export type BackendInventory = (typeof BACKEND_INVENTORIES)[number];
export type Inventory = UiInventory | BackendInventory;
export const INVENTORIES: readonly Inventory[] = [...UI_INVENTORIES, ...BACKEND_INVENTORIES];

export const isUiInventory = (name: string): name is UiInventory =>
	(UI_INVENTORIES as readonly string[]).includes(name);

/** One entry of Conductor's inventories: wording or an identifier, never code. */
export interface SpecEntry {
	id: string;
	text: string;
	/** The bundle file the entry was read from, or the research file for a key with no site. */
	file: string;
	/** Character offset in `file`, or null when the name has no site in the frontend bundle. */
	offset: number | null;
	/** Sidecar calls only: who sends it. */
	direction?: string;
}

export interface SpecFile {
	inventory: Inventory;
	source: string;
	entries: SpecEntry[];
}

/** How a string reaches a person in our DOM. */
export type Via = "text" | "aria-label" | "placeholder" | "title" | "alt" | "testid";

export type MapEntry =
	| {
			status: "matched";
			/** UI inventories: the catalogue state, how the name is shown, and where. */
			state?: string;
			via?: Via;
			role?: string;
			selector?: string;
			/** Backend inventories: our name for it. */
			ours?: string;
			by: "seed" | "seed-unsure" | "hand";
			note?: string;
	  }
	| { status: "decided"; decision: string; note: string; by: string }
	| {
			status: "gap";
			reason: "missing" | "unshown";
			screen: string;
			/**
			 * The sorting class (docs/plans/parity-harness.md section 2). Absent means the class follows
			 * from the reason: "unshown" for an unshown gap, "feature" for a missing one. A person writes
			 * "wording" when one of our screens does the same job in other words or in another place.
			 */
			class?: GapClass;
			/** A feature gap's backlog row in docs/plans/backlog.md, or "new" when none owns it yet. */
			backlog?: string;
			note?: string;
			/** "hand" when a person checked it; the seeder then keeps it. */
			by?: "hand";
	  };

export type MapFile = Record<string, MapEntry>;

/** How a gap is closed: a catalogue state, a fix to our wording or placement, or a feature. */
export type GapClass = "unshown" | "wording" | "feature";

export function gapClass(entry: Extract<MapEntry, { status: "gap" }>): GapClass {
	return entry.class ?? (entry.reason === "unshown" ? "unshown" : "feature");
}

/** A name of ours the check accepts with no Conductor entry: a decision, or the owner's keep ruling. */
export interface OursOnly {
	text: string;
	/** A backend inventory, for one of our backend names; absent for a string on screen. */
	inventory?: BackendInventory;
	/** Limits it to one state; absent means every state. */
	state?: string;
	decision?: string;
	keep?: string;
	note: string;
}

/** One name in a catalogue state's DOM, as the dump records it. */
export interface DomName {
	text: string;
	via: Via;
	/** The ARIA role, or the tag name when it has none. */
	role: string;
	selector: string;
}

export interface LayoutReading {
	id: string;
	found: boolean;
	values: Record<string, number>;
	selector?: string;
}

export interface DumpState {
	id: string;
	/** The catalogue's heading for the state, which the report groups by. */
	group: string;
	route: string | null;
	error: string | null;
	names: DomName[];
	layout: LayoutReading[];
}

export interface Dump {
	commit: string;
	viewport: { width: number; height: number };
	/** The string literals of the dumped app's catalogue: the sample data its states show. */
	sample: string[];
	states: DumpState[];
}

/**
 * Wording compared across apps: trimmed, one space, `…` as `...`, straight quotes, and Conductor's
 * name for itself read as ours (D012), so "Where Conductor stores ..." matches "Where Conducted
 * stores ...".
 */
export function normalise(text: string): string {
	return text
		.replace(/\bConductor\b/g, "Conducted")
		.replace(/…/g, "...")
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/ /g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** A looser key for the seeder's unsure matches: case folded and end punctuation dropped. */
export function loose(text: string): string {
	return normalise(text)
		.toLowerCase()
		.replace(/[.:!?]+$/, "")
		.trim();
}

export function readJson<T>(path: string): T {
	if (!existsSync(path)) throw new Error(`${path} does not exist.`);
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch (cause) {
		throw new Error(`${path} is not valid JSON: ${(cause as Error).message}`);
	}
}

/** Writes JSON files, then formats them with the repo's Biome so they match `biome ci`. */
export function writeJsonFiles(files: { path: string; value: unknown }[]): void {
	for (const file of files) writeFileSync(file.path, `${JSON.stringify(file.value, null, "\t")}\n`);
	if (files.length === 0) return;
	const biome = join(ROOT, "node_modules/.bin/biome");
	const formatted = spawnSync(biome, ["format", "--write", ...files.map((file) => file.path)], {
		cwd: ROOT,
		encoding: "utf8",
	});
	if (formatted.status !== 0) throw new Error(`Biome could not format:\n${formatted.stderr}`);
}

export function readSpec(dir: string = SPEC_DIR): Map<Inventory, SpecFile> {
	const specs = new Map<Inventory, SpecFile>();
	for (const inventory of INVENTORIES) {
		specs.set(inventory, readJson<SpecFile>(join(dir, `${inventory}.json`)));
	}
	return specs;
}

export function readMaps(dir: string = MAP_DIR): Map<Inventory, MapFile> {
	const maps = new Map<Inventory, MapFile>();
	for (const inventory of INVENTORIES) {
		const path = join(dir, `${inventory}.json`);
		maps.set(inventory, existsSync(path) ? readJson<MapFile>(path) : {});
	}
	return maps;
}

/** Map files in `dir` that name no inventory: a typo there would otherwise be ignored. */
export function strayMapFiles(dir: string = MAP_DIR): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => name.replace(/\.json$/, ""))
		.filter((name) => !(INVENTORIES as readonly string[]).includes(name));
}

/** The decision ids `docs/decisions.md` defines. */
export function decisionIds(decisions: string): Set<string> {
	return new Set([...decisions.matchAll(/^## (D\d{3})\./gm)].map((match) => match[1] ?? ""));
}
