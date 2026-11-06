/**
 * The TypeScript half of the test-shapes guards: it reads one parsed test file and lists the
 * places where a test cannot fail, mocks the thing it tests, defines a stand-in outside its home,
 * depends on real time or leaked state, or looks for text that can never match (guard 11, whose
 * cross-file half is test-shapes-mocks.ts). The parse tree comes from the TypeScript compiler
 * API; nothing here reads the disk, so every function is a pure function of one parsed file.
 */
import {
	type CallExpression,
	type Expression,
	type Node,
	type SourceFile,
	SyntaxKind,
} from "typescript/unstable/ast";
import {
	isArrayLiteralExpression,
	isArrowFunction,
	isAsExpression,
	isBlock,
	isCallExpression,
	isClassDeclaration,
	isClassExpression,
	isElementAccessExpression,
	isFunctionDeclaration,
	isFunctionExpression,
	isIdentifier,
	isImportDeclaration,
	isNamedImports,
	isNamespaceImport,
	isNonNullExpression,
	isNoSubstitutionTemplateLiteral,
	isNumericLiteral,
	isObjectLiteralExpression,
	isParenthesizedExpression,
	isPrefixUnaryExpression,
	isPropertyAccessExpression,
	isPropertyAssignment,
	isReturnStatement,
	isSatisfiesExpression,
	isStringLiteral,
	isTemplateExpression,
	isTryStatement,
	isTypeReferenceNode,
	isVariableDeclaration,
} from "typescript/unstable/ast/is";
import type { GuardName, Violation } from "./test-shapes.ts";

/** Homes for stand-ins: the only folders where a `Fake*` or `Memory*` may be defined. */
export const STAND_IN_HOMES = ["apps/desktop/src/test/", "packages/sidecar/src/test-support/"];

const SEAM_COMMENT = /\/\/\s*seam:\s*[A-Z]+-\d+\s+\S/;
const CONTRACT_LINE = /Contract test:\s*(\S+)/;
/** An exported value: SCREAMING_CASE or camelCase. PascalCase names are components and classes. */
const CONSTANT_NAME = /^(?:[A-Z][A-Z0-9_]{2,}|[a-z]\w*)$/;
const ASSERT_NAME = /^(expect|assert)/i;
const TEST_NAMES = new Set(["it", "test"]);
const HOOK_NAMES = new Set(["afterEach", "afterAll", "after"]);
const VALUE_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);
const REMOVAL_NAMES = new Set(["rm", "rmSync", "rmdir", "rmdirSync", "trash", "removeSync"]);
const RESTORE_NAMES = new Set([
	"mockRestore",
	"restoreAllMocks",
	"unstubAllGlobals",
	"unstubAllEnvs",
]);
const ID_SOURCE_NAME =
	/^(uuid|newUuid|newId|nextId|genId|generateId|createId|makeId|randomUUID|uuidv4|id)$/;
const MOCK_CALLEES = new Set(["vi.mock", "vi.doMock", "mock.module", "jest.mock"]);
const STAND_IN_PASCAL = /^(make|create)?(Fake|Memory)[A-Z0-9]/;
const STAND_IN_CAMEL = /^(make|create)?memory[A-Z]/;
const GIT_RUNNER_NAME = /^(fake|make|create|build)(Git)?(Runner|Git)$/i;
const FILE_SYSTEM_NAME = /^(fake|memory|mock|make|create)(Fs|FileSystem)$/i;
const STAND_IN_INTERFACES = new Set(["GitRunner", "Database", "Platform", "FileSystem"]);

/** What the analysis knows about the file it reads. */
export interface FileFacts {
	/** Path from the repository root, with forward slashes. */
	rel: string;
	sf: SourceFile;
	lines: string[];
	/** True for a `.test.ts(x)` file. */
	isTest: boolean;
	/** True when the file sits in a stand-in home. */
	inHome: boolean;
	/** Local import name to the module specifier it came from. */
	imports: Map<string, string>;
	/** First dotted part of the file name: the module this test is about. */
	subject: string;
}

type Found = { guard: GuardName; check: string; node: Node; message: string };

// ---------------------------------------------------------------------------------------------
// Small tree helpers.

export function visit(node: Node, enter: (node: Node) => void): void {
	enter(node);
	node.forEachChild((child) => {
		visit(child, enter);
		return undefined;
	});
}

/** The 1-based line a node starts on. */
export const lineIn = (sf: SourceFile, node: Node): number => {
	const start = node.getStart(sf);
	const starts = sf.getLineStarts();
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if ((starts[mid] ?? 0) <= start) low = mid;
		else high = mid - 1;
	}
	return low + 1;
};

const textOf = (node: Node, facts: FileFacts): string => node.getText(facts.sf);

const lineOf = (facts: FileFacts, node: Node): number => lineIn(facts.sf, node);

/** Strips parentheses, `as`, `satisfies` and `!` so shape checks see the value itself. */
export function unwrap(node: Node): Node {
	let current = node;
	for (;;) {
		if (
			isParenthesizedExpression(current) ||
			isAsExpression(current) ||
			isSatisfiesExpression(current) ||
			isNonNullExpression(current)
		) {
			current = current.expression;
		} else return current;
	}
}

/** `a.b.c(x)` gives `["a", "b", "c"]`: the names along a call or member chain, root first. */
export function chainNames(node: Node): string[] {
	const current = unwrap(node);
	if (isIdentifier(current)) return [current.text];
	if (isPropertyAccessExpression(current)) {
		return [...chainNames(current.expression), current.name.getText()];
	}
	if (isCallExpression(current)) return chainNames(current.expression);
	if (isElementAccessExpression(current)) return chainNames(current.expression);
	return [];
}

const calleeName = (call: CallExpression): string => {
	const callee = unwrap(call.expression);
	if (isIdentifier(callee)) return callee.text;
	if (isPropertyAccessExpression(callee)) return callee.name.getText();
	return "";
};

const isFunctionLike = (node: Node): boolean => isArrowFunction(node) || isFunctionExpression(node);

export const stringValue = (node: Node | undefined): string | undefined => {
	if (node === undefined) return undefined;
	const value = unwrap(node);
	if (isStringLiteral(value) || isNoSubstitutionTemplateLiteral(value)) return value.text;
	return undefined;
};

/** True for a value that is written out in full: strings, numbers, booleans, null and nests of them. */
function isLiteralValue(node: Node): boolean {
	const value = unwrap(node);
	if (isStringLiteral(value) || isNoSubstitutionTemplateLiteral(value) || isNumericLiteral(value))
		return true;
	if (
		value.kind === SyntaxKind.TrueKeyword ||
		value.kind === SyntaxKind.FalseKeyword ||
		value.kind === SyntaxKind.NullKeyword
	)
		return true;
	if (isPrefixUnaryExpression(value)) return isLiteralValue(value.operand);
	if (isArrayLiteralExpression(value)) return value.elements.every((item) => isLiteralValue(item));
	if (isObjectLiteralExpression(value)) {
		return value.properties.every(
			(property) => isPropertyAssignment(property) && isLiteralValue(property.initializer),
		);
	}
	return false;
}

/** The identifier a plain member chain starts at, or `undefined` when a call is in the way. */
function plainChainRoot(node: Node): string | undefined {
	const current = unwrap(node);
	if (isIdentifier(current)) return current.text;
	if (isPropertyAccessExpression(current) || isElementAccessExpression(current))
		return plainChainRoot(current.expression);
	return undefined;
}

// ---------------------------------------------------------------------------------------------
// Tests, hooks and assertions.

interface TestCase {
	call: CallExpression;
	body: Node;
	title: string;
}

const TEST_MODIFIERS = new Set([
	"skip",
	"only",
	"concurrent",
	"sequential",
	"fails",
	"failing",
	"todo",
	"skipIf",
	"runIf",
	"each",
]);

/** True when the call is `it("title", fn)`, `it.skip(...)`, `it.each(rows)("title", fn)` and the like. */
function isTestCall(call: CallExpression): boolean {
	let callee: Node = unwrap(call.expression);
	if (isCallExpression(callee)) callee = unwrap(callee.expression);
	const names = chainNames(callee);
	const root = names[0] ?? "";
	if (!TEST_NAMES.has(root) || names.length > 2) return false;
	if (names.length === 2 && !TEST_MODIFIERS.has(names[1] ?? "")) return false;
	const title = call.arguments[0];
	return title !== undefined && (stringValue(title) !== undefined || isTemplateExpression(title));
}

function testCases(sf: SourceFile): TestCase[] {
	const found: TestCase[] = [];
	visit(sf, (node) => {
		if (!isCallExpression(node) || !isTestCall(node)) return;
		if (["skip", "todo"].includes(chainNames(node.expression)[1] ?? "")) return;
		const callback = node.arguments.at(-1);
		if (callback === undefined || !isFunctionLike(callback)) return;
		found.push({ call: node, body: callback, title: stringValue(node.arguments[0]) ?? "" });
	});
	return found;
}

/** Names of functions defined in this file whose body asserts, directly or through another. */
function assertingFunctions(sf: SourceFile): Set<string> {
	const bodies = new Map<string, Node>();
	visit(sf, (node) => {
		if (isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
			bodies.set(node.name.text, node.body);
		} else if (isVariableDeclaration(node) && isIdentifier(node.name) && node.initializer) {
			const init = unwrap(node.initializer);
			if (isFunctionLike(init)) bodies.set(node.name.text, init);
		} else if (node.kind === SyntaxKind.MethodDeclaration) {
			const method = node as unknown as { name: Node; body?: Node };
			if (method.body !== undefined) bodies.set(method.name.getText(sf), method.body);
		}
	});
	const asserting = new Set<string>();
	for (let changed = true; changed; ) {
		changed = false;
		for (const [name, body] of bodies) {
			if (asserting.has(name)) continue;
			if (containsAssertion(body, asserting)) {
				asserting.add(name);
				changed = true;
			}
		}
	}
	return asserting;
}

/** True when the subtree calls expect or assert, throws, or calls a function known to assert. */
function containsAssertion(root: Node, asserting: Set<string>): boolean {
	let found = false;
	visit(root, (node) => {
		if (found) return;
		if (node.kind === SyntaxKind.ThrowStatement) found = true;
		if (!isCallExpression(node)) return;
		const names = chainNames(node);
		const last = calleeName(node);
		if (
			ASSERT_NAME.test(names[0] ?? "") ||
			ASSERT_NAME.test(last) ||
			/^(getBy|getAllBy|findBy|findAllBy)/.test(last) ||
			last === "waitFor" ||
			last === "fail" ||
			last === "reject" ||
			asserting.has(last)
		)
			found = true;
	});
	return found;
}

/** `expect(subject).matcher(args)` pieces, or `undefined` when the call is something else. */
function expectChain(
	call: CallExpression,
): { subject: Expression; matcher: string; negated: boolean } | undefined {
	const callee = unwrap(call.expression);
	if (!isPropertyAccessExpression(callee)) return undefined;
	let inner: Node = unwrap(callee.expression);
	let negated = false;
	while (isPropertyAccessExpression(inner)) {
		const name = inner.name.getText();
		if (name === "not") negated = !negated;
		else if (name !== "resolves" && name !== "rejects") return undefined;
		inner = unwrap(inner.expression);
	}
	if (!isCallExpression(inner)) return undefined;
	const head = unwrap(inner.expression);
	if (!isIdentifier(head) || head.text !== "expect") return undefined;
	const subject = inner.arguments[0];
	if (subject === undefined) return undefined;
	return { subject, matcher: callee.name.getText(), negated };
}

function expectCalls(
	root: Node,
): { call: CallExpression; subject: Expression; matcher: string; negated: boolean }[] {
	const found: { call: CallExpression; subject: Expression; matcher: string; negated: boolean }[] =
		[];
	visit(root, (node) => {
		if (!isCallExpression(node)) return;
		const chain = expectChain(node);
		if (chain !== undefined) found.push({ call: node, ...chain });
	});
	return found;
}

// ---------------------------------------------------------------------------------------------
// Guard 7: tests that cannot fail.

function numericValue(node: Node | undefined): number | undefined {
	if (node === undefined) return undefined;
	const value = unwrap(node);
	if (isNumericLiteral(value)) return Number(value.text);
	return undefined;
}

/** The root name plus every variable the test builds from it: an empty source gives an empty copy. */
function derivedNames(body: Node, rootName: string): Set<string> {
	const names = new Set([rootName]);
	for (let changed = true; changed; ) {
		changed = false;
		visit(body, (node) => {
			if (
				!isVariableDeclaration(node) ||
				!isIdentifier(node.name) ||
				node.initializer === undefined
			)
				return;
			if (names.has(node.name.text)) return;
			visit(node.initializer, (inner) => {
				if (isIdentifier(inner) && names.has(inner.text) && !names.has(node.name.getText())) {
					names.add(node.name.getText());
					changed = true;
				}
			});
		});
	}
	return names;
}

/** Does this test prove the collection is not empty? */
function provesNonEmpty(body: Node, rootName: string, facts: FileFacts): boolean {
	const names = derivedNames(body, rootName);
	return expectCalls(body).some(({ call, subject, matcher, negated }) => {
		let mentions = false;
		visit(subject, (node) => {
			if (isIdentifier(node) && names.has(node.text)) mentions = true;
		});
		if (!mentions) return false;
		const arg = call.arguments[0];
		const subjectText = textOf(subject, facts);
		const sizeSubject = /\.(length|size|count)\b/.test(subjectText);
		// expect(list.some(...)).toBe(true) finds a member, so the list is not empty.
		if (/\.(some|find|includes|indexOf|findIndex)\(/.test(subjectText) && !negated) {
			const isFalse = arg !== undefined && unwrap(arg).kind === SyntaxKind.FalseKeyword;
			if (!isFalse && matcher !== "toBeFalsy" && matcher !== "toBeUndefined") return true;
		}
		if (matcher === "toHaveLength")
			return negated ? numericValue(arg) === 0 : numericValue(arg) !== 0;
		if (matcher === "toBeGreaterThan") return !negated;
		if (matcher === "toBeGreaterThanOrEqual") return !negated && (numericValue(arg) ?? 0) >= 1;
		if (matcher === "toContain" || matcher === "toContainEqual") return !negated;
		if (matcher === "toBeTruthy") return !negated && sizeSubject;
		if (negated && (matcher === "toEqual" || matcher === "toStrictEqual" || matcher === "toBe")) {
			return (
				numericValue(arg) === 0 || (arg !== undefined && isArrayLiteralExpression(unwrap(arg)))
			);
		}
		if (VALUE_MATCHERS.has(matcher)) {
			if (sizeSubject) return numericValue(arg) !== 0;
			const value = arg === undefined ? undefined : unwrap(arg);
			return value !== undefined && isArrayLiteralExpression(value) && value.elements.length > 0;
		}
		return false;
	});
}

/** The identifier a collection expression is read from: `Object.keys(map)` gives `map`. */
function collectionRoot(node: Node): string | undefined {
	let current = unwrap(node);
	for (;;) {
		if (isCallExpression(current)) {
			const callee = unwrap(current.expression);
			const names = chainNames(callee);
			if ((names[0] === "Object" || names[0] === "Array") && current.arguments[0] !== undefined) {
				current = unwrap(current.arguments[0]);
			} else if (isPropertyAccessExpression(callee)) {
				current = unwrap(callee.expression);
			} else if (isIdentifier(callee) && current.arguments[0] !== undefined) {
				current = unwrap(current.arguments[0]);
			} else return undefined;
		} else if (current.kind === SyntaxKind.SpreadElement) {
			return undefined;
		} else if (isArrayLiteralExpression(current)) {
			const first = current.elements[0];
			if (first !== undefined && first.kind === SyntaxKind.SpreadElement) {
				current = unwrap((first as unknown as { expression: Node }).expression);
			} else return undefined;
		} else return plainChainRoot(current);
	}
}

/** True when an identifier is declared in this file as a non-empty array or object literal. */
function declaredNonEmpty(sf: SourceFile, name: string, asObject: boolean): boolean {
	let result = false;
	visit(sf, (node) => {
		if (!isVariableDeclaration(node) || !isIdentifier(node.name) || node.name.text !== name) return;
		if (node.initializer === undefined) return;
		const init = unwrap(node.initializer);
		if (!asObject && isArrayLiteralExpression(init) && init.elements.length > 0) result = true;
		if (asObject && isObjectLiteralExpression(init) && init.properties.length > 0) result = true;
	});
	return result;
}

/** Literal collections are never empty. */
function isNonEmptyLiteral(node: Node): boolean {
	const value = unwrap(node);
	if (isArrayLiteralExpression(value)) return value.elements.length > 0;
	if (isObjectLiteralExpression(value)) return value.properties.length > 0;
	if (isCallExpression(value)) {
		const arg = value.arguments[0];
		return (
			chainNames(value.expression)[0] === "Object" && arg !== undefined && isNonEmptyLiteral(arg)
		);
	}
	return false;
}

function findEmptyLoops(test: TestCase, facts: FileFacts, found: Found[]): void {
	const check = (collection: Node, at: Node): void => {
		if (isNonEmptyLiteral(collection)) return;
		// getAllBy* and findAllBy* throw when nothing matches, so the loop cannot run empty.
		if (/\b(getAllBy|findAllBy)/.test(textOf(collection, facts))) return;
		const rootName = collectionRoot(collection);
		if (rootName === undefined) return;
		const viaObject =
			isCallExpression(unwrap(collection)) && chainNames(collection)[0] === "Object";
		if (declaredNonEmpty(facts.sf, rootName, viaObject)) return;
		if (provesNonEmpty(test.body, rootName, facts)) return;
		found.push({
			guard: "tests-cannot-fail",
			check: "empty-loop",
			node: at,
			message: `asserts over ${textOf(collection, facts)} with no check that it is not empty`,
		});
	};
	const none = new Set<string>();
	visit(test.body, (node) => {
		if (node.kind === SyntaxKind.ForOfStatement || node.kind === SyntaxKind.ForInStatement) {
			const loop = node as unknown as { expression: Node; statement: Node };
			if (containsAssertion(loop.statement, none)) check(loop.expression, node);
		} else if (node.kind === SyntaxKind.ForStatement) {
			const loop = node as unknown as { condition?: Node; statement: Node };
			const condition = loop.condition === undefined ? undefined : unwrap(loop.condition);
			if (
				condition !== undefined &&
				condition.kind === SyntaxKind.BinaryExpression &&
				containsAssertion(loop.statement, none)
			) {
				const right = unwrap((condition as unknown as { right: Node }).right);
				if (isPropertyAccessExpression(right) && right.name.getText() === "length")
					check(right.expression, node);
			}
		} else if (isCallExpression(node)) {
			const callee = unwrap(node.expression);
			if (!isPropertyAccessExpression(callee)) return;
			const name = callee.name.getText();
			const callback = node.arguments[0];
			if (name === "forEach" && callback !== undefined && isFunctionLike(callback)) {
				if (containsAssertion(callback, none)) check(callee.expression, node);
			} else if (name === "every") {
				const parent = node.parent;
				const head =
					parent === undefined || !isCallExpression(parent) ? undefined : unwrap(parent.expression);
				if (head !== undefined && isIdentifier(head) && head.text === "expect")
					check(callee.expression, node);
			}
		}
	});
}

/** Is `name` imported from the module this test file is about? */
function importedFromSubject(facts: FileFacts, name: string): boolean {
	const spec = facts.imports.get(name);
	if (spec === undefined || !spec.startsWith(".")) return false;
	const base = spec
		.split("/")
		.at(-1)
		?.replace(/\.(tsx?|jsx?)$/, "");
	const folder = spec.split("/").slice(0, -1).join("/");
	return base === facts.subject && (folder === "." || folder === "");
}

function findValueEchoes(facts: FileFacts, found: Found[]): void {
	visit(facts.sf, (node) => {
		if (!isCallExpression(node)) return;
		const chain = expectChain(node);
		if (chain === undefined || !VALUE_MATCHERS.has(chain.matcher)) return;
		const expected = node.arguments[0];
		if (expected === undefined) return;
		const actualRoot = plainChainRoot(chain.subject);
		const expectedRoot = plainChainRoot(expected);
		if (
			actualRoot !== undefined &&
			CONSTANT_NAME.test(actualRoot) &&
			importedFromSubject(facts, actualRoot) &&
			isLiteralValue(expected)
		) {
			found.push({
				guard: "tests-cannot-fail",
				check: "constant-echo",
				node,
				message: `expects the constant ${actualRoot}, imported from the module under test, to equal a literal`,
			});
		} else if (
			expectedRoot !== undefined &&
			CONSTANT_NAME.test(expectedRoot) &&
			importedFromSubject(facts, expectedRoot)
		) {
			found.push({
				guard: "tests-cannot-fail",
				check: "imported-expected",
				node,
				message: `expects ${expectedRoot}, a constant imported from the module under test`,
			});
		}
	});
}

function guardTestsCannotFail(facts: FileFacts, found: Found[]): void {
	const asserting = assertingFunctions(facts.sf);
	for (const test of testCases(facts.sf)) {
		if (!containsAssertion(test.body, asserting)) {
			found.push({
				guard: "tests-cannot-fail",
				check: "no-assertion",
				node: test.call,
				message: `test "${test.title}" has no expect or assert`,
			});
		}
		findEmptyLoops(test, facts, found);
	}
	findValueEchoes(facts, found);
}

// ---------------------------------------------------------------------------------------------
// Guard 8: mocking the thing.

const stripExtension = (path: string): string => path.replace(/\.(tsx?|jsx?|mjs)$/, "");

function normalise(path: string): string {
	const out: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return out.join("/");
}

function resolveSpec(rel: string, spec: string): string {
	const folder = rel.split("/").slice(0, -1).join("/");
	return stripExtension(normalise(`${folder}/${spec}`));
}

function guardMockingTheThing(facts: FileFacts, found: Found[]): void {
	const folder = facts.rel.split("/").slice(0, -1).join("/");
	const isComponentTest = facts.rel.endsWith(".tsx");
	visit(facts.sf, (node) => {
		if (isCallExpression(node)) {
			const callee = chainNames(node.expression).join(".");
			const spec = stringValue(node.arguments[0]);
			if (MOCK_CALLEES.has(callee) && spec?.startsWith(".")) {
				const resolved = resolveSpec(facts.rel, spec);
				const resolvedFolder = resolved.split("/").slice(0, -1).join("/");
				const resolvedBase = resolved.split("/").at(-1);
				if (resolvedFolder === folder && resolvedBase === facts.subject) {
					found.push({
						guard: "mocking-the-thing",
						check: "mocks-subject",
						node,
						message: `mocks ${spec}, the module this test is about`,
					});
				} else if (
					resolved === "apps/desktop/src/core/hooks" ||
					resolved === "apps/desktop/src/core/context"
				) {
					if (isComponentTest || !facts.rel.startsWith("apps/desktop/src/core/")) {
						found.push({
							guard: "mocking-the-thing",
							check: "mocks-core",
							node,
							message: `mocks ${spec}; a component test uses createTestContainer instead`,
						});
					}
				} else if (resolvedFolder === folder || resolved.startsWith(`${folder}/`)) {
					found.push({
						guard: "mocking-the-thing",
						check: "mocks-neighbour",
						node,
						message: `mocks ${spec}, a module in the test's own folder`,
					});
				}
			}
		} else if (isAsExpression(node)) {
			const type = node.type;
			const typeName = isTypeReferenceNode(type) ? type.typeName.getText() : "";
			const operand = unwrap(node.expression);
			const viaUnknown =
				isAsExpression(node.expression) && node.expression.type.kind === SyntaxKind.UnknownKeyword;
			if (typeName === "Container" && (viaUnknown || isObjectLiteralExpression(operand))) {
				found.push({
					guard: "mocking-the-thing",
					check: "hand-cast-container",
					node,
					message: "casts a hand-built object to Container; use createTestContainer",
				});
			} else if (/Deps$/.test(typeName)) {
				found.push({
					guard: "mocking-the-thing",
					check: "hand-cast-deps",
					node,
					message: `casts a hand-built object to ${typeName}`,
				});
			} else if (
				type.kind === SyntaxKind.NeverKeyword &&
				isObjectLiteralExpression(operand) &&
				operand.properties.some(
					(property) => isPropertyAssignment(property) && property.name.getText() === "services",
				)
			) {
				found.push({
					guard: "mocking-the-thing",
					check: "hand-cast-container",
					node,
					message: "casts a hand-built { services } object to never, in place of a Container",
				});
			}
		}
	});
}

// ---------------------------------------------------------------------------------------------
// Guard 9: one home for stand-ins.

function implementsStandIn(node: Node): string | undefined {
	const clauses = (
		node as unknown as { heritageClauses?: { token: SyntaxKind; types: { expression: Node }[] }[] }
	).heritageClauses;
	for (const clause of clauses ?? []) {
		if (clause.token !== SyntaxKind.ImplementsKeyword) continue;
		for (const type of clause.types) {
			const name = type.expression.getText();
			if (STAND_IN_INTERFACES.has(name)) return name;
		}
	}
	return undefined;
}

function declaredType(node: Node): string {
	const type = (node as unknown as { type?: Node }).type;
	if (type !== undefined && isTypeReferenceNode(type)) return type.typeName.getText();
	return "";
}

/** Finds stand-in declarations: fake or in-memory classes, git runner fakes and fake file systems. */
function standIns(facts: FileFacts): { node: Node; name: string }[] {
	const found: { node: Node; name: string }[] = [];
	const consider = (node: Node, name: string | undefined, initializer?: Node): void => {
		if (name === undefined) return;
		const isClassLike = isClassDeclaration(node) || isClassExpression(node);
		const initialiser = initializer === undefined ? undefined : unwrap(initializer);
		const makesObject =
			initialiser !== undefined &&
			(isFunctionLike(initialiser) ||
				isObjectLiteralExpression(initialiser) ||
				initialiser.kind === SyntaxKind.ClassExpression);
		const buildsStandIn = isClassLike || makesObject || isFunctionDeclaration(node);
		// A runner factory is a git runner fake only when it speaks git: the name or the body says so.
		const isGitRunner =
			GIT_RUNNER_NAME.test(name) &&
			(/Git/i.test(name) || /\bGit(Command|Runner)\b/.test(textOf(node, facts)));
		const byName =
			STAND_IN_PASCAL.test(name) ||
			STAND_IN_CAMEL.test(name) ||
			(buildsStandIn && (isGitRunner || FILE_SYSTEM_NAME.test(name)));
		const byType =
			(isClassLike && implementsStandIn(node) !== undefined) ||
			(makesObject && (declaredType(node) === "GitRunner" || declaredType(node) === "FileSystem"));
		if (byName || byType) found.push({ node, name });
	};
	visit(facts.sf, (node) => {
		if (isClassDeclaration(node) || isClassExpression(node)) consider(node, node.name?.text);
		else if (isFunctionDeclaration(node)) consider(node, node.name?.text);
		else if (isVariableDeclaration(node) && isIdentifier(node.name)) {
			consider(node, node.name.text, node.initializer);
		}
	});
	return found;
}

/** The first block comment of a file, as text. */
function headerOf(facts: FileFacts): string {
	const text = facts.sf.text;
	const match = /^\s*\/\*\*[\s\S]*?\*\//.exec(text);
	return match?.[0] ?? "";
}

/**
 * `exists` answers whether a repository path is a file; it is a parameter so the analysis stays
 * free of I/O.
 */
function guardStandInHome(
	facts: FileFacts,
	exists: (rel: string) => boolean,
	found: Found[],
): void {
	if (!facts.inHome) {
		if (!facts.isTest) return;
		for (const standIn of standIns(facts)) {
			found.push({
				guard: "stand-in-home",
				check: "stand-in-outside-home",
				node: standIn.node,
				message: `defines the stand-in ${standIn.name}; stand-ins live in ${STAND_IN_HOMES.join(" or ")}`,
			});
		}
		return;
	}
	if (facts.isTest) return;
	const header = headerOf(facts);
	const named = CONTRACT_LINE.exec(header)?.[1]?.replace(/[.,;)]+$/, "");
	const folder = facts.rel.split("/").slice(0, -1).join("/");
	const contractOk =
		named !== undefined && (exists(normalise(named)) || exists(normalise(`${folder}/${named}`)));
	if (contractOk) return;
	for (const standIn of standIns(facts)) {
		found.push({
			guard: "stand-in-home",
			check: "no-contract-test",
			node: standIn.node,
			message:
				named === undefined
					? `stand-in ${standIn.name} has no "Contract test: <path>" line in the file header`
					: `stand-in ${standIn.name} names the contract test ${named}, which does not exist`,
		});
	}
}

// ---------------------------------------------------------------------------------------------
// Guard 10: time and leaks.

const hasCall = (sf: SourceFile, name: string): boolean => {
	let found = false;
	visit(sf, (node) => {
		if (isCallExpression(node) && calleeName(node) === name) found = true;
	});
	return found;
};

function isAwaitedResolve(node: Node): boolean {
	if (node.kind !== SyntaxKind.ExpressionStatement) return false;
	const expression = unwrap((node as unknown as { expression: Node }).expression);
	if (expression.kind !== SyntaxKind.AwaitExpression) return false;
	const awaited = unwrap((expression as unknown as { expression: Node }).expression);
	return (
		isCallExpression(awaited) && chainNames(awaited.expression).join(".") === "Promise.resolve"
	);
}

/** A sleep helper waits for the delay its caller passes in; it is not a wait of its own. */
function delaysByParameter(call: CallExpression): boolean {
	const delay = call.arguments[1];
	if (delay === undefined || !isIdentifier(delay)) return false;
	for (
		let current: Node | undefined = call.parent;
		current !== undefined;
		current = current.parent
	) {
		if (isFunctionLike(current) || isFunctionDeclaration(current)) {
			const params = (current as unknown as { parameters: { name: Node }[] }).parameters;
			if (params.some((param) => param.name.getText() === delay.text)) return true;
		}
	}
	return false;
}

/** A timer that only rejects or throws is a guard against a hang, not a wait for a result. */
function isHangGuard(call: CallExpression): boolean {
	const callback = call.arguments[0];
	let rejects = false;
	if (callback !== undefined && isFunctionLike(callback)) {
		visit(callback, (node) => {
			if (node.kind === SyntaxKind.ThrowStatement) rejects = true;
			if (isCallExpression(node) && calleeName(node) === "reject") rejects = true;
			if (isNewExpressionOfError(node)) rejects = true;
		});
	}
	return rejects;
}

const isNewExpressionOfError = (node: Node): boolean =>
	node.kind === SyntaxKind.NewExpression &&
	/Error$/.test(unwrap((node as unknown as { expression: Node }).expression).getText());

function isInsideFinally(node: Node, stop: Node): boolean {
	let current: Node | undefined = node.parent;
	while (current !== undefined && current !== stop) {
		const parent: Node | undefined = current.parent;
		if (
			parent !== undefined &&
			isBlock(current) &&
			isTryStatement(parent) &&
			parent.finallyBlock !== undefined &&
			parent.finallyBlock.getStart() === current.getStart()
		)
			return true;
		current = parent;
	}
	return false;
}

/** True when the node is inside a loop of its own function: a poll loop that waits for an event. */
function isInsideLoop(node: Node): boolean {
	for (
		let current: Node | undefined = node.parent;
		current !== undefined;
		current = current.parent
	) {
		if (
			current.kind === SyntaxKind.WhileStatement ||
			current.kind === SyntaxKind.DoStatement ||
			current.kind === SyntaxKind.ForStatement ||
			current.kind === SyntaxKind.ForOfStatement
		)
			return true;
		const isExecutor = current.parent?.kind === SyntaxKind.NewExpression;
		if ((isFunctionLike(current) && !isExecutor) || isFunctionDeclaration(current)) return false;
	}
	return false;
}

/** True when this node sits inside a function that is not a `describe`, so it is not module level. */
function isModuleLevel(node: Node): boolean {
	let current: Node | undefined = node.parent;
	while (current !== undefined) {
		if (
			isFunctionLike(current) ||
			isFunctionDeclaration(current) ||
			current.kind === SyntaxKind.MethodDeclaration
		) {
			const parent = current.parent;
			const isDescribe =
				parent !== undefined &&
				isCallExpression(parent) &&
				["describe", "suite"].includes(chainNames(parent.expression)[0] ?? "");
			if (!isDescribe) return false;
		}
		current = current.parent;
	}
	return true;
}

function cleansUp(sf: SourceFile): boolean {
	let found = false;
	visit(sf, (node) => {
		if (!isCallExpression(node) || !HOOK_NAMES.has(calleeName(node))) return;
		visit(node, (inner) => {
			if (isCallExpression(inner) && REMOVAL_NAMES.has(calleeName(inner))) found = true;
		});
	});
	return found;
}

function constantIdSource(initializer: Node): string | undefined {
	let value = unwrap(initializer);
	if (isCallExpression(value)) {
		const names = chainNames(value.expression);
		const last = names.at(-1) ?? "";
		if (last === "mockReturnValue" && stringValue(value.arguments[0]) !== undefined)
			return "returns one string every time";
		const first = value.arguments[0];
		if (["fn", "mock"].includes(last) && first !== undefined) value = unwrap(first);
		else return undefined;
	}
	if (!isFunctionLike(value)) return undefined;
	const fn = value as unknown as { parameters: unknown[]; body: Node };
	if (fn.parameters.length > 0) return undefined;
	let result: Node | undefined = fn.body;
	if (isBlock(fn.body)) {
		const only = fn.body.statements.length === 1 ? fn.body.statements[0] : undefined;
		result = only !== undefined && isReturnStatement(only) ? only.expression : undefined;
	}
	if (result === undefined) return undefined;
	const body = unwrap(result);
	if (stringValue(body) !== undefined) return "returns one string every time";
	if (isTemplateExpression(body) && /\.length\b/.test(body.getText()))
		return "builds its id from a collection length";
	return undefined;
}

function guardTimeAndLeaks(facts: FileFacts, found: Found[]): void {
	const fakeTimers = hasCall(facts.sf, "useFakeTimers");
	const cleaned = cleansUp(facts.sf);
	visit(facts.sf, (node) => {
		if (isCallExpression(node)) {
			const names = chainNames(node.expression);
			const last = names.at(-1) ?? "";
			const isTimer =
				last === "setTimeout" ||
				names.join(".") === "Bun.sleep" ||
				(names.length === 1 && last === "sleep");
			if (
				isTimer &&
				!fakeTimers &&
				!isHangGuard(node) &&
				!isInsideLoop(node) &&
				!delaysByParameter(node)
			) {
				found.push({
					guard: "time-and-leaks",
					check: "real-time",
					node,
					message: `${last} waits real time and the file has no fake timers`,
				});
			}
			if ((last === "mkdtemp" || last === "mkdtempSync") && isModuleLevel(node) && !cleaned) {
				found.push({
					guard: "time-and-leaks",
					check: "module-level-temp",
					node,
					message: "creates a temp folder at module level and no afterAll or afterEach removes it",
				});
			}
		}
		if (
			(node.kind === SyntaxKind.ForStatement ||
				node.kind === SyntaxKind.WhileStatement ||
				node.kind === SyntaxKind.DoStatement ||
				node.kind === SyntaxKind.ForOfStatement) &&
			(() => {
				let counting = false;
				visit(node, (inner) => {
					if (isAwaitedResolve(inner)) counting = true;
				});
				return counting;
			})()
		) {
			found.push({
				guard: "time-and-leaks",
				check: "microtask-count",
				node,
				message: "settles by awaiting Promise.resolve() in a loop; wait for the event instead",
			});
		}
		if (isBlock(node)) {
			const run = node.statements.filter((statement) => isAwaitedResolve(statement));
			if (run.length >= 2) {
				found.push({
					guard: "time-and-leaks",
					check: "microtask-count",
					node,
					message: `settles by awaiting Promise.resolve() ${run.length} times; wait for the event instead`,
				});
			}
		}
		if (isPropertyAssignment(node) || isVariableDeclaration(node)) {
			const name = node.name.getText();
			const init = node.initializer;
			if (ID_SOURCE_NAME.test(name) && init !== undefined) {
				const problem = constantIdSource(init);
				if (problem !== undefined) {
					found.push({
						guard: "time-and-leaks",
						check: "constant-id",
						node,
						message: `id source ${name} ${problem}`,
					});
				}
			}
		}
	});
	for (const test of testCases(facts.sf)) {
		visit(test.body, (node) => {
			if (!isCallExpression(node) || !RESTORE_NAMES.has(calleeName(node))) return;
			if (isInsideFinally(node, test.body)) return;
			found.push({
				guard: "time-and-leaks",
				check: "restore-in-body",
				node,
				message: `${calleeName(node)} runs inside the test body; do it in afterEach or a finally block`,
			});
		});
	}
}

// ---------------------------------------------------------------------------------------------
// Guard 11: tests that cannot pass (the per-file half; test-shapes-mocks.ts has the other).

const TEXT_QUERY =
	/^(?:get|getAll|query|queryAll|find|findAll)By(Text|LabelText|PlaceholderText|DisplayValue|Title|AltText|Role)$/;

/**
 * Text Testing Library never matches with its default normaliser, which trims the page's text and
 * turns every run of whitespace into one space before it compares: whitespace at either end, two
 * whitespace characters in a row, or any whitespace other than a plain space.
 */
const UNMATCHABLE_TEXT = /^\s|\s$|\s{2}|[^\S ]/;
/** An accessible name is trimmed and its runs of two or more whitespace characters collapsed. */
const UNMATCHABLE_NAME = /^\s|\s$|\s{2}/;

const propertyNamed = (object: Node, name: string): Node | undefined => {
	if (!isObjectLiteralExpression(object)) return undefined;
	const property = object.properties.find(
		(item) => isPropertyAssignment(item) && item.name.getText() === name,
	);
	return property !== undefined && isPropertyAssignment(property)
		? property.initializer
		: undefined;
};

function guardTestsCannotPass(facts: FileFacts, found: Found[]): void {
	visit(facts.sf, (node) => {
		if (!isCallExpression(node)) return;
		const query = TEXT_QUERY.exec(calleeName(node));
		if (query === null) return;
		const options = node.arguments[1] === undefined ? undefined : unwrap(node.arguments[1]);
		let text: string | undefined;
		let unmatchable = UNMATCHABLE_TEXT;
		if (query[1] === "Role") {
			unmatchable = UNMATCHABLE_NAME;
			// A role's name is the computed accessible name, which is always trimmed.
			text = options === undefined ? undefined : stringValue(propertyNamed(options, "name"));
		} else {
			// A custom normaliser or a substring match (`exact: false`) reads the text another way.
			const exact = options === undefined ? undefined : propertyNamed(options, "exact");
			const custom = options !== undefined && propertyNamed(options, "normalizer") !== undefined;
			if (custom || (exact !== undefined && exact.kind !== SyntaxKind.TrueKeyword)) return;
			text = stringValue(node.arguments[0]);
		}
		if (text === undefined || !unmatchable.test(text)) return;
		found.push({
			guard: "tests-cannot-pass",
			check: "untrimmed-text",
			node,
			message: `${calleeName(node)} looks for ${JSON.stringify(text)}, which never matches: Testing Library trims the page's text and collapses its whitespace first`,
		});
	});
}

/** True when a `// seam: <ID> <reason>` comment sits on the node's line or the comment lines above. */
function isSeamExempt(facts: FileFacts, line: number): boolean {
	if (SEAM_COMMENT.test(facts.lines[line - 1] ?? "")) return true;
	for (let at = line - 2; at >= 0; at--) {
		const text = (facts.lines[at] ?? "").trim();
		if (!text.startsWith("//")) return false;
		if (SEAM_COMMENT.test(text)) return true;
	}
	return false;
}

/** Collects the imports of a file: local name to module specifier, value imports only. */
export function importsOf(sf: SourceFile): Map<string, string> {
	const imports = new Map<string, string>();
	for (const statement of sf.statements) {
		if (!isImportDeclaration(statement) || statement.importClause === undefined) continue;
		const clause = statement.importClause;
		if (clause.phaseModifier === SyntaxKind.TypeKeyword) continue;
		const spec = stringValue(statement.moduleSpecifier);
		if (spec === undefined) continue;
		if (clause.name !== undefined) imports.set(clause.name.text, spec);
		const bindings = clause.namedBindings;
		if (bindings === undefined) continue;
		if (isNamespaceImport(bindings)) imports.set(bindings.name.text, spec);
		else if (isNamedImports(bindings)) {
			for (const element of bindings.elements) {
				if (!element.isTypeOnly) imports.set(element.name.text, spec);
			}
		}
	}
	return imports;
}

/** Runs the per-file TypeScript guards over one parsed file. */
export function analyseTypeScript(facts: FileFacts, exists: (rel: string) => boolean): Violation[] {
	const found: Found[] = [];
	if (facts.isTest) {
		guardTestsCannotFail(facts, found);
		guardMockingTheThing(facts, found);
		guardTimeAndLeaks(facts, found);
		guardTestsCannotPass(facts, found);
	}
	guardStandInHome(facts, exists, found);
	return found
		.map((item) => ({
			guard: item.guard,
			check: item.check,
			file: facts.rel,
			line: lineOf(facts, item.node),
			message: item.message,
		}))
		.filter((item) => !(item.guard === "mocking-the-thing" && isSeamExempt(facts, item.line)));
}
