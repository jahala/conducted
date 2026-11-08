/**
 * @feature CHAT-22 Codex visualizations in the chat
 * Owns: the document a visualization frame loads (`frameDocument`), the frame's sandbox
 * (`FRAME_SANDBOX`) and the height message the document posts (`HEIGHT_MESSAGE`).
 * Behaviour: coverage/inventory-ui-text.md ("Codex inline visualizations": a sandboxed frame that
 * grows to fit its content).
 * Must handle: the page keeps its own markup and scripts, in their order; a leading doctype stays
 * first, so the page keeps its standards mode; the height script runs after the page's content.
 * The page's policy is not part of the document: the Rust shell sends it as a header with the page
 * (visualization.rs `FRAME_POLICY`), so it covers every script, even one before `<head>`.
 * Our design choice: these are pure values in their own module, so the frame component and the
 * browser check of the frame policy (scripts/visualization/frame-policy.browser.ts) build the
 * frame the same way.
 * Test first: a path outside the workspace root renders "Visualization is outside the workspace:"
 * with the path and loads no frame.
 */

/** The frame runs scripts, but without `allow-same-origin`, so its origin is opaque. */
export const FRAME_SANDBOX = "allow-scripts";

export const HEIGHT_MESSAGE = "conducted-visualization";

/** Reports the document's height as the content changes, so the frame can follow it. */
const HEIGHT_SCRIPT = `<script>(function(){function report(){parent.postMessage({type:"${HEIGHT_MESSAGE}",height:Math.ceil(document.documentElement.scrollHeight)},"*")}addEventListener("load",report);if(typeof ResizeObserver==="function"){new ResizeObserver(report).observe(document.documentElement)}report()})();</script>`;

/** The document the frame loads: the page as written, with the height script before `</body>`. */
export function frameDocument(html: string): string {
	return /<\/body>/i.test(html)
		? html.replace(/<\/body>/i, (body) => `${HEIGHT_SCRIPT}${body}`)
		: `${html}${HEIGHT_SCRIPT}`;
}
