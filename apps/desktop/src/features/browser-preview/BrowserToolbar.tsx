/**
 * @feature RUN-04 Browser toolbar
 * Owns: the bar above the preview. Back and forward, reload, the address with the port and path
 * picker, Open in browser, and the annotation toggle.
 * Behaviour: ui-map.md 3.2, "Tab content: Browser" ("Reload", "Open in browser", "Port and path"
 * picker).
 * Children: PortPathPicker.
 * Must handle: an address that is not a valid URL (inline error, no navigation), loading state on
 * the reload button, no history (back and forward disabled), and Enter in the address field
 * navigating.
 * Test first: typing "localhost:3000/a" and pressing Enter calls onNavigate with
 * "http://localhost:3000/a".
 */
import { notImplemented } from "@conducted/shared";

export interface BrowserToolbarProps {
	url: string;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	annotating: boolean;
	onNavigate: (url: string) => void;
	onBack: () => void;
	onForward: () => void;
	onReload: () => void;
	onOpenExternally: () => void;
	onToggleAnnotating: () => void;
}

export function BrowserToolbar(_props: BrowserToolbarProps): never {
	return notImplemented("RUN-04");
}
