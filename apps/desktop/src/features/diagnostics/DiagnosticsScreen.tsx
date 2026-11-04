/**
 * @feature APP-03 DiagnosticsScreen
 * Owns: the diagnostics route. It captures facts about the app and the user's environment, shows
 * them, and offers a redacted or full report, a chat with the report attached, the log export, and
 * a restart. Entry point embedded by the router.
 * Behaviour: ui-map.md 2, route `/diagnostics` ("Capture information about your environment to
 * help diagnose issues"; shell, PATH and environment capture; buttons: copy redacted report, copy
 * full report, create a new session with the redacted report attached, copy logs (may include
 * personal data), restart; environment values are hashed except a safe list).
 * Data: useDiagnostics() (shaped by diagnostics-report.ts), useAgentInstalls, useActions().app
 * (exportLogs, runCommand, createDiagnosticsChat).
 * Children: EnvironmentReport, DiagnosticsActions.
 * Must handle: capture loading and failing (partial report with the failed parts named), a very
 * large environment, secrets (never shown in the redacted view, and the full report asks first),
 * the log export failing (message, no empty file), a missing login shell capture, no installed
 * agents, and a restart while an agent is working (asks first).
 * Test first: with a capture that holds a variable named TOKEN, the redacted view shows a hash and
 * never the value.
 */
import { notImplemented } from "@conducted/shared";

export function DiagnosticsScreen(_props: Record<string, never>): never {
	return notImplemented("APP-03");
}
