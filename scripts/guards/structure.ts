/**
 * Guards over how the parts join: the Rust shell, the TypeScript that calls it, the migrations,
 * the tests and the composition roots. Each check reads the repo from a root folder and returns
 * a list of problems, so a test can run it on a sample tree.
 *  1. commands: every `#[tauri::command]` is in `generate_handler!`, every registered name is in
 *     the `COMMANDS` map of the Tauri adapter, and every name in that map is registered or tagged
 *     with a backlog row not yet done.
 *  2. programs: every literal program the UI starts is in `ALLOWED_PROGRAMS` (compared by file name).
 *  3. migration-list: the `.sql` files, the list in `db.rs` and `migrations.lock` agree.
 *  4. placeholder-tests: no test asserts placeholder text or reads a backlog row's status.
 *  5. test-only-exports: no exported function, component, hook or class is used by tests alone.
 *  6. unwired-deps: a composition root passes every optional dependency, or says it is unwired.
 * Guards 4 to 6 count violations per file against `structure-baseline.json`. A count may not
 * rise, and a baseline higher than the real count fails too, so every fix lowers it (D055).
 *
 * Usage: bun scripts/guards/structure.ts [--list] [--write-baseline]
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Node, SourceFile } from "typescript/unstable/ast";
import { SyntaxKind } from "typescript/unstable/ast";
import {
	isCallExpression,
	isClassDeclaration,
	isExportSpecifier,
	isFunctionDeclaration,
	isIdentifier,
	isImportSpecifier,
	isNewExpression,
	isObjectLiteralExpression,
	isVariableStatement,
} from "typescript/unstable/ast/is";
import {
	type Checker,
	ModifierFlags,
	SymbolFlags,
	type Type,
	TypeFlags,
} from "typescript/unstable/async";
import { scanBacklog } from "../issues/model.ts";
import { MIGRATIONS_DIR } from "./data-model.ts";
import { FEATURE_ID, isTestFile, type Problem, read, rel, walk } from "./lib.ts";
import { readLock } from "./migrations.ts";
import { fromRoot, normal, type OpenProject, withProjects } from "./ts-project.ts";

export const TAURI_SRC = "apps/desktop/src-tauri/src";
export const LIB_RS = `${TAURI_SRC}/lib.rs`;
export const SHELL_RS = `${TAURI_SRC}/shell.rs`;
export const DB_RS = `${TAURI_SRC}/db.rs`;
export const ADAPTER = "apps/desktop/src/platform/tauri.ts";
export const BACKLOG = "docs/plans/backlog.md";
export const BASELINE = "scripts/guards/structure-baseline.json";

/** One finding of a baseline guard: the file it belongs to and a name that points at it. */
export interface Violation {
	file: string;
	name: string;
}

/** Violation counts per guard and file. */
export type Baseline = Record<string, Record<string, number>>;

export const BASELINE_GUARDS = ["placeholder-tests", "test-only-exports", "unwired-deps"] as const;
type BaselineGuard = (typeof BASELINE_GUARDS)[number];

/** Backlog status by feature id. An unreadable backlog gives an empty map and a problem. */
function backlogStatus(
	root: string,
	guard: string,
): { status: Map<string, string>; problems: Problem[] } {
	const path = join(root, BACKLOG);
	if (!existsSync(path)) {
		return { status: new Map(), problems: [{ guard, message: `${BACKLOG} does not exist` }] };
	}
	const scan = scanBacklog(read(path));
	return {
		status: new Map(scan.rows.map((row) => [row.id, row.status])),
		problems: scan.problems.map((message) => ({ guard, message: `${BACKLOG}: ${message}` })),
	};
}

/** The `// ID` style tag in a text: the first feature id, or null. */
const featureIdIn = (text: string): string | null =>
	new RegExp(`\\b(${FEATURE_ID})\\b`).exec(text)?.[1] ?? null;

// ------------------------------------------------------------------- guard 1: commands

const COMMAND_FN =
	/#\[tauri::command(?:\([^)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/g;

/** The names of the functions that carry `#[tauri::command]` in one Rust source file. */
export function commandFunctions(source: string): string[] {
	return [...source.matchAll(COMMAND_FN)].map((match) => match[1] ?? "");
}

/** The command names listed in `tauri::generate_handler![...]`, or null when there is no list. */
export function registeredCommands(libSource: string): Set<string> | null {
	const block = /generate_handler!\s*\[([^\]]*)\]/.exec(libSource)?.[1];
	if (block === undefined) return null;
	const names = block
		.replace(/\/\/.*$/gm, "")
		.split(/[\s,]+/)
		.filter((name) => name !== "")
		.map((name) => name.split("::").pop() ?? name);
	return new Set(names);
}

export interface CommandEntry {
	key: string;
	name: string;
	/** The backlog id in a comment on the entry's line or the lines right above it. */
	tag: string | null;
}

/** The entries of `export const COMMANDS = { key: "name", ... }` in the Tauri adapter. */
export function commandEntries(adapterSource: string): CommandEntry[] | null {
	const block = /export const COMMANDS = \{([\s\S]*?)\n\}/.exec(adapterSource)?.[1];
	if (block === undefined) return null;
	const entries: CommandEntry[] = [];
	let above: string[] = [];
	for (const line of block.split("\n")) {
		const entry = /^\s*(\w+):\s*"([^"]+)",?\s*(?:\/\/(.*))?$/.exec(line);
		if (entry?.[1] && entry[2]) {
			const tag = featureIdIn(entry[3] ?? "") ?? featureIdIn(above.join(" "));
			entries.push({ key: entry[1], name: entry[2], tag });
			above = [];
		} else if (/^\s*\/\//.test(line) || /^\s*\*|^\s*\/\*/.test(line)) {
			above.push(line);
		} else {
			above = [];
		}
	}
	return entries;
}

export function checkTauriCommands(root: string): Problem[] {
	const guard = "commands";
	const problems: Problem[] = [];
	const libPath = join(root, LIB_RS);
	const adapterPath = join(root, ADAPTER);
	if (!existsSync(libPath)) return [{ guard, message: `${LIB_RS} does not exist` }];
	const registered = registeredCommands(read(libPath));
	if (registered === null) {
		return [{ guard, message: `${LIB_RS} has no tauri::generate_handler![...] list` }];
	}
	for (const path of walk(root, join(root, TAURI_SRC), /\.rs$/)) {
		for (const name of commandFunctions(read(path))) {
			if (!registered.has(name)) {
				problems.push({
					guard,
					message: `${rel(root, path)}: command ${name} is not in generate_handler! in ${LIB_RS}`,
				});
			}
		}
	}
	if (!existsSync(adapterPath))
		return [...problems, { guard, message: `${ADAPTER} does not exist` }];
	const entries = commandEntries(read(adapterPath));
	if (entries === null) return [...problems, { guard, message: `${ADAPTER} has no COMMANDS map` }];
	const { status, problems: backlogProblems } = backlogStatus(root, guard);
	problems.push(...backlogProblems);
	const named = new Set(entries.map((entry) => entry.name));
	for (const name of [...registered].sort()) {
		if (!named.has(name)) {
			problems.push({
				guard,
				message: `${LIB_RS} registers ${name}, which has no name in COMMANDS in ${ADAPTER}`,
			});
		}
	}
	for (const entry of entries) {
		if (registered.has(entry.name)) continue;
		const label = `COMMANDS.${entry.key} ("${entry.name}") in ${ADAPTER}`;
		if (entry.tag === null) {
			problems.push({
				guard,
				message: `${label} has no handler and no backlog tag: add a "// <ID>" comment naming its row`,
			});
			continue;
		}
		const state = status.get(entry.tag);
		if (state === undefined) {
			problems.push({
				guard,
				message: `${label} is tagged ${entry.tag}, which is not in ${BACKLOG}`,
			});
		} else if (state === "done") {
			problems.push({
				guard,
				message: `${label} has no handler, but its row ${entry.tag} is done`,
			});
		}
	}
	return problems;
}

// ------------------------------------------------------------------- guard 2: programs

/** The names in `ALLOWED_PROGRAMS`, or null when the list is missing. */
export function allowedPrograms(shellSource: string): Set<string> | null {
	const block = /ALLOWED_PROGRAMS:[^=]*=\s*&\[([^\]]*)\]/.exec(shellSource)?.[1];
	if (block === undefined) return null;
	return new Set([...block.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? ""));
}

/** Every `program: "<value>"` literal in a TypeScript source text. */
export function programLiterals(source: string): string[] {
	return [...source.matchAll(/\bprogram:\s*(["'`])([^"'`$\n]+)\1/g)].map((match) => match[2] ?? "");
}

export function checkShellPrograms(root: string): Problem[] {
	const guard = "programs";
	const shellPath = join(root, SHELL_RS);
	if (!existsSync(shellPath)) return [{ guard, message: `${SHELL_RS} does not exist` }];
	const allowed = allowedPrograms(read(shellPath));
	if (allowed === null) return [{ guard, message: `${SHELL_RS} has no ALLOWED_PROGRAMS list` }];
	const problems: Problem[] = [];
	for (const path of walk(root, join(root, "apps/desktop/src"), /\.tsx?$/)) {
		if (isTestFile(path)) continue;
		for (const program of new Set(programLiterals(read(path)))) {
			if (!allowed.has(basename(program))) {
				problems.push({
					guard,
					message: `${rel(root, path)} starts "${program}", which is not in ALLOWED_PROGRAMS in ${SHELL_RS}`,
				});
			}
		}
	}
	return problems;
}

// ------------------------------------------------------------------- guard 3: migration list

export interface ListedMigration {
	version: number;
	file: string;
}

/** The `Migration { version, sql: include_str!(...) }` entries in `db.rs`, in order. */
export function listedMigrations(dbSource: string): ListedMigration[] {
	return [
		...dbSource.matchAll(
			/Migration\s*\{[^}]*?version:\s*(\d+)[^}]*?include_str!\(\s*"[^"]*?([^"/]+\.sql)"\s*\)/g,
		),
	].map((match) => ({ version: Number(match[1]), file: match[2] ?? "" }));
}

export function checkMigrationList(root: string): Problem[] {
	const guard = "migration-list";
	const dbPath = join(root, DB_RS);
	const dir = join(root, MIGRATIONS_DIR);
	if (!existsSync(dbPath)) return [{ guard, message: `${DB_RS} does not exist` }];
	if (!existsSync(dir)) return [{ guard, message: `${MIGRATIONS_DIR} does not exist` }];
	const listed = listedMigrations(read(dbPath));
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".sql"))
		.sort();
	const locked = [...readLock(root).keys()];
	const problems: Problem[] = [];
	for (const file of files) {
		if (!listed.some((entry) => entry.file === file)) {
			problems.push({ guard, message: `${file} is not in migrations() in ${DB_RS}` });
		}
	}
	for (const entry of listed) {
		if (!files.includes(entry.file)) {
			problems.push({ guard, message: `${DB_RS} lists ${entry.file}, which does not exist` });
		}
		if (!locked.includes(entry.file)) {
			problems.push({
				guard,
				message: `${DB_RS} lists ${entry.file}, which is not in migrations.lock`,
			});
		}
		const prefix = Number(/^(\d+)_/.exec(entry.file)?.[1]);
		if (prefix !== entry.version) {
			problems.push({
				guard,
				message: `${DB_RS} gives ${entry.file} version ${entry.version}, but its file number is ${prefix}`,
			});
		}
	}
	listed.forEach((entry, index) => {
		if (entry.version !== index + 1) {
			problems.push({
				guard,
				message: `${DB_RS} lists ${entry.file} at position ${index + 1} with version ${entry.version}; versions count up from 1`,
			});
		}
	});
	return problems;
}

// ------------------------------------------------------------------- baseline

/** Compares per-file findings with the baseline: a rise fails, and so does a stale baseline. */
export function measureAgainst(
	guard: string,
	found: Violation[],
	baseline: Record<string, number>,
): Problem[] {
	const names = new Map<string, string[]>();
	for (const violation of found) {
		names.set(violation.file, [...(names.get(violation.file) ?? []), violation.name]);
	}
	const problems: Problem[] = [];
	for (const file of [...new Set([...names.keys(), ...Object.keys(baseline)])].sort()) {
		const actual = names.get(file)?.length ?? 0;
		const allowed = baseline[file] ?? 0;
		if (actual > allowed) {
			problems.push({
				guard,
				message: `${file} has ${actual} (baseline ${allowed}): ${(names.get(file) ?? []).join(", ")}`,
			});
		} else if (actual < allowed) {
			problems.push({
				guard,
				message: `${file} has ${actual}, but the baseline says ${allowed}: lower it with bun scripts/guards/structure.ts --write-baseline (D055)`,
			});
		}
	}
	return problems;
}

/** Reads the committed baseline. A missing file is an empty baseline. */
export function readBaseline(root: string): { baseline: Baseline; problems: Problem[] } {
	const path = join(root, BASELINE);
	if (!existsSync(path)) return { baseline: {}, problems: [] };
	try {
		return { baseline: JSON.parse(read(path)) as Baseline, problems: [] };
	} catch (error) {
		return {
			baseline: {},
			problems: [{ guard: "baseline", message: `${BASELINE} is not valid JSON: ${String(error)}` }],
		};
	}
}

const baselineFor = (
	root: string,
	guard: BaselineGuard,
): { counts: Record<string, number>; problems: Problem[] } => {
	const { baseline, problems } = readBaseline(root);
	return { counts: baseline[guard] ?? {}, problems };
};

/**
 * The baseline after a regeneration, and the entries that would rise. A first baseline may hold
 * any counts. Once one exists it may only shrink (D055), so a regeneration never raises a count.
 */
export function nextBaseline(
	current: Baseline | null,
	found: Record<BaselineGuard, Violation[]>,
): { baseline: Baseline; raised: string[] } {
	const baseline: Baseline = {};
	const raised: string[] = [];
	for (const guard of BASELINE_GUARDS) {
		const counts: Record<string, number> = {};
		for (const violation of found[guard])
			counts[violation.file] = (counts[violation.file] ?? 0) + 1;
		for (const [file, count] of Object.entries(counts)) {
			const before = current?.[guard]?.[file] ?? 0;
			if (current !== null && count > before)
				raised.push(`${guard}: ${file} ${before} -> ${count}`);
		}
		baseline[guard] = Object.fromEntries(
			Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
		);
	}
	return { baseline, raised };
}

// ------------------------------------------------------------------- guard 4: placeholder tests

const TEST_SCOPE = /^(apps\/desktop\/src|packages\/[^/]+\/src)\/.+\.test\.tsx?$/;
const PLACEHOLDER_TEXT = /Not built yet|Not implemented/;
/** The test of the placeholder itself: it has to name the text it checks. */
const PLACEHOLDER_HOME = "packages/shared/src/not-implemented.test.ts";
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;
const STATUS_READ = /\bstatusOf\s*\(|["'`](?:done|stub|planned)["'`]/;

/** The lines of a test file that assert placeholder text or read a backlog row's status. */
export function placeholderTestLines(source: string): number[] {
	const readsBacklog = /backlog\.md/.test(source);
	const lines: number[] = [];
	source.split("\n").forEach((line, index) => {
		if (COMMENT_LINE.test(line)) return;
		if (PLACEHOLDER_TEXT.test(line) || (readsBacklog && STATUS_READ.test(line)))
			lines.push(index + 1);
	});
	return lines;
}

export function scanPlaceholderTests(root: string): Violation[] {
	const found: Violation[] = [];
	for (const path of walk(root, root, TEST_SCOPE)) {
		const file = rel(root, path);
		if (file === PLACEHOLDER_HOME) continue;
		for (const line of placeholderTestLines(read(path))) found.push({ file, name: `line ${line}` });
	}
	return found;
}

export function checkPlaceholderTests(root: string): Problem[] {
	const { counts, problems } = baselineFor(root, "placeholder-tests");
	return [...problems, ...measureAgainst("placeholder-tests", scanPlaceholderTests(root), counts)];
}

// ------------------------------------------------------------------- guards 5 and 6: compiler

/** The packages whose exports guard 5 reads, with the tsconfig of each. */
export const EXPORT_PROJECTS = [
	{ config: "apps/desktop/tsconfig.json", src: "apps/desktop/src/" },
	{ config: "packages/sidecar/tsconfig.json", src: "packages/sidecar/src/" },
];

/** The composition roots guard 6 reads, with the tsconfig of each. */
export const ROOT_FILES = [
	{ config: "apps/desktop/tsconfig.json", file: "apps/desktop/src/core/container.ts" },
	{ config: "packages/sidecar/tsconfig.json", file: "packages/sidecar/src/modes/sidecar-mode.ts" },
];

/** A test, a spec or a helper under a `test` or `test-support` folder: code that exists to exercise other code. */
export const isTestPath = (path: string): boolean =>
	/\.(test|spec)\.tsx?$/.test(path) ||
	/(^|\/)src\/(test|test-support)\//.test(path) ||
	/(test-support|test-fixtures)\.tsx?$/.test(path);

const missingFiles = (root: string, guard: string, files: string[]): Problem[] =>
	files
		.filter((file) => !existsSync(join(root, file)))
		.map((file) => ({ guard, message: `${file} does not exist` }));

/** Turns a compiler failure (a project that will not open) into a problem instead of a crash. */
async function guarded(guard: string, work: () => Promise<Problem[]>): Promise<Problem[]> {
	try {
		return await work();
	} catch (error) {
		return [{ guard, message: `could not read the projects: ${String(error)}` }];
	}
}

interface Candidate {
	name: string;
	node: Node;
	file: string;
}

/** Wrappers whose result is a component: `memo(...)`, `forwardRef(...)`, `lazy(...)`. */
const COMPONENT_WRAPPERS = new Set(["memo", "forwardRef", "lazy"]);

/** The exported functions, classes and components of one source file. */
function exportedCandidates(sourceFile: SourceFile, file: string): Candidate[] {
	const found: Candidate[] = [];
	for (const statement of sourceFile.statements) {
		if (isFunctionDeclaration(statement) || isClassDeclaration(statement)) {
			if (statement.modifierFlags & ModifierFlags.Export && statement.name) {
				found.push({ name: statement.name.text, node: statement.name, file });
			}
		} else if (isVariableStatement(statement) && statement.modifierFlags & ModifierFlags.Export) {
			for (const declaration of statement.declarationList.declarations) {
				const init = declaration.initializer;
				if (!isIdentifier(declaration.name) || init === undefined) continue;
				const wrapped =
					isCallExpression(init) &&
					isIdentifier(init.expression) &&
					COMPONENT_WRAPPERS.has(init.expression.text);
				const isFunction =
					init.kind === SyntaxKind.ArrowFunction || init.kind === SyntaxKind.FunctionExpression;
				if (isFunction || wrapped) {
					found.push({ name: declaration.name.text, node: declaration.name, file });
				}
			}
		}
	}
	return found;
}

/** True for a reference that only moves a name along: an import or an export specifier. */
function isLinkNode(node: Node): boolean {
	const parent = node.parent;
	return (
		isImportSpecifier(parent) ||
		isExportSpecifier(parent) ||
		parent.kind === SyntaxKind.ImportClause ||
		parent.kind === SyntaxKind.NamespaceImport
	);
}

/** The feature a source file belongs to, from its `@feature` header tag. */
const fileFeature = (source: string): string | null =>
	new RegExp(`@feature\\s+(${FEATURE_ID})`).exec(source.slice(0, 4000))?.[1] ?? null;

async function scanProjectExports(
	root: string,
	open: OpenProject,
	src: string,
	status: Map<string, string>,
): Promise<Violation[]> {
	const found: Violation[] = [];
	const { project } = open;
	for (const absolute of open.files) {
		const file = fromRoot(root, absolute);
		if (!file.startsWith(src) || isTestPath(file) || file.endsWith(".d.ts")) continue;
		const sourceFile = await project.program.getSourceFile(absolute);
		if (sourceFile === undefined) continue;
		if (status.get(fileFeature(sourceFile.text) ?? "") === "stub") continue;
		for (const candidate of exportedCandidates(sourceFile, file)) {
			const entries = await project.checker.getReferencedSymbolsForNode(
				candidate.node,
				candidate.node.getStart(sourceFile),
			);
			let production = 0;
			let tests = 0;
			const seen = new Set<string>();
			for (const entry of entries) {
				for (const handle of entry.references) {
					const key = `${handle.path}:${handle.index}`;
					if (seen.has(key)) continue;
					seen.add(key);
					const node = await handle.resolve();
					if (node === undefined || isLinkNode(node)) continue;
					const sameSpot =
						normal(handle.path) === normal(sourceFile.path) &&
						node.getStart() === candidate.node.getStart(sourceFile);
					if (sameSpot) continue;
					if (isTestPath(normal(handle.path))) tests += 1;
					else production += 1;
				}
			}
			if (production === 0 && tests > 0) found.push({ file, name: candidate.name });
		}
	}
	return found;
}

/** Exported functions, components, hooks and classes whose only users are tests. */
export async function scanTestOnlyExports(root: string): Promise<Violation[]> {
	const { status } = backlogStatus(root, "test-only-exports");
	const configs = EXPORT_PROJECTS.filter((entry) => existsSync(join(root, entry.config)));
	return withProjects(
		root,
		configs.map((entry) => entry.config),
		async (projects) => {
			const found: Violation[] = [];
			for (const open of projects) {
				const src = EXPORT_PROJECTS.find((entry) => entry.config === open.config)?.src ?? "";
				found.push(...(await scanProjectExports(root, open, src, status)));
			}
			return found;
		},
	);
}

export async function checkTestOnlyExports(root: string): Promise<Problem[]> {
	const guard = "test-only-exports";
	const missing = missingFiles(
		root,
		guard,
		EXPORT_PROJECTS.map((entry) => entry.config),
	);
	if (missing.length > 0) return missing;
	const { counts, problems } = baselineFor(root, guard);
	return guarded(guard, async () => [
		...problems,
		...measureAgainst(guard, await scanTestOnlyExports(root), counts),
	]);
}

const UNWIRED = new RegExp(`//\\s*unwired:\\s*(${FEATURE_ID})`);

/** The nearest statement around a node, so its leading comments count as the call site's. */
function enclosingStatement(node: Node): Node {
	let current = node;
	while (
		current.parent !== undefined &&
		current.kind !== SyntaxKind.VariableStatement &&
		current.kind !== SyntaxKind.ExpressionStatement &&
		current.kind !== SyntaxKind.ReturnStatement &&
		current.kind !== SyntaxKind.SourceFile
	) {
		current = current.parent;
	}
	return current;
}

function* walkNodes(node: Node): Generator<Node> {
	yield node;
	const children: Node[] = [];
	node.forEachChild((child) => {
		children.push(child);
	});
	for (const child of children) yield* walkNodes(child);
}

/** Calls and `new` expressions that pass an object literal as their first argument. */
function* objectArgumentCalls(sourceFile: SourceFile): Generator<Node> {
	for (const node of walkNodes(sourceFile)) {
		if (isCallExpression(node) || isNewExpression(node)) {
			const first = node.arguments?.[0];
			if (first !== undefined && isObjectLiteralExpression(first)) yield node;
		}
	}
}

async function scanRootFile(
	root: string,
	open: OpenProject,
	file: string,
	status: Map<string, string>,
): Promise<Violation[]> {
	const found: Violation[] = [];
	const { project } = open;
	const sourceFile = await project.program.getSourceFile(join(root, file));
	if (sourceFile === undefined) throw new Error(`${file} is not part of ${open.config}`);
	const { checker } = project;
	for (const call of objectArgumentCalls(sourceFile)) {
		if (!(isCallExpression(call) || isNewExpression(call))) continue;
		const argument = call.arguments?.[0];
		if (argument === undefined) continue;
		const signature = await checker.getResolvedSignature(call);
		const declared = signature?.declaration?.path;
		// Only services this repo declares. A call into a library takes options, not dependencies.
		if (signature === undefined || declared === undefined || declared.includes("/node_modules/"))
			continue;
		if (!normal(declared).startsWith(normal(root))) continue;
		const parameter = await checker.getParameterType(signature, 0);
		const passedType = await checker.getTypeAtLocation(argument);
		if (parameter === undefined || passedType === undefined) continue;
		const passed = new Set(
			(await checker.getPropertiesOfType(passedType)).map((property) => property.name),
		);
		const missing: string[] = [];
		for (const property of await checker.getPropertiesOfType(parameter)) {
			if (!(property.flags & SymbolFlags.Optional) || passed.has(property.name)) continue;
			const type = await checker.getTypeOfSymbol(property);
			if (type !== undefined && (await isDependencyType(checker, type)))
				missing.push(property.name);
		}
		if (missing.length === 0) continue;
		const statement = enclosingStatement(call);
		const site = sourceFile.text.slice(statement.getFullStart(), statement.getEnd());
		const marker = UNWIRED.exec(site)?.[1];
		if (marker !== undefined && status.has(marker) && status.get(marker) !== "done") continue;
		const callee = call.expression.getText(sourceFile);
		for (const name of missing) found.push({ file, name: `${callee}.${name}` });
	}
	return found;
}

/** A dependency is an object or a function. A number, a string or a flag is an option. */
async function isDependencyType(checker: Checker, type: Type): Promise<boolean> {
	const stripped = (await checker.getNonNullableType(type)) ?? type;
	if (stripped.flags & (TypeFlags.Object | TypeFlags.Intersection)) return true;
	if (stripped.isUnionType()) {
		for (const member of (await stripped.getTypes()) ?? []) {
			if (member.flags & TypeFlags.Object) return true;
		}
	}
	return false;
}

/** Optional dependencies the composition roots leave out without an `// unwired: <ID>` marker. */
export async function scanUnwiredDeps(root: string): Promise<Violation[]> {
	const { status } = backlogStatus(root, "unwired-deps");
	const roots = ROOT_FILES.filter((entry) => existsSync(join(root, entry.file)));
	const configs = [...new Set(roots.map((entry) => entry.config))];
	return withProjects(root, configs, async (projects) => {
		const found: Violation[] = [];
		for (const entry of roots) {
			const open = projects.find((candidate) => candidate.config === entry.config);
			if (open !== undefined) found.push(...(await scanRootFile(root, open, entry.file, status)));
		}
		return found;
	});
}

export async function checkUnwiredDeps(root: string): Promise<Problem[]> {
	const guard = "unwired-deps";
	const missing = missingFiles(
		root,
		guard,
		ROOT_FILES.flatMap((entry) => [entry.config, entry.file]),
	);
	if (missing.length > 0) return missing;
	const { counts, problems } = baselineFor(root, guard);
	return guarded(guard, async () => [
		...problems,
		...measureAgainst(guard, await scanUnwiredDeps(root), counts),
	]);
}

// ------------------------------------------------------------------- command line

async function scanEverything(root: string): Promise<Record<BaselineGuard, Violation[]>> {
	return {
		"placeholder-tests": scanPlaceholderTests(root),
		"test-only-exports": await scanTestOnlyExports(root),
		"unwired-deps": await scanUnwiredDeps(root),
	};
}

if (import.meta.main) {
	const root = join(import.meta.dir, "../..");
	const found = await scanEverything(root);
	if (process.argv.includes("--list")) {
		for (const guard of BASELINE_GUARDS) {
			console.log(`${guard}: ${found[guard].length}`);
			for (const violation of found[guard]) console.log(`  ${violation.file}  ${violation.name}`);
		}
	}
	if (process.argv.includes("--write-baseline")) {
		const existing = existsSync(join(root, BASELINE)) ? readBaseline(root).baseline : null;
		const { baseline, raised } = nextBaseline(existing, found);
		if (raised.length > 0) {
			console.error(
				`A baseline may only shrink (D055). These counts would rise:\n  ${raised.join("\n  ")}`,
			);
			process.exit(1);
		}
		writeFileSync(join(root, BASELINE), `${JSON.stringify(baseline, null, "\t")}\n`);
		console.log(`Wrote ${BASELINE}`);
	}
}
