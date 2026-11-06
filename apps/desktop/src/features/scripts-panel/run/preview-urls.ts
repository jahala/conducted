/**
 * @feature RUN-03 Preview URL list
 * Owns: the pure function that builds the list of preview URLs from the run output, detected
 * ports, and the repository template.
 * Behaviour: ui-map.md 3.7 (preview URLs; the repository setting "Preview URLs" supports the
 * workspace port variable); services-map.md 5A.1.3 (the last localhost URL in run output is kept;
 * 0.0.0.0 and [::] are rewritten to localhost).
 * Must handle: template placeholders for the workspace port, a template with several URLs (first
 * is default), a URL with a path and query, a port list with duplicates, and a template that is
 * not a valid URL after substitution (dropped, and reported in `problems`).
 * Test first: template "http://localhost:$PORT/app" with port 3100 gives that URL with port
 * substituted, and the same URL found in output is not listed twice.
 */
import { expandPreviewUrl } from "../../../core/services/ports.ts";

export interface PreviewUrl {
	label: string;
	url: string;
	source: "run_output" | "detected_port" | "template";
}

/** Splits the repository template into its URLs. Newlines and commas separate entries. */
function templateEntries(template: string): string[] {
	return template
		.split(/[\n,]+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/** Keeps a URL only when a browser can open it. */
function isValidUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export function buildPreviewUrls(input: {
	runOutputUrl: string | null;
	detectedPorts: readonly number[];
	template: string | null;
	workspacePort: number;
}): { urls: PreviewUrl[]; problems: string[] } {
	const urls: PreviewUrl[] = [];
	const problems: string[] = [];
	const seen = new Set<string>();

	const add = (label: string, url: string, source: PreviewUrl["source"]): void => {
		if (seen.has(url)) return;
		seen.add(url);
		urls.push({ label, url, source });
	};

	if (input.runOutputUrl !== null && input.runOutputUrl.trim() !== "") {
		add("Run output", input.runOutputUrl.trim(), "run_output");
	}

	const ports = [...new Set(input.detectedPorts)]
		.filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535)
		.sort((left, right) => left - right);
	for (const port of ports) {
		add(`Port ${port}`, `http://localhost:${port}`, "detected_port");
	}

	if (input.template !== null) {
		for (const entry of templateEntries(input.template)) {
			const expanded = expandPreviewUrl(entry, input.workspacePort);
			if (!expanded.ok) {
				problems.push(expanded.error.message);
				continue;
			}
			if (!isValidUrl(expanded.value)) {
				problems.push(`The preview URL ${expanded.value} is not a valid address.`);
				continue;
			}
			add("Preview URL", expanded.value, "template");
		}
	}

	return { urls, problems };
}
