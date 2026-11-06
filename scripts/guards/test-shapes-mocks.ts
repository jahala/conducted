/**
 * The cross-file half of guard 11 (tests that cannot pass): a `vi.mock` factory that leaves out an
 * export which a module the test reaches imports. Vitest replaces the whole module with what the
 * factory returns and throws on the first use of a name it does not hold, so the test fails as
 * soon as that code runs. PR #308's first CI run met this twice: GIT-17's toast mock had no
 * `Toaster`, which the app's providers render, and NAV-03's hooks mock lost a hook the sidebar had
 * started to use.
 *
 * - A factory counts only when it returns an object literal whose keys can all be listed. A spread
 *   (`...await importOriginal()`), a computed key or any other value is skipped: the guard cannot
 *   see what it holds.
 * - The test reaches every module it imports, and what those import, through value imports and
 *   re-exports. A mocked module is never entered, because Vitest never loads it.
 * - A namespace import or `export *` of the mocked module names no single export, so it is
 *   skipped. Dynamic `import()` is not followed.
 * - One finding per missing name, at the `vi.mock` call, naming the first module (by path) that
 *   imports it.
 *
 * Everything here is a pure function of parsed files.
 */
import {
	type CallExpression,
	type Node,
	type SourceFile,
	SyntaxKind,
} from "typescript/unstable/ast";
import {
	isArrowFunction,
	isBlock,
	isCallExpression,
	isExportDeclaration,
	isFunctionExpression,
	isIdentifier,
	isImportDeclaration,
	isMethodDeclaration,
	isNamedExports,
	isNamedImports,
	isNamespaceImport,
	isObjectLiteralExpression,
	isPropertyAssignment,
	isReturnStatement,
	isShorthandPropertyAssignment,
	isStringLiteral,
} from "typescript/unstable/ast/is";
import type { Violation } from "./test-shapes.ts";
import { chainNames, lineIn, stringValue, unwrap, visit } from "./test-shapes-ts.ts";

/** What one import or re-export takes from a module: named exports, or no single name. */
export interface ModuleLink {
	spec: string;
	/** Export names taken by name; `null` for a namespace import or `export *`. */
	names: string[] | null;
}

/** A `vi.mock` call with a factory whose returned keys can all be listed. */
export interface MockFactory {
	spec: string;
	call: CallExpression;
	keys: Set<string>;
}

const VITEST_MOCKS = new Set(["vi.mock", "vi.doMock"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

const nameText = (node: Node): string | undefined => {
	if (isIdentifier(node) || isStringLiteral(node)) return node.text;
	return undefined;
};

/** The value imports and re-exports of a file. Type-only ones load nothing, so they are left out. */
export function moduleLinks(sf: SourceFile): ModuleLink[] {
	const links: ModuleLink[] = [];
	for (const statement of sf.statements) {
		if (isImportDeclaration(statement)) {
			const spec = stringValue(statement.moduleSpecifier);
			if (spec === undefined) continue;
			const clause = statement.importClause;
			if (clause === undefined) {
				links.push({ spec, names: [] });
				continue;
			}
			if (clause.phaseModifier === SyntaxKind.TypeKeyword) continue;
			const names: string[] = [];
			if (clause.name !== undefined) names.push("default");
			const bindings = clause.namedBindings;
			if (bindings !== undefined && isNamespaceImport(bindings)) {
				links.push({ spec, names: null });
				continue;
			}
			if (bindings !== undefined && isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					if (element.isTypeOnly) continue;
					const name = nameText(element.propertyName ?? element.name);
					if (name !== undefined) names.push(name);
				}
			}
			links.push({ spec, names });
		} else if (isExportDeclaration(statement) && !statement.isTypeOnly) {
			const spec = stringValue(statement.moduleSpecifier);
			if (spec === undefined) continue;
			const clause = statement.exportClause;
			if (clause === undefined || !isNamedExports(clause)) {
				links.push({ spec, names: null });
				continue;
			}
			const names: string[] = [];
			for (const element of clause.elements) {
				if (element.isTypeOnly) continue;
				const name = nameText(element.propertyName ?? element.name);
				if (name !== undefined) names.push(name);
			}
			links.push({ spec, names });
		}
	}
	return links;
}

/** The object a factory returns, when it returns an object literal. */
function returnedObject(factory: Node): Node | undefined {
	const fn = unwrap(factory);
	if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return undefined;
	const body = fn.body;
	if (!isBlock(body)) {
		const value = unwrap(body);
		return isObjectLiteralExpression(value) ? value : undefined;
	}
	const last = [...body.statements].reverse().find((statement) => isReturnStatement(statement));
	if (last === undefined || !isReturnStatement(last) || last.expression === undefined) {
		return undefined;
	}
	const value = unwrap(last.expression);
	return isObjectLiteralExpression(value) ? value : undefined;
}

/** Every key of an object literal, or `undefined` when one cannot be listed (a spread, a computed key). */
function listedKeys(object: Node): Set<string> | undefined {
	if (!isObjectLiteralExpression(object)) return undefined;
	const keys = new Set<string>();
	for (const property of object.properties) {
		let name: string | undefined;
		if (
			isPropertyAssignment(property) ||
			isShorthandPropertyAssignment(property) ||
			isMethodDeclaration(property)
		) {
			name = nameText(property.name);
		}
		if (name === undefined) return undefined;
		keys.add(name);
	}
	return keys;
}

/** The `vi.mock(spec, factory)` calls of a file whose factory returns keys that can all be listed. */
export function mockFactories(sf: SourceFile): MockFactory[] {
	const found: MockFactory[] = [];
	visit(sf, (node) => {
		if (!isCallExpression(node)) return;
		if (!VITEST_MOCKS.has(chainNames(node.expression).join("."))) return;
		const spec = stringValue(node.arguments[0]);
		const factory = node.arguments[1];
		if (spec === undefined || factory === undefined) return;
		const object = returnedObject(factory);
		const keys = object === undefined ? undefined : listedKeys(object);
		if (keys !== undefined) found.push({ spec, call: node, keys });
	});
	return found;
}

const normalise = (path: string): string => {
	const out: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return out.join("/");
};

/**
 * The repository file a relative specifier names, or `undefined` for a package or a file that is
 * not in `files`. `files` holds paths from the repository root.
 */
export function resolveModule(
	from: string,
	spec: string,
	files: ReadonlySet<string>,
): string | undefined {
	if (!spec.startsWith(".")) return undefined;
	const base = normalise(`${from.split("/").slice(0, -1).join("/")}/${spec}`);
	const candidates = [
		base,
		...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
		...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
	];
	return candidates.find((candidate) => files.has(candidate));
}

/**
 * The gaps of one test file's mocks. `linksOf` gives a file's links, `files` every parsed path.
 * Returns one violation per missing name, sorted by line and name.
 */
export function findMockGaps(
	test: string,
	sf: SourceFile,
	files: ReadonlySet<string>,
	linksOf: (file: string) => ModuleLink[],
): Violation[] {
	const mocks = mockFactories(sf)
		.map((mock) => ({ ...mock, target: resolveModule(test, mock.spec, files) }))
		.filter((mock): mock is MockFactory & { target: string } => mock.target !== undefined);
	if (mocks.length === 0) return [];
	const mocked = new Set(mocks.map((mock) => mock.target));

	// Every module the test loads, and what each imports from each mocked module.
	const reached = new Set<string>([test]);
	const takes = new Map<string, Map<string, string>>();
	const queue = [test];
	for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
		for (const link of linksOf(file)) {
			const target = resolveModule(file, link.spec, files);
			if (target === undefined) continue;
			if (mocked.has(target)) {
				const names = takes.get(target) ?? new Map<string, string>();
				for (const name of link.names ?? []) {
					const earlier = names.get(name);
					if (earlier === undefined || file < earlier) names.set(name, file);
				}
				takes.set(target, names);
			} else if (!reached.has(target)) {
				reached.add(target);
				queue.push(target);
			}
		}
	}

	const found: Violation[] = [];
	for (const mock of mocks) {
		const imported = takes.get(mock.target) ?? new Map<string, string>();
		for (const [name, importer] of [...imported].sort(([a], [b]) => (a < b ? -1 : 1))) {
			if (mock.keys.has(name)) continue;
			found.push({
				guard: "tests-cannot-pass",
				check: "mock-gap",
				file: test,
				line: lineIn(sf, mock.call),
				message: `mocks ${mock.spec} without ${name}, which ${importer} imports; Vitest throws when that code runs. Start the factory from importOriginal() or render over createTestContainer`,
			});
		}
	}
	return found;
}
