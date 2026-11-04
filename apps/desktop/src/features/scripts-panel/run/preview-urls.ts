/**
 * @feature RUN-03 Preview URL list
 * Owns: the pure function that builds the list of preview URLs from the run output, detected
 * ports, and the repository template.
 * Behaviour: ui-map.md 3.7 (preview URLs; the repository setting "Preview URLs" supports the
 * workspace port variable); services-map.md 5A.1.3 (the last localhost URL in run output is kept;
 * 0.0.0.0 and [::] are rewritten to localhost).
 * Must handle: template placeholders for the workspace port (the variable name is decided in
 * RUN-03), a template with several URLs (first is default), a URL with a path and query, a port
 * list with duplicates, and a template that is not a valid URL after substitution (dropped, and
 * reported in `problems`).
 * Test first: template "http://localhost:$PORT/app" with port 3100 gives that URL with port
 * substituted, and the same URL found in output is not listed twice.
 */
import { notImplemented } from "@conducted/shared";

export interface PreviewUrl {
	label: string;
	url: string;
	source: "run_output" | "detected_port" | "template";
}

export function buildPreviewUrls(_input: {
	runOutputUrl: string | null;
	detectedPorts: readonly number[];
	template: string | null;
	workspacePort: number;
}): { urls: PreviewUrl[]; problems: string[] } {
	return notImplemented("RUN-03");
}
