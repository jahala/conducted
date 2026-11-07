/**
 * @feature APP-03 Diagnostics report
 * Owns: redacting a DiagnosticsCapture (core/model.ts), rendering it as text, and writing the
 * redacted report to a file. The redaction and rendering are pure; the write takes the Platform
 * so the caller can keep the file system at the edge.
 * Behaviour: ui-map.md 2, `/diagnostics` ("Env values are hashed except a safe list"); services-map.md
 * 3.0 and native-and-sidecar-map.md (captured login-shell PATH, secrets stripped).
 * Data: `useDiagnostics()` returns the capture; `Actions.app.createDiagnosticsChat(workspaceId)`
 * writes the redacted report to a file and starts a chat with it attached. redactCapture takes the
 * hash as a parameter. The screen and writeRedactedReport pass shortSha256, which uses Web Crypto's
 * SHA-256, so redaction is async.
 * Safe list: names whose values are shown as they are, such as SHELL, LANG, TERM, TERM_PROGRAM
 * and COLORTERM. The exact list is Our design choice and is a parameter.
 * Must handle: an empty environment, values that contain newlines, PATH entries (shown one per
 * line), the home folder in PATH, the shell, the agent paths and the sidecar log (replaced by "~"
 * in the redacted report), the same variable twice, very long values (cut in the report with a
 * note), and names the shared isSecretName rule hides (always hashed even if on the safe list).
 * Test first: redactCapture hashes a variable named API_TOKEN even when the safe list names it, and
 * keeps LANG as it is.
 */
import { appError, err, isSecretName, ok, type Result } from "@conducted/shared";
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

/** Longest value the text report keeps before it says how much it left out. */
export const MAX_REPORT_VALUE_LENGTH = 2_000;

export interface RedactionOptions {
	safeEnvNames: ReadonlySet<string>;
	/** Returns a short stable hash of a value, e.g. the first 8 hex characters of SHA-256. */
	hash: (value: string) => Promise<string>;
	homeDir: string;
}

/** Replaces the user's home folder with "~", so a shared report is less identifying. */
export function redactHome(path: string, homeDir: string): string {
	if (homeDir === "" || homeDir === "/") return path;
	return path.split(homeDir).join("~");
}

export async function redactCapture(
	capture: DiagnosticsCapture,
	options: RedactionOptions,
): Promise<DiagnosticsCapture> {
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(capture.env)) {
		env[name] =
			isSecretName(name) || !options.safeEnvNames.has(name) ? await options.hash(value) : value;
	}
	const home = (path: string): string => redactHome(path, options.homeDir);
	return {
		...capture,
		shell: home(capture.shell),
		path: home(capture.path),
		env,
		agents: capture.agents.map((agent) =>
			agent.path === null ? agent : { ...agent, path: home(agent.path) },
		),
		sidecar: {
			...capture.sidecar,
			logPath: capture.sidecar.logPath === null ? null : home(capture.sidecar.logPath),
		},
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
	const redacted = await redactCapture(capture, {
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

/**
 * A short stable hash for a secret value: the first eight hex characters of SHA-256, from the
 * webview's Web Crypto.
 */
export async function shortSha256(value: string): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	);
	return Array.from(digest.slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
