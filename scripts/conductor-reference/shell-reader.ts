/**
 * A small POSIX-shell reader for the Conductor reference run. Conductor hands its native side shell
 * strings (`cd '<dir>' && git ... 2>/dev/null || true`); our catalogue world answers single commands
 * (program, arguments, folder). This reads the string the way zsh would and runs each simple command
 * against the world, so the answer is the world's answer, with the shell's own rules applied around it.
 *
 * - Quoting: single quotes, double quotes with backslash escapes, `$NAME` and `${NAME}` from the
 *   environment. Anything it cannot read exactly (globs, subshells, command substitution, arrays, a
 *   variable with no value) makes the whole string unanswerable: `null`, never a guess.
 * - Lists: `&&`, `||`, `;` and new lines, with the exit status rules of the shell; `if`/`elif`/`else`,
 *   `{ ... }` groups and `( ... )` subshells. Pipes are not read.
 * - Redirections: `2>/dev/null`, `>/dev/null`, `2>&1`, `>&2`.
 * - Built-ins the world needs no program for: `cd`, `export`, `unset`, `which`, `command -v`, assignments, `true`, `false`, `echo`,
 *   `printf` (`%s`, `%d` and backslash escapes), `env`, `exit`, `test` / `[` (`!`, `-e -f -d -x -L`,
 *   `-n -z`), `mkdir`, and
 *   `zsh` / `bash` / `sh` with `-c` (read again, with the same rules).
 * - Every other command goes to `run`, which answers or declines (`null`).
 */

export interface Output {
	code: number;
	stdout: string;
	stderr: string;
}

export interface ShellHost {
	/** Runs one program. Null when the world has no answer for it. */
	run(command: {
		program: string;
		args: string[];
		cwd: string;
		env: Record<string, string>;
	}): Promise<Output | null>;
	/** For `test`: null when the path does not exist. */
	stat(path: string): Promise<{ isDirectory: boolean; isSymlink?: boolean } | null>;
	/** For `mkdir`: makes the folder (and its parents). */
	mkdirp(path: string): Promise<boolean>;
}

type Token = { kind: "word"; text: string; bare?: boolean } | { kind: "op"; op: string };

/** Splits a shell string into words and operators, expanding variables from `env`. Null when unreadable. */
export function tokenize(source: string, env: Record<string, string>): Token[] | null {
	const tokens: Token[] = [];
	let current = "";
	let started = false;
	let quoted = false;
	const flush = () => {
		if (started)
			tokens.push(
				quoted ? { kind: "word", text: current } : { kind: "word", text: current, bare: true },
			);
		current = "";
		started = false;
		quoted = false;
	};
	const variable = (index: number): { value: string; end: number } | null => {
		// `index` points at the `$`.
		const rest = source.slice(index + 1);
		const braced = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rest);
		const plain = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
		const match = braced ?? plain;
		if (match === null) return null;
		const value = env[match[1] as string];
		if (value === undefined) return null;
		return { value, end: index + match[0].length };
	};
	for (let index = 0; index < source.length; index++) {
		const char = source[index] as string;
		if (char === "'") {
			const close = source.indexOf("'", index + 1);
			if (close === -1) return null;
			current += source.slice(index + 1, close);
			started = true;
			quoted = true;
			index = close;
			continue;
		}
		if (char === '"') {
			started = true;
			quoted = true;
			let closed = false;
			for (index += 1; index < source.length; index++) {
				const inner = source[index] as string;
				if (inner === '"') {
					closed = true;
					break;
				}
				if (
					inner === "\\" &&
					index + 1 < source.length &&
					'"\\$`\n'.includes(source[index + 1] as string)
				) {
					current += source[++index];
					continue;
				}
				if (inner === "`") return null;
				if (inner === "$") {
					const expanded = variable(index);
					if (expanded === null) return null;
					current += expanded.value;
					index = expanded.end;
					continue;
				}
				current += inner;
			}
			if (!closed) return null;
			continue;
		}
		if (char === "\\") {
			if (index + 1 >= source.length) return null;
			const next = source[++index] as string;
			if (next !== "\n") {
				current += next;
				started = true;
			}
			continue;
		}
		if (char === "#" && !started) {
			const end = source.indexOf("\n", index);
			index = end === -1 ? source.length : end - 1;
			continue;
		}
		if (char === "\n" || char === ";") {
			flush();
			tokens.push({ kind: "op", op: ";" });
			continue;
		}
		if (char === " " || char === "\t") {
			flush();
			continue;
		}
		if (char === "&" || char === "|") {
			if (source[index + 1] === char) {
				flush();
				tokens.push({ kind: "op", op: char + char });
				index += 1;
				continue;
			}
			return null; // Background jobs and pipes are not read.
		}
		if (char === ">" || char === "<") {
			// A redirection: an optional descriptor already in `current`, then `>`, then `&N` or a word.
			if (char === "<") return null;
			const descriptor = started && /^\d$/.test(current) ? current : "1";
			if (started && !/^\d$/.test(current)) flush();
			current = "";
			started = false;
			let target: string;
			if (source[index + 1] === "&") {
				const digit = source[index + 2];
				if (digit === undefined || !/\d/.test(digit)) return null;
				target = `&${digit}`;
				index += 2;
			} else {
				index += 1;
				while (source[index] === " ") index += 1;
				const word = /^[^\s;&|<>]+/.exec(source.slice(index));
				if (word === null) return null;
				target = word[0];
				index += word[0].length - 1;
			}
			tokens.push({ kind: "op", op: `${descriptor}>${target}` });
			continue;
		}
		if ((char === "(" || char === ")") && !started) {
			tokens.push({ kind: "op", op: char });
			continue;
		}
		if (char === ")") {
			flush();
			tokens.push({ kind: "op", op: char });
			continue;
		}
		if (char === "(" || char === "`") return null;
		if (char === "*" || char === "?") return null;
		if (char === "$") {
			const expanded = variable(index);
			if (expanded === null) return null;
			current += expanded.value;
			started = true;
			index = expanded.end;
			continue;
		}
		current += char;
		started = true;
	}
	flush();
	return tokens;
}

interface Simple {
	kind: "simple";
	words: string[];
	assigns: Record<string, string>;
	redirects: string[];
}
interface Group {
	kind: "group";
	body: Step[];
	/** `( ... )` runs in a subshell: its `cd`, variables and `exit` stay inside. */
	subshell: boolean;
	redirects: string[];
}
interface If {
	kind: "if";
	branches: { condition: Step[]; body: Step[] }[];
	otherwise: Step[] | null;
	redirects: string[];
}
type Node = Simple | Group | If;
type Step = { node: Node; joiner: ";" | "&&" | "||" };

const KEYWORDS = new Set(["if", "then", "elif", "else", "fi", "{", "}"]);

/** Reads tokens into lists of commands, `if` blocks, `{ }` groups and `( )` subshells. Null when unreadable. */
function parse(tokens: Token[]): Step[] | null {
	let at = 0;
	const keyword = (token: Token | undefined): string | null =>
		token?.kind === "word" && token.bare === true && KEYWORDS.has(token.text) ? token.text : null;
	const redirects = (): string[] => {
		const list: string[] = [];
		for (
			let token = tokens[at];
			token?.kind === "op" && token.op.includes(">");
			token = tokens[at]
		) {
			list.push(token.op);
			at += 1;
		}
		return list;
	};
	/** A list, up to (not taking) one of the `until` keywords or `)`. */
	const list = (until: string[]): Step[] | null => {
		const steps: Step[] = [];
		let joiner: Step["joiner"] = ";";
		for (;;) {
			const token = tokens[at];
			if (token === undefined) return steps;
			const word = keyword(token);
			if (word !== null && until.includes(word)) return steps;
			if (token.kind === "op" && token.op === ")") return steps;
			if (token.kind === "op" && (token.op === ";" || token.op === "&&" || token.op === "||")) {
				if (token.op !== ";" && steps.length === 0) return null;
				joiner = token.op === ";" ? ";" : token.op;
				at += 1;
				continue;
			}
			const node = command();
			if (node === null) return null;
			steps.push({ node, joiner });
			joiner = ";";
		}
	};
	const command = (): Node | null => {
		const token = tokens[at];
		const word = keyword(token);
		if (token?.kind === "op" && token.op === "(") {
			at += 1;
			const body = list([]);
			if (body === null || (tokens[at] as { op?: string } | undefined)?.op !== ")") return null;
			at += 1;
			return { kind: "group", body, subshell: true, redirects: redirects() };
		}
		if (word === "{") {
			at += 1;
			const body = list(["}"]);
			if (body === null || keyword(tokens[at]) !== "}") return null;
			at += 1;
			return { kind: "group", body, subshell: false, redirects: redirects() };
		}
		if (word === "if") {
			at += 1;
			const branches: If["branches"] = [];
			let otherwise: Step[] | null = null;
			for (;;) {
				const condition = list(["then"]);
				if (condition === null || keyword(tokens[at]) !== "then") return null;
				at += 1;
				const body = list(["elif", "else", "fi"]);
				if (body === null) return null;
				branches.push({ condition, body });
				const next = keyword(tokens[at]);
				at += 1;
				if (next === "elif") continue;
				if (next === "else") {
					otherwise = list(["fi"]);
					if (otherwise === null || keyword(tokens[at]) !== "fi") return null;
					at += 1;
				} else if (next !== "fi") return null;
				break;
			}
			return { kind: "if", branches, otherwise, redirects: redirects() };
		}
		if (word !== null) return null;
		const simple: Simple = { kind: "simple", words: [], assigns: {}, redirects: [] };
		for (let next = tokens[at]; next !== undefined; next = tokens[at]) {
			if (next.kind === "op") {
				if (!next.op.includes(">")) break;
				simple.redirects.push(next.op);
				at += 1;
				continue;
			}
			// A closing keyword ends the command only where a command could end, as `}` and `fi` do.
			if (simple.words.length > 0 && keyword(next) === "}") break;
			const assign = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(next.text);
			if (simple.words.length === 0 && assign !== null)
				simple.assigns[assign[1] as string] = assign[2] as string;
			else simple.words.push(next.text);
			at += 1;
		}
		return simple.words.length > 0 || Object.keys(simple.assigns).length > 0 ? simple : null;
	};
	const steps = list([]);
	return steps === null || at !== tokens.length ? null : steps;
}

const printfEscapes = (text: string): string =>
	text.replace(/\\(n|t|\\|0)/g, (_all, code: string) =>
		code === "n" ? "\n" : code === "t" ? "\t" : code === "0" ? "\0" : "\\",
	);

function printf(args: string[]): string | null {
	const [format, ...values] = args;
	if (format === undefined) return null;
	let out = "";
	let next = 0;
	do {
		let unsupported = false;
		out += printfEscapes(format).replace(/%([sd%])/g, (_all, spec: string) => {
			if (spec === "%") return "%";
			const value = values[next++] ?? "";
			if (spec === "d" && !/^-?\d+$/.test(value || "0")) unsupported = true;
			return spec === "d" ? String(Number(value || "0")) : value;
		});
		if (unsupported) return null;
	} while (next > 0 && next < values.length);
	return out;
}

/** One `test` expression: a file test (`-e -f -d -x -L`) or a string test (`-n -z`). */
async function testExpression(
	operands: string[],
	session: Session,
	host: ShellHost,
): Promise<boolean | null> {
	if (operands.length !== 2) return null;
	const [flag, operand] = operands as [string, string];
	if (flag === "-n") return operand !== "";
	if (flag === "-z") return operand === "";
	if (!["-e", "-f", "-d", "-x", "-L"].includes(flag)) return null;
	const found = await host.stat(operand.startsWith("/") ? operand : `${session.cwd}/${operand}`);
	if (found === null) return false;
	if (flag === "-L") return found.isSymlink === true;
	return flag === "-e" || (flag === "-d" ? found.isDirectory : !found.isDirectory);
}

export interface Session {
	cwd: string;
	env: Record<string, string>;
}

/**
 * Runs a shell string. Null when any part of it has no answer in the world; otherwise the combined
 * output and the exit status of the last command, as the shell would give them.
 */
export async function runShellString(
	source: string,
	session: Session,
	host: ShellHost,
): Promise<Output | null> {
	const tokens = tokenize(source, session.env);
	if (tokens === null) return null;
	const steps = parse(tokens);
	if (steps === null) return null;
	const result = await runList(steps, session, host);
	return result === null
		? null
		: { code: result.code, stdout: result.stdout, stderr: result.stderr };
}

type Ran = Output & { exited: boolean };

async function runList(steps: Step[], session: Session, host: ShellHost): Promise<Ran | null> {
	let status = 0;
	let stdout = "";
	let stderr = "";
	for (const { node, joiner } of steps) {
		if (joiner === "&&" && status !== 0) continue;
		if (joiner === "||" && status === 0) continue;
		const result = await runNode(node, session, host);
		if (result === null) return null;
		const redirected = redirect(result, node.redirects);
		if (redirected === null) return null;
		stdout += redirected.stdout;
		stderr += redirected.stderr;
		status = result.code;
		if (result.exited) return { code: status, stdout, stderr, exited: true };
	}
	return { code: status, stdout, stderr, exited: false };
}

async function runNode(node: Node, session: Session, host: ShellHost): Promise<Ran | null> {
	if (node.kind === "simple") {
		const result = await runSimple(node, session, host);
		if (result === null) return null;
		return result === "exit"
			? { code: 0, stdout: "", stderr: "", exited: true }
			: { ...result, exited: false };
	}
	if (node.kind === "group") {
		if (!node.subshell) return await runList(node.body, session, host);
		const inner = await runList(node.body, { cwd: session.cwd, env: { ...session.env } }, host);
		return inner === null ? null : { ...inner, exited: false };
	}
	let stdout = "";
	let stderr = "";
	for (const branch of node.branches) {
		const condition = await runList(branch.condition, session, host);
		if (condition === null) return null;
		stdout += condition.stdout;
		stderr += condition.stderr;
		if (condition.exited) return { ...condition, stdout, stderr };
		if (condition.code !== 0) continue;
		const body = await runList(branch.body, session, host);
		return body === null
			? null
			: { ...body, stdout: stdout + body.stdout, stderr: stderr + body.stderr };
	}
	if (node.otherwise === null) return { code: 0, stdout, stderr, exited: false };
	const body = await runList(node.otherwise, session, host);
	return body === null
		? null
		: { ...body, stdout: stdout + body.stdout, stderr: stderr + body.stderr };
}

function redirect(result: Output, redirects: string[]): Output | null {
	let { stdout: out, stderr: err } = result;
	for (const target of redirects) {
		if (target === "2>/dev/null") err = "";
		else if (target === "1>/dev/null") out = "";
		else if (target === "2>&1") {
			out += err;
			err = "";
		} else if (target === "1>&2") {
			err += out;
			out = "";
		} else return null;
	}
	return { code: result.code, stdout: out, stderr: err };
}

async function runSimple(
	command: Simple,
	session: Session,
	host: ShellHost,
): Promise<Output | "exit" | null> {
	const ok = (stdout = ""): Output => ({ code: 0, stdout, stderr: "" });
	const [name, ...args] = command.words;
	if (name === undefined) {
		Object.assign(session.env, command.assigns);
		return ok();
	}
	const env = { ...session.env, ...command.assigns };
	switch (name) {
		case "cd": {
			if (args.length !== 1) return null;
			session.cwd = args[0]?.startsWith("/") ? (args[0] as string) : `${session.cwd}/${args[0]}`;
			return ok();
		}
		case "export": {
			for (const arg of args) {
				const assign = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(arg);
				if (assign === null) return null;
				session.env[assign[1] as string] = assign[2] as string;
			}
			return ok();
		}
		case "which":
		case "command": {
			// `which <name>` and `command -v <name>`: the first file of that name on PATH.
			const names = name === "command" ? (args[0] === "-v" ? args.slice(1) : null) : args;
			if (names === null || names.length !== 1) return null;
			const program = names[0] as string;
			const dirs = program.includes("/")
				? [""]
				: (env.PATH ?? "").split(":").filter((dir) => dir !== "");
			for (const dir of dirs) {
				const path = dir === "" ? program : `${dir}/${program}`;
				const found = await host.stat(path);
				if (found !== null && !found.isDirectory) return ok(`${path}\n`);
			}
			return { code: 1, stdout: "", stderr: name === "which" ? `${program} not found\n` : "" };
		}
		case "unset": {
			for (const arg of args) delete session.env[arg];
			return ok();
		}
		case "true":
			return ok();
		case "false":
			return { code: 1, stdout: "", stderr: "" };
		case "exit":
			return "exit";
		case "echo": {
			const newline = args[0] !== "-n";
			return ok(`${(newline ? args : args.slice(1)).join(" ")}${newline ? "\n" : ""}`);
		}
		case "printf": {
			const text = printf(args);
			return text === null ? null : ok(text);
		}
		case "env": {
			if (args.length > 0) return null;
			return ok(
				Object.entries(env)
					.map(([key, value]) => `${key}=${value}\n`)
					.join(""),
			);
		}
		case "test":
		case "[": {
			let operands = name === "[" ? (args.at(-1) === "]" ? args.slice(0, -1) : null) : args;
			if (operands === null) return null;
			const negate = operands[0] === "!";
			if (negate) operands = operands.slice(1);
			const pass = await testExpression(operands, session, host);
			if (pass === null) return null;
			return { code: pass !== negate ? 0 : 1, stdout: "", stderr: "" };
		}
		case "mkdir": {
			const paths = args.filter((arg) => !arg.startsWith("-"));
			if (args.some((arg) => arg.startsWith("-") && arg !== "-p") || paths.length === 0)
				return null;
			for (const path of paths) {
				if (!(await host.mkdirp(path.startsWith("/") ? path : `${session.cwd}/${path}`)))
					return null;
			}
			return ok();
		}
		case "zsh":
		case "bash":
		case "sh": {
			const flag = args[0] ?? "";
			if (!/^-[il]*c$/.test(flag) || args.length !== 2) return null;
			return await runShellString(args[1] as string, { cwd: session.cwd, env }, host);
		}
		default: {
			let cwd = session.cwd;
			let rest = args;
			// `git -C <dir>` runs git as if started in <dir>.
			if (name === "git" && rest[0] === "-C" && rest[1] !== undefined) {
				cwd = rest[1];
				rest = rest.slice(2);
			}
			return await host.run({ program: name, args: rest, cwd, env });
		}
	}
}
