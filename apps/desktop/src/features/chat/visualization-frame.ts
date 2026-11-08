/**
 * @feature CHAT-22 Codex visualizations in the chat
 * Owns: the document a visualization frame loads (`frameDocument`), the frame's sandbox
 * (`FRAME_SANDBOX`) and the height message the document posts (`HEIGHT_MESSAGE`).
 * Behaviour: coverage/inventory-ui-text.md ("Codex inline visualizations": a sandboxed frame that
 * grows to fit its content).
 * Must handle: the page keeps its own markup and scripts; a doctype stays first, so the page keeps
 * its standards mode; the height script runs after the page's own content.
 * Our design choice: these are pure values in their own module, so the frame component and the
 * browser check of the frame policy (scripts/visualization/frame-policy.browser.ts) build the
 * frame the same way.
 * Test first: a path outside the workspace root renders "Visualization is outside the workspace:"
 * with the path and loads no frame.
 */

/** The frame runs scripts, but without `allow-same-origin`, so its origin is opaque. */
export const FRAME_SANDBOX = "allow-scripts";

export const HEIGHT_MESSAGE = "conducted-visualization";

const FRAME_POLICY =
	"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'";

/** A doctype at the start of the page, with any whitespace and comments before it. */
const LEADING_DOCTYPE = /^﻿?(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i;

/**
 * Reports the document's height as the content changes, so the frame can follow it.
 */
const HEIGHT_SCRIPT = `<script>(function(){function report(){parent.postMessage({type:"${HEIGHT_MESSAGE}",height:Math.ceil(document.documentElement.scrollHeight)},"*")}addEventListener("load",report);if(typeof ResizeObserver==="function"){new ResizeObserver(report).observe(document.documentElement)}report()})();</script>`;

/**
 * The document the frame loads. Its policy comes first, right after a leading doctype, so it
 * applies to every script of the page, even one written before `<head>`. A doctype stays first,
 * so the page keeps its standards mode. The height script goes last.
 */
export function frameDocument(html: string): string {
	const policy = `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`;
	const doctype = LEADING_DOCTYPE.exec(html)?.[0] ?? "";
	const withPolicy = `${doctype}${policy}${html.slice(doctype.length)}`;
	return /<\/body>/i.test(withPolicy)
		? withPolicy.replace(/<\/body>/i, (body) => `${HEIGHT_SCRIPT}${body}`)
		: `${withPolicy}${HEIGHT_SCRIPT}`;
}
