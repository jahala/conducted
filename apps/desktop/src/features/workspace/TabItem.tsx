/**
 * @feature NAV-10 Tab item
 * Owns: One tab in the strip: icon by type, label, close button, and for chats the status icon and
 * unread dot.
 * Behaviour: ui-map.md 3.2 (chat tab: status icon, title, unread dot, width fixed; terminal tab
 * 'Terminal N'; comment tab 'Comment by <author>'; PR tab 'PR #N'; browser tab shows the URL host),
 * 5.3 (chat tab context menu).
 * Must handle: Long titles truncate with the full title in a tooltip; the close button is reachable
 * by keyboard and has the label 'Close <title>'; middle click closes; a dragged tab shows a ghost;
 * the active tab is marked by an underline and weight; role 'tab' with aria-selected.
 * Test first: Middle click calls onClose; the close button's name includes the tab title.
 */
import { notImplemented } from "@conducted/shared";
import type { TabDescriptor } from "./tab-layout.ts";

export interface TabItemProps {
	tab: TabDescriptor;
	active: boolean;
	onSelect: () => void;
	onClose: () => void;
}

export function TabItem(_props: TabItemProps): never {
	return notImplemented("NAV-10");
}
