/**
 * @feature APP-03 Diagnostics report
 * Owns: redacting a DiagnosticsCapture (core/model.ts), rendering it as text, and writing the
 * redacted report to a file. The redaction and rendering are pure; the write takes the Platform
 * so the caller can keep the file system at the edge.
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
import { appError, err, ok, type Result } from "@conducted/shared";
import type { DiagnosticsCapture } from "../../core/model.ts";
import type { Platform } from "../../platform/platform.ts";

/** Names whose values are useful for a report and are shown as they are. */
export const SAFE_ENV_NAMES: ReadonlySet<string> = new Set([
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"COLORTERM",
	"TZ",
	"USER",
]);

/** A name that may hold a secret, whatever the safe list says. */
const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;

/** Longest value the text report keeps before it says how much it left out. */
export const MAX_REPORT_VALUE_LENGTH = 2_000;

export interface RedactionOptions {
	safeEnvNames: ReadonlySet<string>;
	/** Returns a short stable hash of a value, e.g. the first 8 hex characters of SHA-256. */
	hash: (value: string) => string;
	homeDir: string;
}

/** Replaces the user's home folder with "~", so a shared report is less identifying. */
export function redactHome(path: string, homeDir: string): string {
	if (homeDir === "" || homeDir === "/") return path;
	return path.split(homeDir).join("~");
}

/** True when a variable name says it may hold a secret. */
export function isSecretName(name: string): boolean {
	return SECRET_NAME.test(name);
}

export function redactCapture(
	capture: DiagnosticsCapture,
	options: RedactionOptions,
): DiagnosticsCapture {
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(capture.env)) {
		env[name] = isSecretName(name) || !options.safeEnvNames.has(name) ? options.hash(value) : value;
	}
	return {
		...capture,
		path: redactHome(capture.path, options.homeDir),
		env,
	};
}

function oneLine(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\\n");
}

function cut(value: string): string {
	if (value.length <= MAX_REPORT_VALUE_LENGTH) return value;
	return `${value.slice(0, MAX_REPORT_VALUE_LENGTH)}… (truncated, ${value.length} characters)`;
}

/** Plain-text report for pasting into an issue or attaching to a chat. */
export function renderReport(capture: DiagnosticsCapture): string {
	const lines: string[] = [];
	lines.push("Conducted diagnostics");
	lines.push(`Captured: ${new Date(capture.capturedAt).toISOString()}`);
	lines.push("");
	lines.push("App");
	lines.push(`  Version: ${capture.app.version}`);
	lines.push(`  Channel: ${capture.app.channel}`);
	lines.push("");
	lines.push("System");
	lines.push(`  OS: ${capture.os.name} ${capture.os.version}`);
	lines.push(`  Architecture: ${capture.os.arch}`);
	lines.push(`  Shell: ${capture.shell}`);
	lines.push("");
	lines.push("PATH");
	const pathEntries = capture.path.split(":").filter((entry) => entry.trim() !== "");
	if (pathEntries.length === 0) {
		lines.push("  (empty)");
	} else {
		for (const entry of pathEntries) lines.push(`  ${entry}`);
	}
	lines.push("");
	lines.push("Environment");
	const names = Object.keys(capture.env).sort();
	if (names.length === 0) {
		lines.push("  (empty)");
	} else {
		for (const name of names) {
			lines.push(`  ${name}=${cut(oneLine(capture.env[name] ?? ""))}`);
		}
	}
	lines.push("");
	lines.push("Agents");
	if (capture.agents.length === 0) {
		lines.push("  (none found)");
	} else {
		for (const agent of capture.agents) {
			if (!agent.installed) {
				lines.push(`  ${agent.name}: not installed`);
				continue;
			}
			const version =
				agent.version === null || agent.version === "" ? "version unknown" : agent.version;
			const path = agent.path === null || agent.path === "" ? "path unknown" : agent.path;
			lines.push(`  ${agent.name}: ${version} at ${path}`);
		}
	}
	lines.push("");
	lines.push("Sidecar");
	lines.push(`  Running: ${capture.sidecar.running ? "yes" : "no"}`);
	lines.push(`  Log: ${capture.sidecar.logPath ?? "unknown"}`);
	lines.push("");
	return lines.join("\n");
}

/**
 * Writes the redacted report to a temporary file and returns its path, for a new chat's
 * attachment. `fileName` must be unique; the caller passes an id.
 */
export async function writeRedactedReport(
	platform: Pick<Platform, "fs">,
	capture: DiagnosticsCapture,
	fileName: string,
): Promise<Result<string>> {
	const redacted = redactCapture(capture, {
		safeEnvNames: SAFE_ENV_NAMES,
		hash: shortSha256,
		homeDir: platform.fs.paths.home,
	});
	const path = `${platform.fs.paths.temp}/conducted-diagnostics-${fileName}.txt`;
	const written = await platform.fs.writeTextAtomic(path, renderReport(redacted));
	if (!written.ok) {
		return err(
			appError("diagnostics_write_failed", "The report could not be written.", written.error),
		);
	}
	return ok(path);
}

const SHA256_K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(input: Uint8Array): Uint8Array {
	const length = input.length;
	const withPadding = new Uint8Array((((length + 9) >> 6) + 1) << 6);
	withPadding.set(input);
	withPadding[length] = 0x80;
	const view = new DataView(withPadding.buffer);
	const bits = length * 8;
	view.setUint32(withPadding.length - 8, Math.floor(bits / 0x1_0000_0000));
	view.setUint32(withPadding.length - 4, bits >>> 0);

	const hash = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	]);
	const words = new Uint32Array(64);
	for (let offset = 0; offset < withPadding.length; offset += 64) {
		for (let index = 0; index < 16; index += 1) {
			words[index] = view.getUint32(offset + index * 4);
		}
		for (let index = 16; index < 64; index += 1) {
			const before15 = words[index - 15] ?? 0;
			const before2 = words[index - 2] ?? 0;
			const s0 = rotr(before15, 7) ^ rotr(before15, 18) ^ (before15 >>> 3);
			const s1 = rotr(before2, 17) ^ rotr(before2, 19) ^ (before2 >>> 10);
			words[index] = ((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0;
		}
		let a = hash[0] ?? 0;
		let b = hash[1] ?? 0;
		let c = hash[2] ?? 0;
		let d = hash[3] ?? 0;
		let e = hash[4] ?? 0;
		let f = hash[5] ?? 0;
		let g = hash[6] ?? 0;
		let h = hash[7] ?? 0;
		for (let index = 0; index < 64; index += 1) {
			const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const choice = (e & f) ^ (~e & g);
			const temp1 = (h + s1 + choice + (SHA256_K[index] ?? 0) + (words[index] ?? 0)) >>> 0;
			const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = (s0 + majority) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + temp1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) >>> 0;
		}
		hash[0] = ((hash[0] ?? 0) + a) >>> 0;
		hash[1] = ((hash[1] ?? 0) + b) >>> 0;
		hash[2] = ((hash[2] ?? 0) + c) >>> 0;
		hash[3] = ((hash[3] ?? 0) + d) >>> 0;
		hash[4] = ((hash[4] ?? 0) + e) >>> 0;
		hash[5] = ((hash[5] ?? 0) + f) >>> 0;
		hash[6] = ((hash[6] ?? 0) + g) >>> 0;
		hash[7] = ((hash[7] ?? 0) + h) >>> 0;
	}

	const digest = new Uint8Array(32);
	const digestView = new DataView(digest.buffer);
	for (let index = 0; index < 8; index += 1) {
		digestView.setUint32(index * 4, hash[index] ?? 0);
	}
	return digest;
}

function rotr(value: number, bits: number): number {
	return (value >>> bits) | (value << (32 - bits));
}

/** A short stable hash for a secret value: the first eight hex characters of SHA-256. */
export function shortSha256(value: string): string {
	const digest = sha256(new TextEncoder().encode(value));
	return Array.from(digest.slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
