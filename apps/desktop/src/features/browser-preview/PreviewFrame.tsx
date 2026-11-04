/**
 * @feature RUN-04 Preview frame
 * Owns: the surface that draws the web page and reports its load state. It lives outside React's
 * tab content so the page survives tab switches (ui-map.md 8, "surface layer").
 * Behaviour: ui-map.md 3.2 and 8; native-and-sidecar-map.md (a proxy injects the annotation
 * toolbar into the previewed page).
 * Open questions, decide before the build:
 *   1. The Platform interface has no webview or browser surface. An iframe on a local origin is
 *      the simplest route. A native child webview needs a Platform method and a Rust command.
 *   2. Annotations need script inside the page. Our design choice would be a small local proxy
 *      that adds a script to HTML responses, started by the sidecar. That is a new sidecar method
 *      (the protocol has none) and needs a security review: only localhost, only this workspace.
 * Must handle: load start, load finish, load failure (connection refused is the common case),
 * navigation events (to update the address), blocked frames (a page that forbids embedding), and
 * dispose on tab close.
 * Test first: a load failure event produces the failed state with the URL.
 */
import { notImplemented } from "@conducted/shared";

export type PreviewLoadState =
	| { kind: "loading" }
	| { kind: "ready"; title: string | null }
	| { kind: "failed"; reason: "refused" | "blocked" | "timeout" | "other" };

export interface PreviewFrameProps {
	url: string;
	reloadToken: number;
	onLoadState: (state: PreviewLoadState) => void;
	onNavigated: (url: string) => void;
}

export function PreviewFrame(_props: PreviewFrameProps): never {
	return notImplemented("RUN-04");
}
