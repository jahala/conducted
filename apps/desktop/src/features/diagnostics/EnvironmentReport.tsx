/**
 * @feature APP-03 Environment report
 * Owns: the on-screen sections of the diagnostics page: app and system facts, shell, PATH as a
 * list, environment variables as a table (values hashed in the redacted view), agent programs, and
 * sidecar status.
 * Behaviour: ui-map.md 2, `/diagnostics`.
 * Must handle: the redacted and full views (full only after the user confirms), a long PATH
 * (collapsible), a very long variable list (filter box, windowed rows), copy of a single row, and
 * sections that failed to capture (each shows its own error and Retry).
 * Test first: the redacted view never renders a value that is not on the safe list.
 */
import { notImplemented } from "@conducted/shared";
import type { DiagnosticsCapture } from "../../core/model.ts";

export interface EnvironmentReportProps {
	capture: DiagnosticsCapture;
	view: "redacted" | "full";
	failedSections: readonly string[];
	onRetrySection: (section: string) => void;
}

export function EnvironmentReport(_props: EnvironmentReportProps): never {
	return notImplemented("APP-03");
}
