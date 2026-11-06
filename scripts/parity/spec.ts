/**
 * Builds the parity spec: Conductor 0.92.1's user-facing inventories as committed data in
 * `tests/parity/spec/<inventory>.json`, each entry with its bundle file and offset.
 * Behaviour: docs/plans/parity-harness.md section 1. Wording and identifiers only (D002): the
 * inventories' context column is code and is never read into the output, and a dropped toast is listed
 * by offset alone in `excluded.json`.
 * Must handle: an input that is missing stops the build with its path (the spec is never written from
 * part of the inputs); a settings key the bundle does not hold is reported and left out; the same input
 * always gives the same files, so a rebuild shows no diff.
 * Runs only where the main checkout's `.context/` holds the inventories and the bundle; CI reads the
 * committed output.
 *
 * Usage: bun scripts/parity/spec.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { mainCheckout } from "../conductor-reference/paths.ts";
import {
	type Inventory,
	ROOT,
	SPEC_DIR,
	type SpecEntry,
	type SpecFile,
	writeJsonFiles,
} from "./lib.ts";

/** Short codes for the bundle files, as the research writes them (R@N, M@N). */
const FILE_CODES: Record<string, string> = {
	"renderApp-DeUrsznk.js": "R",
	"main-BE1h_1MP.js": "M",
	"sidecar.js": "S",
};
const APP_CHUNKS = ["main-BE1h_1MP.js", "renderApp-DeUrsznk.js"];
const TSV_KINDS = [
	"text",
	"label",
	"aria_label",
	"placeholder",
	"title",
	"tooltip",
	"description",
	"toast",
	"route",
	"test_id",
	"sidecar_rpc_method",
	"sidecar_tool_name",
] as const;

export interface TsvRow {
	text: string;
	file: string;
	offset: number;
	/** The 100 characters of code before the match. Read only to classify; never written out. */
	before: string;
}

export function parseTsv(source: string): TsvRow[] {
	const rows: TsvRow[] = [];
	for (const line of source.split("\n").slice(1)) {
		if (line === "") continue;
		const [, text, file, offset, before] = line.split("\t");
		if (text === undefined || file === undefined || offset === undefined) {
			throw new Error(`Malformed inventory line: ${line.slice(0, 80)}`);
		}
		rows.push({ text: decode(text), file, offset: Number(offset), before: before ?? "" });
	}
	return rows;
}

/** The inventory keeps a string's escapes as they are in the bundle; this reads them. */
export function decode(raw: string): string {
	try {
		return JSON.parse(`"${raw.replace(/\\'/g, "'")}"`) as string;
	} catch {
		return raw;
	}
}

export const entryId = (inventory: string, file: string, offset: number): string =>
	`${inventory}:${FILE_CODES[file] ?? file}${offset}`;

const TOAST_METHODS = new Set(["success", "warning", "loading", "dismiss"]);
const LOGGER_METHODS = new Set(["warn", "debug"]);

/**
 * The objects one bundle file uses as toasts: called with a toast library's own methods and never
 * with a logger's. Minified names can repeat across scopes; a name that is both is not a toast.
 */
export function toastReceivers(code: string): Set<string> {
	const methods = new Map<string, Set<string>>();
	const call = /([A-Za-z_$][\w$]*)\.(success|warning|loading|dismiss|warn|debug|error|info)\(/g;
	for (const match of code.matchAll(call)) {
		const name = match[1] ?? "";
		const seen = methods.get(name) ?? new Set<string>();
		seen.add(match[2] ?? "");
		methods.set(name, seen);
	}
	const toasts = new Set<string>();
	for (const [name, seen] of methods) {
		const toastLike = [...seen].some((method) => TOAST_METHODS.has(method));
		const loggerLike = [...seen].some((method) => LOGGER_METHODS.has(method));
		if (toastLike && !loggerLike) toasts.add(name);
	}
	return toasts;
}

/** The receiver of the call that starts right after `before`: its last identifier, or null. */
export function receiverOf(before: string): string | null {
	return /([A-Za-z_$][\w$]*)$/.exec(before)?.[1] ?? null;
}

/** Wording our UI shows: starts like a label or a sentence, and is not markup or a class list. */
export function readsLikeWording(text: string): boolean {
	if (text.length < 2 || text.length > 200) return false;
	if (!/^[A-Z⌘]/.test(text)) return false;
	if (/[{}<>]|^https?:|\\n/.test(text)) return false;
	if (/^[A-Z0-9_]+$/.test(text)) return false;
	return /[a-z]/.test(text);
}

/** String literals and JSX text in one of our source files. A loose scan: every hit is checked. */
export function sourceStrings(source: string): string[] {
	const found: string[] = [];
	const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	for (const match of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) {
		const raw = match[1] ?? match[2] ?? "";
		found.push(decode(raw));
	}
	for (const match of code.matchAll(/`([^`$\\]*)`/g)) found.push(match[1] ?? "");
	for (const match of code.matchAll(/>\s*([^<>{}]*[A-Za-z][^<>{}]*?)\s*</g)) {
		found.push((match[1] ?? "").replace(/\s+/g, " "));
	}
	return found;
}

/** Every double-quoted or backticked literal in a bundle file, decoded, with its first offset. */
export function bundleLiterals(code: string): Map<string, number> {
	const literals = new Map<string, number>();
	for (const match of code.matchAll(/"((?:[^"\\\n]|\\.){2,200})"|`([^`$\\\n]{2,200})`/g)) {
		const text = match[1] !== undefined ? decode(match[1]) : (match[2] ?? "");
		if (!literals.has(text)) literals.set(text, match.index);
	}
	return literals;
}

function walk(dir: string, keep: (path: string) => boolean): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...walk(path, keep));
		else if (keep(path)) files.push(path);
	}
	return files;
}

/** Our UI source: the desktop's screens, without tests, the test kit or the catalogue's sample data. */
function uiSourceFiles(): string[] {
	const src = join(ROOT, "apps/desktop/src");
	return walk(src, (path) => {
		const rel = relative(src, path);
		if (!/\.tsx?$/.test(rel) || /\.test\.tsx?$/.test(rel)) return false;
		return !/^(catalogue|test)\//.test(rel);
	});
}

/** Settings keys from the registry tables of services-map.md 4.2.3.2. */
export function researchSettingsKeys(servicesMap: string): string[] {
	const start = servicesMap.indexOf("##### 4.2.3.2 Tables");
	const end = servicesMap.indexOf("#### 4.2.4", start);
	if (start < 0 || end < 0) throw new Error("services-map.md has no section 4.2.3.2.");
	const keys: string[] = [];
	for (const match of servicesMap.slice(start, end).matchAll(/^\| `([a-z0-9_]+)` \|/gm)) {
		if (match[1] !== undefined && !keys.includes(match[1])) keys.push(match[1]);
	}
	return keys;
}

export function schemaTables(schema: string): string[] {
	return [...schema.matchAll(/CREATE TABLE "?([A-Za-z0-9_]+)"?/g)].map((match) => match[1] ?? "");
}

interface CallInventory {
	commands: { name: string; sites: { file: string; offset: number }[] }[];
	plugins: Record<string, { name: string; sites: { file: string; offset: number }[] }[]>;
	events: { name: string; sites: { file: string; offset: number }[] }[];
	sidecar: { method: string; direction: string; sites: { file: string; offset: number }[] }[];
	sql: { tables: string[]; sites: { file: string; offset: number }[] }[];
}

const firstSite = (sites: { file: string; offset: number }[]) => {
	const site = [...sites].sort((a, b) => a.file.localeCompare(b.file) || a.offset - b.offset)[0];
	return { file: site?.file ?? "", offset: site?.offset ?? null };
};

function main(): void {
	const main = mainCheckout();
	const inventoryDir = join(main, ".context/conductor-re/inventory");
	const reference = join(main, ".context/day/conductor-ref");
	const assets = join(main, ".context/day/conductor-assets/assets");
	const bundle = new Map(
		APP_CHUNKS.map((file) => [file, readFileSync(join(assets, file), "utf8")]),
	);

	const specs: SpecFile[] = [];
	const excluded: { inventory: string; file: string; offset: number; rule: string }[] = [];
	const known = new Set<string>();
	const toastNames = new Map(
		[...bundle].map(([file, code]) => [file, toastReceivers(code)] as const),
	);

	for (const kind of TSV_KINDS) {
		const path = join(inventoryDir, `${kind}.tsv`);
		const rows = parseTsv(readFileSync(path, "utf8"));
		const entries: SpecEntry[] = [];
		for (const row of rows) {
			known.add(row.text);
			if (kind === "toast") {
				const receiver = receiverOf(row.before);
				const toasts = toastNames.get(row.file);
				if (receiver === null || toasts === undefined || !toasts.has(receiver)) {
					excluded.push({ inventory: kind, file: row.file, offset: row.offset, rule: "logger" });
					continue;
				}
			}
			entries.push({
				id: entryId(kind, row.file, row.offset),
				text: row.text,
				file: row.file,
				offset: row.offset,
			});
		}
		specs.push({ inventory: kind, source: `.context/conductor-re/inventory/${kind}.tsv`, entries });
	}

	// Strings our UI shows that Conductor's bundle holds as a literal, where no inventory has them.
	const literals = new Map<string, SpecEntry>();
	const bundleSets = [...bundle].map(([file, code]) => ({ file, literals: bundleLiterals(code) }));
	for (const path of uiSourceFiles()) {
		for (const text of sourceStrings(readFileSync(path, "utf8"))) {
			if (!readsLikeWording(text) || known.has(text) || literals.has(text)) continue;
			for (const { file, literals: set } of bundleSets) {
				const offset = set.get(text);
				if (offset === undefined) continue;
				literals.set(text, { id: entryId("literal", file, offset), text, file, offset });
				break;
			}
		}
	}
	specs.push({
		inventory: "literal",
		source: "our UI source, each string found as a literal in the bundle",
		entries: [...literals.values()],
	});

	const calls = JSON.parse(
		readFileSync(join(reference, "call-inventory.json"), "utf8"),
	) as CallInventory;
	const named = (inventory: Inventory, name: string, site: ReturnType<typeof firstSite>) => ({
		id: `${inventory}:${name}`,
		text: name,
		...site,
	});
	specs.push({
		inventory: "tauri_command",
		source: ".context/day/conductor-ref/call-inventory.json (commands)",
		entries: calls.commands.map((call) => named("tauri_command", call.name, firstSite(call.sites))),
	});
	specs.push({
		inventory: "tauri_plugin_command",
		source: ".context/day/conductor-ref/call-inventory.json (plugins)",
		entries: Object.entries(calls.plugins).flatMap(([plugin, commands]) =>
			commands.map((call) =>
				named("tauri_plugin_command", `${plugin}|${call.name}`, firstSite(call.sites)),
			),
		),
	});
	specs.push({
		inventory: "tauri_event",
		source: ".context/day/conductor-ref/call-inventory.json (events)",
		entries: calls.events.map((event) => named("tauri_event", event.name, firstSite(event.sites))),
	});
	specs.push({
		inventory: "sidecar_call",
		source: ".context/day/conductor-ref/call-inventory.json (sidecar)",
		entries: calls.sidecar.map((call) => ({
			...named("sidecar_call", call.method, firstSite(call.sites)),
			direction: call.direction,
		})),
	});

	const servicesMap = readFileSync(join(ROOT, "docs/research/conductor/services-map.md"), "utf8");
	const keys: SpecEntry[] = [];
	const missingKeys: string[] = [];
	for (const key of researchSettingsKeys(servicesMap)) {
		const hit = bundleSets.find(({ literals: set }) => set.has(key));
		if (hit === undefined) {
			missingKeys.push(key);
			continue;
		}
		keys.push({
			id: `settings_key:${key}`,
			text: key,
			file: hit.file,
			offset: hit.literals.get(key) ?? null,
		});
	}
	specs.push({
		inventory: "settings_key",
		source: "docs/research/conductor/services-map.md 4.2.3.2, each key found in the bundle",
		entries: keys,
	});

	const tableNames = new Set<string>();
	for (const file of ["conductor-schema.sql", "cache-schema.sql"]) {
		for (const name of schemaTables(readFileSync(join(reference, file), "utf8")))
			tableNames.add(name);
	}
	specs.push({
		inventory: "table",
		source:
			".context/day/conductor-ref/{conductor,cache}-schema.sql; offsets from call-inventory.json (sql)",
		entries: [...tableNames].sort().map((name) => {
			const sites = calls.sql
				.filter((statement) => statement.tables.includes(name))
				.flatMap((s) => s.sites);
			const site = sites.length > 0 ? firstSite(sites) : { file: "schema", offset: null };
			return { id: `table:${name}`, text: name, ...site };
		}),
	});

	for (const spec of specs) {
		spec.entries.sort(
			(a, b) =>
				a.file.localeCompare(b.file) ||
				(a.offset ?? 0) - (b.offset ?? 0) ||
				a.id.localeCompare(b.id),
		);
	}
	writeJsonFiles([
		...specs.map((spec) => ({ path: join(SPEC_DIR, `${spec.inventory}.json`), value: spec })),
		{
			path: join(SPEC_DIR, "excluded.json"),
			value: {
				rules: {
					logger:
						"A toast-pattern call whose receiver the same bundle file also calls with a logger's methods (warn, debug), or that is not a plain name. Not shown to a person.",
				},
				entries: excluded,
			},
		},
	]);
	for (const spec of specs) console.log(`${spec.inventory.padEnd(22)} ${spec.entries.length}`);
	console.log(`excluded               ${excluded.length}`);
	if (missingKeys.length > 0) {
		console.log(`Settings keys the bundle does not hold, left out: ${missingKeys.join(", ")}`);
	}
}

if (import.meta.main) main();
