/**
 * @feature APP-03 Diagnostics report
 * Owns: the pure functions that redact a DiagnosticsCapture (core/model.ts) and render it as text.
 * Behaviour: ui-map.md 2, `/diagnostics` ("Env values are hashed except a safe list"); services-map.md
 * 3.0 and native-and-sidecar-map.md (captured login-shell PATH, secrets stripped).
 * Data: `useDiagnostics()` returns the capture; `Actions.app.createDiagnosticsChat(workspaceId)`
 * writes the redacted report to a file and starts a chat with it attached. Hashing is passed in (it
 * needs the platform's crypto), so the functions stay pure.
 * Safe list: names whose values are shown as they are, such as SHELL, LANG, TERM, TERM_PROGRAM
 * and COLORTERM. The exact list is Our design choice and is a parameter.
 * Must handle: an empty environment, values that contain newlines, PATH entries (shown one per
 * line, with home folder replaced by "~" in the redacted report), the same variable twice, very
 * long values (cut in the report with a note), and names that look secret (anything with TOKEN,
 * KEY, SECRET, PASSWORD: always hashed even if on the safe list).
 * Test first: redactCapture hashes a variable named API_TOKEN even when the safe list names it, and
 * keeps LANG as it is.
 */
import { notImplemented } from "@conducted/shared";
import type { DiagnosticsCapture } from "../../core/model.ts";

export interface RedactionOptions {
	safeEnvNames: ReadonlySet<string>;
	/** Returns a short stable hash of a value, e.g. the first 8 hex characters of SHA-256. */
	hash: (value: string) => string;
	homeDir: string;
}

export function redactCapture(
	_capture: DiagnosticsCapture,
	_options: RedactionOptions,
): DiagnosticsCapture {
	return notImplemented("APP-03");
}

/** Plain-text report for pasting into an issue or attaching to a chat. */
export function renderReport(_capture: DiagnosticsCapture): string {
	return notImplemented("APP-03");
}
