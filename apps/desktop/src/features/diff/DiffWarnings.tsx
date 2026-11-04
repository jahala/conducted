/**
 * @feature REV-02 Diff warnings
 * Owns: the notice shown above or instead of a diff when it cannot be drawn normally.
 * Behaviour: ui-map.md 3.6 ("Only whitespace changes found" with "Show whitespace changes",
 * "Binary file changed", "Updating diff", "Dismiss diff rendering warning").
 * Kinds: "binary" (no render), "too_large" (button to render anyway), "whitespace_only" (button to
 * show whitespace changes), "updating" (the files changed on disk, a new diff is on the way),
 * "render_failed" (the renderer threw, with Retry).
 * Must handle: a dismissible warning staying dismissed for that file until it changes, and two
 * warnings at once (updating plus too_large shows the first only).
 * Test first: kind "whitespace_only" shows an action that calls onAction.
 */
import { notImplemented } from "@conducted/shared";

export type DiffWarningKind =
	| "binary"
	| "too_large"
	| "whitespace_only"
	| "updating"
	| "render_failed";

export interface DiffWarningProps {
	kind: DiffWarningKind;
	onAction: () => void;
	onDismiss: () => void;
}

export function DiffWarning(_props: DiffWarningProps): never {
	return notImplemented("REV-02");
}
