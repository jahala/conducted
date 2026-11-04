/**
 * @feature RUN-05 Annotation message text
 * Owns: the pure function that turns page annotations into the message the agent receives.
 * Behaviour: native-and-sidecar-map.md (Agentation formats annotations for the agent). The wording
 * is ours.
 * Our design choice: one numbered entry per annotation with the page URL, the element selector,
 * the visible text (cut to 200 characters) and the user's note. No screenshot in the first
 * version.
 * Must handle: no annotations (returns null, nothing to send), annotations on several pages
 * (grouped by URL), notes with Markdown characters (escaped so the list stays readable), and an
 * element with no text.
 * Test first: one annotation gives text that contains the URL, the selector and the note exactly
 * once.
 */
import { notImplemented } from "@conducted/shared";

export interface PageAnnotation {
	id: string;
	url: string;
	selector: string;
	elementText: string | null;
	note: string;
	/** False when the element could not be found again after a navigation. */
	stillMatches: boolean;
}

export function formatAnnotations(_annotations: readonly PageAnnotation[]): string | null {
	return notImplemented("RUN-05");
}
