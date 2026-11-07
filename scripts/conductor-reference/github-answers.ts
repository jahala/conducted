/**
 * What GitHub's GraphQL API does with a query's selection: it answers exactly the fields asked for,
 * under their aliases, honouring `@skip` and `@include`. Our catalogue world scripts one answer per
 * GitHub request our app makes; Conductor asks for a different set of fields, so the reference run cuts
 * the world's answer down to Conductor's selection. Fields Conductor asks for that the world's answer
 * lacks stay absent; nothing is added.
 *
 * Also a small `jq` for `gh --jq`: paths (`.a.b`, `.[0]`) and array construction (`[.a, .b]`).
 */

type Token = { kind: "name" | "punct" | "string" | "number"; text: string };

function lex(source: string): Token[] {
	const tokens: Token[] = [];
	const pattern =
		/\s+|,|#[^\n]*|("""[\s\S]*?"""|"(?:\\.|[^"\\])*")|(\.\.\.)|([A-Za-z_][A-Za-z0-9_]*)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}()[\]:@$!=|&])/y;
	let index = 0;
	while (index < source.length) {
		pattern.lastIndex = index;
		const match = pattern.exec(source);
		if (match === null) throw new Error(`GraphQL: unexpected ${source.slice(index, index + 20)}`);
		index = pattern.lastIndex;
		if (match[1] !== undefined) tokens.push({ kind: "string", text: match[1] });
		else if (match[2] !== undefined) tokens.push({ kind: "punct", text: "..." });
		else if (match[3] !== undefined) tokens.push({ kind: "name", text: match[3] });
		else if (match[4] !== undefined) tokens.push({ kind: "number", text: match[4] });
		else if (match[5] !== undefined) tokens.push({ kind: "punct", text: match[5] });
	}
	return tokens;
}

interface Directive {
	name: string;
	/** The `if:` argument: a literal or a variable name. */
	condition?: { literal: boolean } | { variable: string };
}

type Selection =
	| { kind: "field"; key: string; directives: Directive[]; children: Selection[] | null }
	| { kind: "spread"; name: string; directives: Directive[] }
	| { kind: "inline"; directives: Directive[]; children: Selection[] };

export interface Document {
	operation: Selection[];
	fragments: Map<string, Selection[]>;
}

export function parseDocument(source: string): Document {
	const tokens = lex(source);
	let at = 0;
	const peek = (): Token | undefined => tokens[at];
	const take = (text?: string): Token => {
		const token = tokens[at++];
		if (token === undefined || (text !== undefined && token.text !== text)) {
			throw new Error(`GraphQL: expected ${text ?? "a token"}, got ${token?.text ?? "the end"}`);
		}
		return token;
	};
	const skipBalanced = (open: string, close: string): void => {
		take(open);
		let depth = 1;
		while (depth > 0) {
			const token = take();
			if (token.text === open) depth += 1;
			else if (token.text === close) depth -= 1;
		}
	};
	const directives = (): Directive[] => {
		const list: Directive[] = [];
		while (peek()?.text === "@") {
			take("@");
			const name = take().text;
			const directive: Directive = { name };
			if (peek()?.text === "(") {
				const start = at;
				skipBalanced("(", ")");
				const inner = tokens.slice(start + 1, at - 1);
				const ifAt = inner.findIndex((token) => token.text === "if");
				if (ifAt !== -1 && inner[ifAt + 1]?.text === ":") {
					const value = inner[ifAt + 2];
					if (value?.text === "$") directive.condition = { variable: inner[ifAt + 3]?.text ?? "" };
					else if (value?.text === "true" || value?.text === "false") {
						directive.condition = { literal: value.text === "true" };
					}
				}
			}
			list.push(directive);
		}
		return list;
	};
	const selectionSet = (): Selection[] => {
		take("{");
		const selections: Selection[] = [];
		while (peek()?.text !== "}") {
			if (peek()?.text === "...") {
				take("...");
				if (peek()?.text === "on") {
					take("on");
					take();
					const found = directives();
					selections.push({ kind: "inline", directives: found, children: selectionSet() });
				} else if (peek()?.text === "{" || peek()?.text === "@") {
					const found = directives();
					selections.push({ kind: "inline", directives: found, children: selectionSet() });
				} else {
					const name = take().text;
					selections.push({ kind: "spread", name, directives: directives() });
				}
				continue;
			}
			const key = take().text;
			if (peek()?.text === ":") {
				take(":");
				take(); // The field's own name; the answer is keyed by the alias.
			}
			if (peek()?.text === "(") skipBalanced("(", ")");
			const found = directives();
			const children = peek()?.text === "{" ? selectionSet() : null;
			selections.push({ kind: "field", key, directives: found, children });
		}
		take("}");
		return selections;
	};

	let operation: Selection[] | null = null;
	const fragments = new Map<string, Selection[]>();
	while (at < tokens.length) {
		const token = peek() as Token;
		if (token.text === "{") {
			operation = selectionSet();
		} else if (token.text === "fragment") {
			take("fragment");
			const name = take().text;
			take("on");
			take();
			directives();
			fragments.set(name, selectionSet());
		} else if (
			token.text === "query" ||
			token.text === "mutation" ||
			token.text === "subscription"
		) {
			take();
			if (peek()?.kind === "name") take();
			if (peek()?.text === "(") skipBalanced("(", ")");
			directives();
			operation = selectionSet();
		} else {
			throw new Error(`GraphQL: unexpected ${token.text}`);
		}
	}
	if (operation === null) throw new Error("GraphQL: the document has no operation.");
	return { operation, fragments };
}

const included = (list: Directive[], variables: Record<string, unknown>): boolean =>
	list.every((directive) => {
		if (directive.condition === undefined) return true;
		const value =
			"literal" in directive.condition
				? directive.condition.literal
				: variables[directive.condition.variable] === true;
		if (directive.name === "skip") return !value;
		if (directive.name === "include") return value;
		return true;
	});

/** The fields a selection asks for, by answer key, with fragments expanded and directives applied. */
function fieldsOf(
	selections: Selection[],
	document: Document,
	variables: Record<string, unknown>,
	into = new Map<string, Selection[] | null>(),
): Map<string, Selection[] | null> {
	for (const selection of selections) {
		if (!included(selection.directives, variables)) continue;
		if (selection.kind === "field") {
			const known = into.get(selection.key);
			if (selection.children === null) into.set(selection.key, known ?? null);
			else into.set(selection.key, [...(known ?? []), ...selection.children]);
		} else if (selection.kind === "inline") {
			fieldsOf(selection.children, document, variables, into);
		} else {
			const fragment = document.fragments.get(selection.name);
			if (fragment === undefined) throw new Error(`GraphQL: no fragment ${selection.name}`);
			fieldsOf(fragment, document, variables, into);
		}
	}
	return into;
}

/** The answer cut to the selection: only the keys asked for, at every level. */
export function prune(
	value: unknown,
	selections: Selection[],
	document: Document,
	variables: Record<string, unknown>,
): unknown {
	if (Array.isArray(value))
		return value.map((item) => prune(item, selections, document, variables));
	if (typeof value !== "object" || value === null) return value;
	const fields = fieldsOf(selections, document, variables);
	const out: Record<string, unknown> = {};
	for (const [key, children] of fields) {
		// A connection's `totalCount`, where the world's answer lists the connection's nodes but not the
		// count: the count of the nodes it lists (our sample connections fit in one page).
		const nodes = (value as { nodes?: unknown }).nodes;
		if (key === "totalCount" && !(key in value) && Array.isArray(nodes)) {
			out[key] = nodes.length;
			continue;
		}
		if (!(key in value)) continue;
		const child = (value as Record<string, unknown>)[key];
		out[key] = children === null ? child : prune(child, children, document, variables);
	}
	return out;
}

/** `gh api graphql` arguments as GraphQL variables: `-F` typed (booleans, numbers), `-f` strings. */
export function ghVariables(args: readonly string[]): {
	query: string | null;
	variables: Record<string, unknown>;
} {
	const variables: Record<string, unknown> = {};
	let query: string | null = null;
	for (let index = 0; index < args.length; index++) {
		const flag = args[index];
		if (flag !== "-F" && flag !== "-f" && flag !== "--field" && flag !== "--raw-field") continue;
		const pair = args[index + 1] ?? "";
		index += 1;
		const equals = pair.indexOf("=");
		if (equals === -1) continue;
		const name = pair.slice(0, equals);
		const raw = pair.slice(equals + 1);
		if (name === "query") {
			query = raw;
			continue;
		}
		const typed = flag === "-F" || flag === "--field";
		variables[name] =
			typed && (raw === "true" || raw === "false")
				? raw === "true"
				: typed && /^-?\d+$/.test(raw)
					? Number(raw)
					: raw;
	}
	return { query, variables };
}

/** A `jq` filter of paths and array construction, run on one value. Null for anything else. */
export function jq(filter: string, input: unknown): unknown[] | null {
	const text = filter.trim();
	if (text.startsWith("[") && text.endsWith("]")) {
		const parts = splitTop(text.slice(1, -1));
		const values: unknown[] = [];
		for (const part of parts) {
			const result = jq(part, input);
			if (result === null) return null;
			values.push(...result);
		}
		return [values];
	}
	if (text === ".") return [input];
	if (!/^(\.[A-Za-z_][A-Za-z0-9_]*|\.?\[\d+\])+$/.test(text)) return null;
	let value: unknown = input;
	for (const step of text.match(/\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) ?? []) {
		if (value === null || value === undefined) return [null];
		value = step.startsWith("[")
			? (value as unknown[])[Number(step.slice(1, -1))]
			: (value as Record<string, unknown>)[step.slice(1)];
	}
	return [value ?? null];
}

function splitTop(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const char of text) {
		if (char === "[" || char === "(") depth += 1;
		if (char === "]" || char === ")") depth -= 1;
		if (char === "," && depth === 0) {
			parts.push(current);
			current = "";
		} else current += char;
	}
	if (current.trim() !== "") parts.push(current);
	return parts;
}

/** How `gh --jq` prints each result: strings as they are, anything else as JSON, one per line. */
export const jqOutput = (values: unknown[]): string =>
	values.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join("\n") +
	"\n";
