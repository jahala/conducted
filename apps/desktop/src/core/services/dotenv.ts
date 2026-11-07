/**
 * @feature SET-04 Environment variables, stored in the Keychain
 * Owns: reading a dotenv file into name and value pairs, and resolving one of a settings layer's
 * `environment_variable_files` paths the way Conductor does.
 * Behaviour: services-map.md 4.2.4 (dotenv parsing: `export ` prefix, `#` comments, single or
 * double quotes, `\n \r \t` escapes; path resolution: absolute, `~`, relative to the settings
 * directory, then to the repository root). The parser is Conductor's rule from its settings-file
 * reader, not a general dotenv library.
 * Must handle: a line with no `=`, a name that does not match `^[A-Za-z_][A-Za-z0-9_]*$` (skipped),
 * a double-quoted value with escapes, a single-quoted value with none, an unquoted value that ends
 * at whitespace before `#`, and a relative path that exists in neither folder (the caller reports
 * the missing file). Values are secrets and are returned only to the caller.
 * Our design choice: none; this is Conductor's rule.
 * Test first: an unquoted `#` comment is not part of the value.
 */
const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const unescapedCharacter = (character: string): string => {
	if (character === "n") return "\n";
	if (character === "r") return "\r";
	if (character === "t") return "\t";
	return character;
};

/** A value inside a quote: double quotes take escapes, single quotes take the text as written. */
function readQuoted(value: string, quote: '"' | "'"): string {
	let escaped = false;
	let result = "";
	for (const character of value.slice(1)) {
		if (escaped) {
			result += unescapedCharacter(character);
			escaped = false;
			continue;
		}
		if (quote === '"' && character === "\\") {
			escaped = true;
			continue;
		}
		if (character === quote) return result;
		result += character;
	}
	return result;
}

function readValue(text: string): string {
	if (text.startsWith('"')) return readQuoted(text, '"');
	if (text.startsWith("'")) return readQuoted(text, "'");
	const comment = text.search(/\s#/);
	return (comment === -1 ? text : text.slice(0, comment)).trim();
}

/** A dotenv file's pairs in file order. A later line with the same name replaces an earlier one. */
export function parseDotenv(text: string): { name: string; value: string }[] {
	const pairs: { name: string; value: string }[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const withoutExport = line.startsWith("export ")
			? line.slice("export ".length).trimStart()
			: line;
		const at = withoutExport.indexOf("=");
		if (at <= 0) continue;
		const name = withoutExport.slice(0, at).trim();
		if (!ENV_VAR_NAME.test(name)) continue;
		pairs.push({ name, value: readValue(withoutExport.slice(at + 1).trim()) });
	}
	return pairs;
}

/** Collapses `.` and `..` by spelling, so a path names the same file on disk as the app writes it. */
export function normalizeFilePath(path: string): string {
	const absolute = path.startsWith("/");
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
			else if (!absolute) parts.push(part);
			continue;
		}
		parts.push(part);
	}
	const joined = parts.join("/");
	if (absolute) return `/${joined}`;
	return joined === "" ? "." : joined;
}

export interface EnvFilePathInput {
	/** The path named in one settings layer's `environment_variable_files`. */
	path: string;
	/** The folder holding that layer's settings file. */
	settingsDir: string;
	/** The folder the layer covers: the home folder for the user layer, else the worktree. */
	sourceRoot: string;
	home: string;
	exists(path: string): Promise<boolean>;
}

/** Absolute and `~` paths stand as given; a relative path is taken from the settings folder when
 * it exists there, and otherwise from the layer's root (services-map.md 4.2.4). */
export async function resolveEnvFilePath(input: EnvFilePathInput): Promise<string> {
	const path = input.path.trim();
	if (path.startsWith("/")) return normalizeFilePath(path);
	if (path === "~") return normalizeFilePath(input.home);
	if (path.startsWith("~/")) return normalizeFilePath(`${input.home}/${path.slice(2)}`);
	const inSettings = normalizeFilePath(`${input.settingsDir}/${path}`);
	if (await input.exists(inSettings)) return inSettings;
	return normalizeFilePath(`${input.sourceRoot}/${path}`);
}
