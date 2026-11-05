/**
 * @feature CHAT-24 Mermaid diagrams in replies
 * Owns: drawing a fenced `mermaid` code block as a diagram, with "Rendering diagram...", "Expand diagram",
 * "Copy Mermaid source", zoom in, zoom out and reset.
 * Behaviour: ui-map.md 3.3 (Assistant text: Mermaid with those labels), 8 (Conductor uses the Mermaid
 * library, among its dependencies); workspace-screen.md (AssistantText.tsx names Mermaid as a later
 * addition).
 * Dependency: no package is added by this placeholder. The builder adds `mermaid` (MIT) only after the
 * licence check in the backlog row, and loads it on first use, so the chat does not pay for it at startup.
 * Must handle: source that is still streaming (keep the last diagram that rendered, redraw after the text
 * stops changing; never show a parse error for half a diagram); source that does not parse (show the
 * source as a code block with a short plain message, never a stack trace); the app theme changing (redraw
 * in the new theme); a very large diagram (the expanded view scrolls and zooms; zoom limits at both ends,
 * "reset" returns to fit); script, links and click handlers in the diagram (strict security level, the SVG
 * is sanitised before it is inserted); two diagrams in one reply (unique element ids); "Copy Mermaid
 * source" copies the exact source text; the expanded view closes with Escape and returns focus.
 * Test first: a source that fails to parse renders the source as code with a plain message and no thrown
 * error.
 */
import { notImplemented } from "@conducted/shared";

export interface MermaidDiagramProps {
	/** The text inside the fence. */
	source: string;
	/** The text is still arriving from the agent. */
	streaming: boolean;
}

export function MermaidDiagram(_props: MermaidDiagramProps): never {
	return notImplemented("CHAT-24");
}
