/**
 * @feature RUN-03 Preview URL list
 * Owns: the pure function that builds the list of preview URLs from the repository's ordered
 * preview URL entries and the run output.
 * Behaviour: ui-map.md 3.7 (preview URLs; the repository setting "Preview URLs" supports the
 * workspace port variable); services-map.md 5A.1.3 (the last localhost URL in run output is kept;
 * 0.0.0.0 and [::] are rewritten to localhost). Conductor's bundle (renderApp @4999000-5001400)
 * shows the templates when any exist, and the run-output URL only when none do; detected ports are
 * on the Ports tab, not in this menu.
 * Must handle: template placeholders for the workspace port, the stored order (the first template
 * is the default), a name or the expanded URL as the label, a URL with a path and query, and a
 * template that is not a valid URL after substitution (dropped, and reported in `problems`).
 * Test first: a template is labelled by its name, or by its expanded URL when the name is empty.
 */
import type { PreviewUrlEntry } from "../../../core/model.ts";
import { expandPreviewUrl } from "../../../core/services/ports.ts";

export interface PreviewUrl {
	label: string;
	url: string;
	source: "run_output" | "template";
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
	templates: readonly PreviewUrlEntry[];
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

	for (const entry of input.templates) {
		const expanded = expandPreviewUrl(entry.url.trim(), input.workspacePort);
		if (!expanded.ok) {
			problems.push(expanded.error.message);
			continue;
		}
		if (!isValidUrl(expanded.value)) {
			problems.push(`The preview URL ${expanded.value} is not a valid address.`);
			continue;
		}
		add(entry.name.trim() || expanded.value, expanded.value, "template");
	}

	if (input.templates.length === 0 && input.runOutputUrl !== null) {
		const url = input.runOutputUrl.trim();
		if (url !== "") add(url, url, "run_output");
	}

	return { urls, problems };
}
