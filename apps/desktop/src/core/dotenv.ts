/**
 * @feature SET-04 Environment variables, stored in the Keychain
 * Owns: reading a dotenv file into name and value pairs. The settings service and the environment
 * forms share this parser; resolving a settings layer's file paths stays with the service.
 * Behaviour: services-map.md 4.2.4 (dotenv parsing: `export ` prefix, `#` comments, single or
 * double quotes, `\n \r \t` escapes). The parser is Conductor's rule from its settings-file
 * reader, not a general dotenv library.
 * Must handle: a line with no `=`, a name that does not match `^[A-Za-z_][A-Za-z0-9_]*$` (skipped),
 * a double-quoted value with escapes, a single-quoted value with none, an unquoted value that ends
 * at whitespace before `#`.
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
