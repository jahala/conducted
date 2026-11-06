/**
 * @feature RUN-05 Annotation message text
 * Owns: the pure function that turns page annotations into the message the agent receives.
 * Behaviour: native-and-sidecar-map.md (Agentation formats annotations for the agent). The wording
 * is ours.
 * Our design choice: one numbered entry per annotation with the page URL, the element selector,
 * the visible text (cut to 200 characters) and the user's note. Annotations on the same page share
 * one URL heading, in the order the user made them. No screenshot in the first version.
 * Must handle: no annotations (returns null, nothing to send), annotations on several pages
 * (grouped by URL), notes with Markdown characters (escaped so the list stays readable), an
 * element with no text, and an element that no longer matches after navigation.
 * Test first: one annotation gives text that contains the URL, the selector and the note exactly
 * once.
 */

export interface PageAnnotation {
	id: string;
	url: string;
	selector: string;
	elementText: string | null;
	note: string;
	/** False when the element could not be found again after a navigation. */
	stillMatches: boolean;
}

/** The most visible text one annotation carries into the message. */
const MAX_ELEMENT_TEXT = 200;

/** Characters that would lay out the list differently, escaped so a note reads as written. */
const MARKDOWN_CHARACTER = /([\\`*_[\]()<>#|~])/g;

function escapeMarkdown(value: string): string {
	return value.replace(MARKDOWN_CHARACTER, "\\$1");
}

/** Text inside one code span; a backtick in the value cannot close it early. */
function code(value: string): string {
	return `\`${value.replace(/`/g, "\\`")}\``;
}

function elementTextOf(annotation: PageAnnotation): string {
	const text = (annotation.elementText ?? "").replace(/\s+/g, " ").trim();
	return text === "" ? "(no text)" : text.slice(0, MAX_ELEMENT_TEXT);
}

function annotationLines(annotation: PageAnnotation, number: number): string[] {
	const lines = [`${number}. ${code(annotation.selector)} ${elementTextOf(annotation)}`];
	if (!annotation.stillMatches) {
		lines.push("   The element was not found again after the page changed.");
	}
	if (annotation.note.trim() !== "") {
		lines.push(`   Note: ${escapeMarkdown(annotation.note.trim())}`);
	}
	return lines;
}

export function formatAnnotations(annotations: readonly PageAnnotation[]): string | null {
	if (annotations.length === 0) return null;
	const pages = new Map<string, PageAnnotation[]>();
	for (const annotation of annotations) {
		const page = pages.get(annotation.url);
		if (page === undefined) pages.set(annotation.url, [annotation]);
		else page.push(annotation);
	}

	const blocks: string[] = [];
	for (const [url, page] of pages) {
		const lines = [`**${url}**`, ""];
		page.forEach((annotation, index) => {
			lines.push(...annotationLines(annotation, index + 1));
		});
		blocks.push(lines.join("\n"));
	}
	return `Page annotations\n\n${blocks.join("\n\n")}`;
}
