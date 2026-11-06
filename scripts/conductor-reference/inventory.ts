/**
 * The call inventory: every call Conductor's frontend makes to its native side, read from its built
 * bundle. It lists each custom Tauri command, each plugin command (`plugin:<name>|<command>`), each
 * sidecar method that goes through the JSON-RPC tunnel, each event it listens to, and each SQL statement
 * it runs. For each it gives the argument keys at the call site, the fields the code reads from the
 * answer (a heuristic, see `readsAfter`), and the bundle file and character offset of every site.
 *
 * - How calls are found, without names from any one build: an invoke wrapper is a function that
 *   returns `window.__TAURI_INTERNALS__.invoke(<its first parameter>, ...)`; a listen wrapper is a
 *   function that sends `plugin:event|listen` with `event: <its first parameter>`; the sidecar tunnel is
 *   the object made from the class that builds a `JSONRPCServerAndClient`. Each is followed through
 *   pass-through wrappers and through the chunks' `export {a as b}` and `import {b as c}` statements, so
 *   minified names are resolved per chunk.
 * - Method names written as `Enum.KEY` are resolved through the chunk's enum objects
 *   (`X={KEY:"value"}` and TypeScript's `(function(t){t.KEY="value"})(X||(X={}))`).
 * - The output is data the stand-in reads, and it is drawn from Conductor's code, so it is written
 *   only into the git-ignored `.context/` folder.
 *
 * Usage: bun scripts/conductor-reference/inventory.ts <bundle-dir> <out.json>
 * `<bundle-dir>` holds `index.html` and `assets/`.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	balancedEnd,
	identifier,
	objectKeys,
	readString,
	skipSpace,
	splitTopLevel,
} from "./js-scan.ts";

export interface Chunk {
	file: string;
	text: string;
}

export interface Site {
	file: string;
	offset: number;
	/** Top-level keys of the argument object, `[]` for no argument, null when it is not a literal. */
	args: string[] | null;
	/** Fields read from the answer; `[]` when the answer is kept whole, null when none was found. */
	reads: string[] | null;
}

export interface Entry {
	name: string;
	sites: Site[];
}

export interface EventEntry extends Entry {
	/** `listen` for the event plugin's listen wrappers, `method` for `<window>.listen(...)`. */
	via: ("listen" | "method")[];
}

export interface SidecarEntry {
	method: string;
	/** The enum and key it is written as, when it is. */
	written: string | null;
	/** `to-sidecar` when the frontend sends it, `from-sidecar` when the frontend handles it. */
	direction: "to-sidecar" | "from-sidecar";
	/** How it is used: `request`, `notify` or `handle`. Empty for an enum member no site uses. */
	uses: ("request" | "notify" | "handle")[];
	sites: Site[];
}

export interface SqlEntry {
	statement: string;
	/** `?` and `$n` placeholders outside quotes. */
	params: number;
	/** True when the text has `${...}` parts or is joined with `+`, so the full text is built at run time. */
	dynamic: boolean;
	tables: string[];
	/** Result columns of a SELECT or RETURNING; `*` for all. */
	reads: string[];
	sites: { file: string; offset: number }[];
}

export interface Inventory {
	files: string[];
	wrappers: { file: string; name: string; role: Role }[];
	commands: Entry[];
	plugins: Record<string, Entry[]>;
	events: EventEntry[];
	sidecar: SidecarEntry[];
	sql: SqlEntry[];
	/** Invoke or listen calls whose first argument is not a literal: the name is decided at run time. */
	dynamic: { file: string; offset: number; wrapper: string }[];
}

export type Role = "invoke" | "listen" | "rpc";

const NAME = "[\\w$]+";

/** `local -> exported` for one chunk's export statements. */
function exportsOf(text: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const match of text.matchAll(/export\s*\{([^}]*)\}/g)) {
		for (const part of (match[1] ?? "").split(",")) {
			const [local, exported] = part.trim().split(/\s+as\s+/);
			if (local) found.set(local, exported ?? local);
		}
	}
	return found;
}

/** `local -> {from, exported}` for one chunk's relative named imports. */
function importsOf(text: string): Map<string, { from: string; exported: string }> {
	const found = new Map<string, { from: string; exported: string }>();
	for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']\.\/([^"']+)["']/g)) {
		for (const part of (match[1] ?? "").split(",")) {
			const [exported, local] = part.trim().split(/\s+as\s+/);
			if (exported) found.set(local ?? exported, { from: match[2] ?? "", exported });
		}
	}
	return found;
}

/** Names a chunk defines itself for each role. */
function localWrappers(text: string): Map<string, Role> {
	const found = new Map<string, Role>();
	const invoke = new RegExp(
		`function\\s+(${NAME})\\s*\\(\\s*(${NAME})[^)]*\\)\\s*\\{\\s*return\\s+window\\.__TAURI_INTERNALS__\\.invoke\\(\\s*\\2(?![\\w$])`,
		"g",
	);
	for (const match of text.matchAll(invoke)) found.set(match[1] as string, "invoke");
	const listen = new RegExp(
		`function\\s+(${NAME})\\s*\\(\\s*(${NAME})[^)]*\\)\\s*\\{(?:(?!function\\b)[\\s\\S]){0,400}?["']plugin:event\\|listen["']\\s*,\\s*\\{\\s*event\\s*:\\s*\\2(?![\\w$])`,
		"g",
	);
	for (const match of text.matchAll(listen)) found.set(match[1] as string, "listen");
	const rpcClass = new RegExp(
		`class\\s+(${NAME})\\s*\\{(?:(?!\\bclass\\b)[\\s\\S]){0,1200}?JSONRPCServerAndClient`,
		"g",
	);
	for (const match of text.matchAll(rpcClass)) {
		const made = new RegExp(
			`(${NAME})\\s*=\\s*new\\s+${(match[1] as string).replace(/\$/g, "\\$")}(?![\\w$])`,
			"g",
		);
		for (const instance of text.matchAll(made)) found.set(instance[1] as string, "rpc");
	}
	return found;
}

/**
 * Adds pass-through wrappers: a function whose first parameter reaches a known wrapper as that
 * wrapper's first argument, within 600 characters and no nested `function`, such as
 * `function f(a, b) { return w(a, b) }` or `function f(a, b) { return retry(() => w(a, b)) }`.
 */
function addPassThrough(text: string, names: Map<string, Role>): boolean {
	let added = false;
	for (const [name, role] of [...names]) {
		if (role === "rpc") continue;
		const pass = new RegExp(
			`function\\s+(${NAME})\\s*\\(\\s*(${NAME})[^)]*\\)\\s*\\{(?:(?!function\\b)[^}]|\\}(?!\\s*function\\b)){0,600}?${identifier(name)}\\(\\s*\\2\\s*[,)]`,
			"g",
		);
		for (const match of text.matchAll(pass)) {
			const wrapper = match[1] as string;
			if (!names.has(wrapper)) {
				names.set(wrapper, role);
				added = true;
			}
		}
	}
	return added;
}

type EnumTable = Map<string, Map<string, string>>;

/** Names a chunk assigns a plain string exactly once, such as `const GUt="some-event"`. */
function constantsOf(text: string): Map<string, string> {
	const seen = new Map<string, string | null>();
	for (const match of text.matchAll(/(?<![\w$.#])([\w$]+)\s*=\s*"([^"\\\n]*)"(?=\s*[,;)}])/g)) {
		const name = match[1] as string;
		seen.set(name, seen.has(name) ? null : (match[2] as string));
	}
	const found = new Map<string, string>();
	for (const [name, value] of seen) if (value !== null) found.set(name, value);
	return found;
}

/** The chunk's string enums: object literals with upper-case keys, and TypeScript enum functions. */
function enumsOf(text: string): EnumTable {
	const found: EnumTable = new Map();
	const object = new RegExp(
		`(${NAME})\\s*=\\s*\\{((?:\\s*[A-Z][A-Z0-9_]*\\s*:\\s*"[^"\\\\]*"\\s*,?)+)\\}`,
		"g",
	);
	for (const match of text.matchAll(object)) {
		const members = new Map<string, string>();
		for (const member of (match[2] ?? "").matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*"([^"]*)"/g)) {
			members.set(member[1] as string, member[2] as string);
		}
		found.set(match[1] as string, members);
	}
	const tsEnum = new RegExp(
		`\\(\\s*function\\s*\\(\\s*(${NAME})\\s*\\)\\s*\\{((?:\\s*\\1\\.[A-Z][\\w]*\\s*=\\s*"[^"\\\\]*"\\s*[,;]?)+)\\s*\\}\\s*\\)\\s*\\(\\s*(${NAME})\\s*\\|\\|`,
		"g",
	);
	for (const match of text.matchAll(tsEnum)) {
		const members = new Map<string, string>();
		for (const member of (match[2] ?? "").matchAll(/\.([A-Z]\w*)\s*=\s*"([^"]*)"/g)) {
			members.set(member[1] as string, member[2] as string);
		}
		found.set(match[3] as string, members);
	}
	return found;
}

interface ChunkFacts {
	chunk: Chunk;
	exports: Map<string, string>;
	imports: Map<string, { from: string; exported: string }>;
	wrappers: Map<string, Role>;
	enums: EnumTable;
	constants: Map<string, string>;
}

/** Follows wrappers and enums through exports and imports until nothing new is found. */
function resolveAcrossChunks(facts: ChunkFacts[]): void {
	const byFile = new Map(facts.map((fact) => [fact.chunk.file, fact]));
	for (let round = 0; round < 10; round++) {
		let changed = false;
		for (const fact of facts) {
			if (addPassThrough(fact.chunk.text, fact.wrappers)) changed = true;
			for (const [local, { from, exported }] of fact.imports) {
				const source = byFile.get(from);
				if (source === undefined) continue;
				for (const [sourceLocal, sourceExported] of source.exports) {
					if (sourceExported !== exported) continue;
					const role = source.wrappers.get(sourceLocal);
					if (role !== undefined && !fact.wrappers.has(local)) {
						fact.wrappers.set(local, role);
						changed = true;
					}
					const members = source.enums.get(sourceLocal);
					if (members !== undefined && !fact.enums.has(local)) {
						fact.enums.set(local, members);
						changed = true;
					}
				}
			}
		}
		if (!changed) return;
	}
}

interface FirstArgument {
	/** The literal value, or the resolved enum value. Null when the argument is decided at run time. */
	value: string | null;
	written: string | null;
	/** Offset just past the first argument. */
	end: number;
}

function firstArgument(
	text: string,
	open: number,
	enums: EnumTable,
	constants: Map<string, string> = new Map(),
): FirstArgument {
	const start = skipSpace(text, open + 1);
	const literal = readString(text, start);
	if (literal !== null && !literal.dynamic) {
		return { value: literal.value, written: null, end: literal.end };
	}
	const member = /^([\w$]+)\.([A-Z][A-Z0-9_]*)\b/.exec(text.slice(start, start + 80));
	if (member !== null) {
		const value = enums.get(member[1] as string)?.get(member[2] as string);
		if (value !== undefined) {
			return { value, written: `${member[1]}.${member[2]}`, end: start + member[0].length };
		}
	}
	const constant = /^([\w$]+)\s*[,)]/.exec(text.slice(start, start + 80))?.[1];
	const value = constant === undefined ? undefined : constants.get(constant);
	if (constant !== undefined && value !== undefined) {
		return { value, written: constant, end: start + constant.length };
	}
	return { value: null, written: null, end: start };
}

/** The keys of the object passed right after the first argument, `[]` when there is none. */
function argumentKeys(text: string, afterFirst: number): string[] | null {
	const next = skipSpace(text, afterFirst);
	if (text[next] === ")") return [];
	if (text[next] !== ",") return null;
	const value = skipSpace(text, next + 1);
	if (text[value] === "{") return objectKeys(text, value);
	return null;
}

/**
 * The fields read from a call's answer: the variable or destructuring it is assigned to, or the
 * parameter of a `.then(...)` after it, then every `name.field` in the next 1,500 characters. It is a
 * heuristic over minified code, where short names are reused, so it can list too much; null means no
 * reader was found.
 */
export function readsAfter(text: string, callStart: number, callEnd: number): string[] | null {
	const before = text.slice(Math.max(0, callStart - 80), callStart);
	const after = text.slice(callEnd, callEnd + 60);
	const destructured =
		/\{([^{}]*)\}\s*=\s*(?:await\s+)?$/.exec(before)?.[1] ??
		/^\s*\.then\(\s*\(?\s*\{([^{}]*)\}/.exec(after)?.[1];
	if (destructured !== undefined) {
		return splitTopLevel(destructured)
			.map((part) => part.split(":")[0]?.trim() ?? "")
			.filter((name) => name !== "");
	}
	const assigned = /(?<![\w$.])([\w$]+)\s*=\s*(?:await\s+)?$/.exec(before)?.[1];
	const thenParam = /^\s*\.then\(\s*\(?\s*([\w$]+)\s*\)?\s*=>/.exec(after)?.[1];
	const variable = assigned ?? thenParam;
	if (variable === undefined) return null;
	const reads = new Set<string>();
	const window = text.slice(callEnd, callEnd + 1_500);
	const access = new RegExp(`${identifier(variable)}\\??\\.([\\w$]+)`, "g");
	for (const match of window.matchAll(access)) reads.add(match[1] as string);
	return [...reads].sort();
}

function siteAt(chunk: Chunk, callStart: number, open: number, first: FirstArgument): Site {
	const close = balancedEnd(chunk.text, open);
	return {
		file: chunk.file,
		offset: callStart,
		args: argumentKeys(chunk.text, first.end),
		reads: close === null ? null : readsAfter(chunk.text, callStart, close),
	};
}

function add<T extends { sites: S[] }, S>(
	map: Map<string, T>,
	key: string,
	make: () => T,
	site: S,
) {
	let entry = map.get(key);
	if (entry === undefined) {
		entry = make();
		map.set(key, entry);
	}
	entry.sites.push(site);
}

const SQL_START =
	/(["'`])\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|PRAGMA|BEGIN|COMMIT|ROLLBACK|ALTER|DROP|REPLACE|SAVEPOINT|RELEASE)\b/g;
const SQL_SHAPE =
	/^(?:SELECT\s+[\s\S]*|INSERT\s+(?:OR\s+\w+\s+)?INTO\s[\s\S]*|UPDATE\s+["\w]+\s+SET\s[\s\S]*|DELETE\s+FROM\s[\s\S]*|WITH\s+(?:RECURSIVE\s+)?\w+[\s\S]*\bAS\b[\s\S]*|CREATE\s+(?:TABLE|INDEX|UNIQUE|TRIGGER|VIEW|TEMP)[\s\S]*|PRAGMA\s+\w[\s\S]*|BEGIN(?:\s+\w+)?(?:\s+TRANSACTION)?|COMMIT|ROLLBACK(?:\s+TO\s+\w+)?|ALTER\s+TABLE\s[\s\S]*|DROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)[\s\S]*|REPLACE\s+INTO\s[\s\S]*|SAVEPOINT\s+\w+|RELEASE\s+\w+)$/;

/** Counts `?` and `$n` placeholders outside quoted SQL strings. */
export function countParams(statement: string): number {
	const unquoted = statement.replace(/'(?:[^']|'')*'/g, "''").replace(/\$\{[^}]*\}/g, "");
	return (unquoted.match(/\?|\$\d+/g) ?? []).length;
}

/** The result columns of the statement's first top-level SELECT list, and of a RETURNING clause. */
export function resultColumns(statement: string): string[] {
	const columns: string[] = [];
	const listOf = (list: string): void => {
		for (const part of splitTopLevel(list)) {
			const trimmed = part.trim();
			const alias = /\bAS\s+["`]?([\w]+)["`]?\s*$/i.exec(trimmed)?.[1];
			const name = alias ?? /([\w*]+)["`]?\s*$/.exec(trimmed)?.[1];
			if (name !== undefined) columns.push(name);
		}
	};
	const select = /^\s*(?:WITH[\s\S]*?\)\s*)?SELECT\s+(?:DISTINCT\s+)?([\s\S]*?)\s+FROM\s/i.exec(
		statement,
	);
	if (select !== null && /^\s*(?:WITH|SELECT)/i.test(statement)) listOf(select[1] ?? "");
	else if (/^\s*SELECT\s/i.test(statement) && !/\sFROM\s/i.test(statement)) {
		listOf(statement.replace(/^\s*SELECT\s+/i, ""));
	}
	const returning = /\bRETURNING\s+([\s\S]+)$/i.exec(statement)?.[1];
	if (returning !== undefined) listOf(returning);
	return columns;
}

function tablesOf(statement: string): string[] {
	const tables = new Set<string>();
	for (const match of statement.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+["`]?([A-Za-z_]\w*)/g)) {
		const name = match[1] as string;
		if (!/^(SELECT|VALUES|json_each|json_tree)$/i.test(name)) tables.add(name);
	}
	return [...tables].sort();
}

function collectSql(chunk: Chunk, found: Map<string, SqlEntry>): void {
	for (const match of chunk.text.matchAll(SQL_START)) {
		const literal = readString(chunk.text, match.index);
		if (literal === null) continue;
		const statement = literal.value.replace(/\s+/g, " ").trim();
		if (!SQL_SHAPE.test(statement)) continue;
		const joined =
			/\+\s*$/.test(chunk.text.slice(Math.max(0, match.index - 3), match.index)) ||
			/^\s*\+/.test(chunk.text.slice(literal.end, literal.end + 3));
		add(
			found,
			statement,
			() => ({
				statement,
				params: countParams(statement),
				dynamic: literal.dynamic || joined,
				tables: tablesOf(statement),
				reads: resultColumns(statement),
				sites: [],
			}),
			{ file: chunk.file, offset: match.index },
		);
	}
}

/** Reads every chunk and returns the inventory. Pure: the chunks are passed in. */
export function buildInventory(chunks: readonly Chunk[]): Inventory {
	const facts: ChunkFacts[] = chunks.map((chunk) => ({
		chunk,
		exports: exportsOf(chunk.text),
		imports: importsOf(chunk.text),
		wrappers: localWrappers(chunk.text),
		enums: enumsOf(chunk.text),
		constants: constantsOf(chunk.text),
	}));
	resolveAcrossChunks(facts);

	const commands = new Map<string, Entry>();
	const plugins = new Map<string, Map<string, Entry>>();
	const events = new Map<string, EventEntry>();
	const sidecar = new Map<string, SidecarEntry>();
	const sql = new Map<string, SqlEntry>();
	const dynamic: Inventory["dynamic"] = [];
	const rpcEnums = new Map<
		string,
		{ members: Map<string, string>; direction: SidecarEntry["direction"] }
	>();

	const addPlugin = (name: string, site: Site): void => {
		const [plugin, command] = name.slice("plugin:".length).split("|") as [string, string];
		let table = plugins.get(plugin);
		if (table === undefined) {
			table = new Map();
			plugins.set(plugin, table);
		}
		add(table, command, () => ({ name: command, sites: [] }), site);
	};
	const addEvent = (name: string, via: "listen" | "method", site: Site): void => {
		add(events, name, () => ({ name, via: [], sites: [] }), site);
		const entry = events.get(name) as EventEntry;
		if (!entry.via.includes(via)) entry.via.push(via);
	};

	for (const fact of facts) {
		const { chunk, enums, constants } = fact;
		const text = chunk.text;
		const pluginSites = new Set<number>();
		for (const [name, role] of fact.wrappers) {
			if (role === "rpc") {
				const call = new RegExp(
					`${identifier(name)}\\.(request|requestWithTimeout|requestAdvanced|notify|addMethod|addMethodAdvanced)\\s*\\(`,
					"g",
				);
				for (const match of text.matchAll(call)) {
					const open = match.index + match[0].length - 1;
					const first = firstArgument(text, open, enums);
					if (first.value === null) continue;
					const verb = match[1] as string;
					const use: SidecarEntry["uses"][number] = verb.startsWith("request")
						? "request"
						: verb === "notify"
							? "notify"
							: "handle";
					const direction: SidecarEntry["direction"] =
						use === "handle" ? "from-sidecar" : "to-sidecar";
					const enumName = first.written?.split(".")[0];
					const members = enumName === undefined ? undefined : enums.get(enumName);
					if (enumName !== undefined && members !== undefined) {
						rpcEnums.set(`${chunk.file}:${enumName}`, { members, direction });
					}
					const key = `${direction}:${first.value}`;
					add(
						sidecar,
						key,
						() => ({
							method: first.value as string,
							written: first.written,
							direction,
							uses: [],
							sites: [],
						}),
						siteAt(chunk, match.index, open, first),
					);
					const entry = sidecar.get(key) as SidecarEntry;
					if (!entry.uses.includes(use)) entry.uses.push(use);
				}
				continue;
			}
			const call = new RegExp(`${identifier(name)}\\s*\\(`, "g");
			for (const match of text.matchAll(call)) {
				if (/function\s*$/.test(text.slice(Math.max(0, match.index - 12), match.index))) continue;
				const open = match.index + match[0].length - 1;
				const close = balancedEnd(text, open);
				// A method definition `name(a){...}` is not a call.
				if (close !== null && text[skipSpace(text, close)] === "{") continue;
				const first = firstArgument(text, open, enums, constants);
				if (first.value === null) {
					dynamic.push({ file: chunk.file, offset: match.index, wrapper: name });
					continue;
				}
				const site = siteAt(chunk, match.index, open, first);
				if (role === "listen") addEvent(first.value, "listen", site);
				else if (first.value.startsWith("plugin:")) {
					pluginSites.add(skipSpace(text, open + 1));
					addPlugin(first.value, site);
				} else add(commands, first.value, () => ({ name: first.value as string, sites: [] }), site);
			}
		}
		// Plugin command names that are not the first argument of a wrapper call.
		for (const match of text.matchAll(/["'`]plugin:[\w-]+\|[\w-]+["'`]/g)) {
			if (pluginSites.has(match.index)) continue;
			addPlugin(match[0].slice(1, -1), {
				file: chunk.file,
				offset: match.index,
				args: null,
				reads: null,
			});
		}
		// `<window or webview>.listen(<event>, ...)` and `.once(...)` with a Tauri event name.
		for (const match of text.matchAll(/\.(?:listen|once)\s*\(/g)) {
			const open = match.index + match[0].length - 1;
			const first = firstArgument(text, open, enums);
			if (first.value === null || !/^[\w-]+:\/\/[\w/-]+$|^[a-z][\w-]*$/.test(first.value)) continue;
			if (first.written === null && !first.value.includes("://")) continue;
			addEvent(first.value, "method", siteAt(chunk, match.index, open, first));
		}
		collectSql(chunk, sql);
	}

	// Members of a sidecar method enum that no site uses are still methods of the tunnel.
	for (const { members, direction } of rpcEnums.values()) {
		for (const [key, method] of members) {
			const id = `${direction}:${method}`;
			if (!sidecar.has(id)) {
				sidecar.set(id, { method, written: key, direction, uses: [], sites: [] });
			}
		}
	}

	const byName = <T extends { name: string }>(entries: Iterable<T>): T[] =>
		[...entries].sort((a, b) => a.name.localeCompare(b.name));
	return {
		files: chunks.map((chunk) => chunk.file),
		wrappers: facts.flatMap((fact) =>
			[...fact.wrappers].map(([name, role]) => ({ file: fact.chunk.file, name, role })),
		),
		commands: byName(commands.values()),
		plugins: Object.fromEntries(
			[...plugins]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([plugin, table]) => [plugin, byName(table.values())]),
		),
		events: byName(events.values()),
		sidecar: [...sidecar.values()].sort(
			(a, b) => a.direction.localeCompare(b.direction) || a.method.localeCompare(b.method),
		),
		sql: [...sql.values()].sort((a, b) => a.statement.localeCompare(b.statement)),
		dynamic,
	};
}

/** The bundle's JavaScript chunks: every `.js` and `.mjs` file under `assets/`. */
export function readChunks(bundleDir: string): Chunk[] {
	const assets = join(bundleDir, "assets");
	return readdirSync(assets)
		.filter((name) => /\.m?js$/.test(name))
		.sort()
		.map((name) => ({ file: name, text: readFileSync(join(assets, name), "utf8") }));
}

/** One line per kind, for the console and the report. */
export function summarise(inventory: Inventory): string[] {
	const pluginCounts = Object.entries(inventory.plugins)
		.map(([plugin, entries]) => `${plugin} ${entries.length}`)
		.join(", ");
	const to = inventory.sidecar.filter((entry) => entry.direction === "to-sidecar");
	const from = inventory.sidecar.filter((entry) => entry.direction === "from-sidecar");
	return [
		`custom commands: ${inventory.commands.length}`,
		`plugin commands: ${Object.values(inventory.plugins).flat().length} (${pluginCounts})`,
		`sidecar methods: ${inventory.sidecar.length} (${to.length} sent, ${from.length} handled)`,
		`events listened to: ${inventory.events.length}`,
		`SQL statements: ${inventory.sql.length}`,
		`calls with a run-time name: ${inventory.dynamic.length}`,
	];
}

if (import.meta.main) {
	const [bundleDir, out] = process.argv.slice(2);
	if (bundleDir === undefined || out === undefined) {
		console.error("Usage: bun scripts/conductor-reference/inventory.ts <bundle-dir> <out.json>");
		process.exit(2);
	}
	const inventory = buildInventory(readChunks(bundleDir));
	writeFileSync(out, `${JSON.stringify(inventory, null, "\t")}\n`);
	for (const line of summarise(inventory)) console.log(line);
	console.log(`Written to ${out}`);
}
