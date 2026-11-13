/**
 * Writes each gap's owner into the parity map: the backlog row and the checklist item of
 * `docs/plans/items/` that build or draw it. Owned is still a gap; the report counts it apart.
 * Behaviour: docs/plans/parity-harness.md section 2, "Owning a gap".
 * Must handle: an owner a person wrote (`"owner": "hand"`) is never overwritten; an entry two items
 * own takes the first in file order (ui.tsv, then system.tsv), so a rerun writes the same map; an
 * item's row-number citation is read from the inventory it cites, so a renumbered inventory moves it.
 * Reads committed files only: an inventory's rows are the spec's entries and its excluded rows, by
 * file and offset. So `pnpm guards` checks everywhere, CI included, that the committed map is what
 * this derives (`ownerDrift`, the parity-owners guard).
 *
 * Usage: bun scripts/parity/owners.ts
 */

import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	bySite,
	type ExcludedEntry,
	INVENTORIES,
	type Inventory,
	type Item,
	isUiInventory,
	MAP_DIR,
	type MapEntry,
	type MapFile,
	normalise,
	readExcluded,
	readItems,
	readMaps,
	readSpec,
	type SpecEntry,
	type SpecFile,
	TSV_KINDS,
	writeJsonFiles,
} from "./lib.ts";

const FILE_CODE: Record<string, string> = { "main-BE1h_1MP.js": "M", "renderApp-DeUrsznk.js": "R" };

/** A short identifier, or a common word, says too little to own an entry by its name alone. */
const MIN_NAME = 6;
/** A quoted fragment of an item must be this long before an entry's text inside it counts. */
const MIN_FRAGMENT = 14;

export interface Owner {
	item: Item;
	rule: "cite" | "quote" | "name";
}

/**
 * Entry ids an item cites in its research column: `inventory text R@N`, `inventory label #N-M`,
 * `inventory:toast rows N, M`, or `inventory:rpc|sidecar|sql|tool <name>` for a backend name. The two
 * row styles count differently, as the coverage audits wrote them: `#N` from 0 and `row N` from 1,
 * both from the TSV's first data row (checked on label #301 "Login method" and toast row 11).
 */
export function citedIds(
	item: Item,
	rowSite: (kind: string, row: number) => string | undefined,
): { ids: string[]; names: string[] } {
	const ids: string[] = [];
	const names: string[] = [];
	const research = item.research;
	for (const match of research.matchAll(/inventory (\w+) ([MR])@(\d+)/g)) {
		ids.push(`${match[1]}:${match[2]}${match[3]}`);
	}
	const rows = (kind: string, list: string, base: number) => {
		for (const range of list.matchAll(/(\d+)(?:\s*-\s*(\d+))?/g)) {
			const first = Number(range[1]);
			const last = Number(range[2] ?? range[1]);
			for (let row = first; row <= last && row - first < 200; row += 1) {
				const site = rowSite(kind, row + 1 - base);
				if (site !== undefined) ids.push(`${kind}:${site}`);
			}
		}
	};
	for (const match of research.matchAll(/(?:inventory |, )(\w+) (#[\d#, -]*\d)/g)) {
		rows(match[1] ?? "", (match[2] ?? "").replace(/#/g, ""), 0);
	}
	const toast = /inventory:toast rows? ([\d, and-]+)/.exec(research);
	if (toast?.[1] !== undefined) rows("toast", toast[1], 1);
	const backend = /^inventory:(?:rpc|sidecar|sql|tool) (\S+)/.exec(research);
	if (backend?.[1] !== undefined) names.push(backend[1]);
	return { ids, names };
}

/** The strings an item quotes: '...', "..." or `...`. */
function quoted(item: Item): string[] {
	return [...item.item.matchAll(/'([^']+)'|"([^"]+)"|`([^`]+)`/g)].map((match) =>
		normalise(match[1] ?? match[2] ?? match[3] ?? ""),
	);
}

/** The first item that owns `entry`, by the strongest evidence: a citation, a quote, then a name. */
export function ownerFor(
	entry: SpecEntry,
	inventory: Inventory,
	items: Item[],
	cites: Map<string, Item>,
): Owner | undefined {
	const cited =
		cites.get(entry.id) ?? (isUiInventory(inventory) ? undefined : cites.get(`name:${entry.text}`));
	if (cited !== undefined) return { item: cited, rule: "cite" };
	const text = normalise(entry.text);
	if (text.length >= 2) {
		const quote = items.find((item) =>
			quoted(item).some(
				(fragment) => fragment === text || (text.length >= MIN_FRAGMENT && fragment.includes(text)),
			),
		);
		if (quote !== undefined) return { item: quote, rule: "quote" };
	}
	if (
		!isUiInventory(inventory) &&
		/^[A-Za-z_][\w|:/.-]+$/.test(entry.text) &&
		entry.text.length >= MIN_NAME
	) {
		const word = new RegExp(`(?<![\\w-])${entry.text.replace(/[|.]/g, "\\$&")}(?![\\w-])`);
		const named = items.find((item) => word.test(item.item) || word.test(item.research));
		if (named !== undefined) return { item: named, rule: "name" };
	}
	return undefined;
}

export function owners(
	specs: ReturnType<typeof readSpec>,
	maps: Map<Inventory, MapFile>,
	items: Item[],
	rowSite: (kind: string, row: number) => string | undefined,
): Map<Inventory, MapFile> {
	const cites = new Map<string, Item>();
	for (const item of items) {
		const { ids, names } = citedIds(item, rowSite);
		for (const id of ids) if (!cites.has(id)) cites.set(id, item);
		for (const name of names) if (!cites.has(`name:${name}`)) cites.set(`name:${name}`, item);
	}
	const next = new Map<Inventory, MapFile>();
	for (const inventory of INVENTORIES) {
		const map = { ...(maps.get(inventory) ?? {}) };
		for (const entry of specs.get(inventory)?.entries ?? []) {
			const mapped = map[entry.id];
			if (mapped?.status !== "gap" || mapped.owner === "hand") continue;
			const { backlog: _row, item: _item, owner: _owner, ...rest } = mapped;
			const owner = ownerFor(entry, inventory, items, cites);
			map[entry.id] =
				owner === undefined
					? rest
					: { ...rest, backlog: owner.item.id, item: owner.item.item, owner: `rule:${owner.rule}` };
		}
		next.set(inventory, map);
	}
	return neighbours(specs, next);
}

/**
 * Strings of one component sit at nearby offsets. A UI gap no item owns takes the row, without an
 * item, when every gap an item owns within `NEIGHBOUR` characters in the same bundle file has that
 * one row. Measured on the gaps an item owns, leaving each out in turn (round 3, 7 November 2026):
 * within 500 characters 84% of 206 agree, 1,000 85% of 258, 2,000 83% of 282, 5,000 76% of 272.
 */
export const NEIGHBOUR = 1_000;

function neighbours(
	specs: ReturnType<typeof readSpec>,
	maps: Map<Inventory, MapFile>,
): Map<Inventory, MapFile> {
	const owned = new Map<string, { offset: number; row: string }[]>();
	for (const [inventory, map] of maps) {
		if (!isUiInventory(inventory)) continue;
		for (const entry of specs.get(inventory)?.entries ?? []) {
			const mapped = map[entry.id];
			if (mapped?.status !== "gap" || mapped.item === undefined || mapped.backlog === undefined)
				continue;
			if (entry.offset === null) continue;
			const list = owned.get(entry.file) ?? [];
			list.push({ offset: entry.offset, row: mapped.backlog });
			owned.set(entry.file, list);
		}
	}
	for (const [inventory, map] of maps) {
		if (!isUiInventory(inventory)) continue;
		for (const entry of specs.get(inventory)?.entries ?? []) {
			const mapped = map[entry.id];
			if (mapped?.status !== "gap" || mapped.backlog !== undefined || entry.offset === null)
				continue;
			const offset = entry.offset;
			const rows = new Set(
				(owned.get(entry.file) ?? [])
					.filter((near) => Math.abs(near.offset - offset) <= NEIGHBOUR)
					.map((near) => near.row),
			);
			const [row] = rows;
			if (rows.size === 1 && row !== undefined) {
				map[entry.id] = { ...mapped, backlog: row, owner: "rule:neighbour" };
			}
		}
	}
	return maps;
}

/**
 * The site of row `row` of `<kind>.tsv`, as a spec id's suffix (`R8853002`). The TSV's data rows are
 * the spec's entries and the rows `excluded.json` lists, in file and offset order: spec.ts refuses a
 * TSV in any other order. A cited inventory the spec does not build from a TSV is thrown, naming it:
 * a silent miss would drop every owner it cites.
 */
export function rowSites(
	specs: Map<Inventory, SpecFile>,
	excluded: ExcludedEntry[],
): (kind: string, row: number) => string | undefined {
	const cache = new Map<string, { file: string; offset: number | null }[]>();
	return (kind, row) => {
		let rows = cache.get(kind);
		if (rows === undefined) {
			const tsvKind = TSV_KINDS.find((name) => name === kind);
			if (tsvKind === undefined) {
				throw new Error(
					`An item cites ${kind} by row, but the spec builds no ${kind} inventory from a TSV.`,
				);
			}
			rows = [
				...(specs.get(tsvKind)?.entries ?? []),
				...excluded.filter((entry) => entry.inventory === kind),
			].sort(bySite);
			cache.set(kind, rows);
		}
		const found = rows[row - 1];
		const code = FILE_CODE[found?.file ?? ""];
		return found === undefined || code === undefined ? undefined : `${code}${found.offset}`;
	};
}

export interface Drift {
	inventory: Inventory;
	id: string;
	committed: MapEntry | undefined;
	derived: MapEntry | undefined;
}

/**
 * Every map entry that differs from what `owners` derives from the same spec, map and items. Entries
 * are compared as data, so the order of their fields does not count.
 */
export function ownerDrift(
	specs: Map<Inventory, SpecFile>,
	maps: Map<Inventory, MapFile>,
	items: Item[],
	rowSite: (kind: string, row: number) => string | undefined,
): Drift[] {
	const next = owners(specs, maps, items, rowSite);
	const drift: Drift[] = [];
	for (const inventory of INVENTORIES) {
		const committed = maps.get(inventory) ?? {};
		const derived = next.get(inventory) ?? {};
		for (const id of new Set([...Object.keys(committed), ...Object.keys(derived)])) {
			if (!isDeepStrictEqual(committed[id], derived[id])) {
				drift.push({ inventory, id, committed: committed[id], derived: derived[id] });
			}
		}
	}
	return drift;
}

if (import.meta.main) {
	const specs = readSpec();
	const next = owners(specs, readMaps(), readItems(), rowSites(specs, readExcluded()));
	writeJsonFiles(
		[...next].map(([inventory, map]) => ({ path: join(MAP_DIR, `${inventory}.json`), value: map })),
	);
	let owned = 0;
	let rowOnly = 0;
	for (const map of next.values()) {
		for (const entry of Object.values(map)) {
			if (entry.status !== "gap" || entry.backlog === undefined) continue;
			if (entry.item === undefined) rowOnly += 1;
			else owned += 1;
		}
	}
	console.log(`${owned} gaps owned by a backlog row and its item, ${rowOnly} by a row only.`);
}
