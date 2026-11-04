/**
 * @feature REV-08 SVG preview
 * Owns: showing an SVG file either rendered or as its source, with a switch.
 * Behaviour: ui-map.md 3.2 (SVG: "View raw SVG code", "View rendered SVG").
 * Our design choice: render inside an img element from a blob URL so embedded scripts never run.
 * Must handle: invalid SVG (show the source and an error note), SVG with external references
 * (blocked), very large SVG, and the switch remembering the choice per session.
 * Test first: an SVG with a script element renders without executing it.
 */
import { notImplemented } from "@conducted/shared";

export interface SvgPreviewProps {
	source: string;
	view: "rendered" | "source";
	onViewChange: (view: "rendered" | "source") => void;
}

export function SvgPreview(_props: SvgPreviewProps): never {
	return notImplemented("REV-08");
}
