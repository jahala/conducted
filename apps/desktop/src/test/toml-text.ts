/**
 * @feature test support The TOML text of a settings document
 * Owns: turning a test's settings document into TOML text to seed a settings file.
 * Behaviour: not applicable, test support only. The codec returns a Result; a test's own document
 * is always writable, so a failure here is a broken test and throws.
 */
import { tomlCodec } from "../core/services/toml-codec.ts";

export function tomlText(document: Record<string, unknown>): string {
	const written = tomlCodec.stringify(document);
	if (!written.ok) throw new Error(written.error.message);
	return written.value;
}
