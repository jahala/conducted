/**
 * @feature RUN-03 Preview URL menu
 * Owns: the split Open button's menu: the list of URLs the workspace can be opened at, with the
 * first as default.
 * Behaviour: ui-map.md 3.7 ("Open", "Choose preview URL"; sources: the Run tab's URL, ports
 * detected from output, the repository's Preview URLs template; "Open localhost URL" Cmd+Shift+B);
 * the in-app browser setting decides whether Open uses the browser tab or the system browser.
 * Must handle: no URLs, duplicate URLs from different sources (shown once), an unreachable port
 * (still listed, marked), and the chosen default being remembered per workspace.
 * Test first: two sources giving the same URL show one entry.
 */
import { notImplemented } from "@conducted/shared";

export interface PreviewUrlMenuProps {
	urls: { label: string; url: string; source: "run_output" | "detected_port" | "template" }[];
	defaultUrl: string | null;
	onOpen: (url: string) => void;
	onSetDefault: (url: string) => void;
}

export function PreviewUrlMenu(_props: PreviewUrlMenuProps): never {
	return notImplemented("RUN-03");
}
