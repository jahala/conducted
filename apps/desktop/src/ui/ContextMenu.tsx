/**
 * @feature APP-05 ContextMenu
 * Owns: right-click menus (workspace row, chat tab, file row), built on the radix ContextMenu with the same
 * look as Menu.tsx.
 * Behaviour: ui-map.md 5.3 (context menus), 8 (ContextMenu parts).
 * Must handle: the same items as the matching dropdown (one list, two surfaces), keyboard open with the
 * context-menu key, a destructive item, submenus, closing on scroll.
 * Test first: a right click on the trigger opens the menu with its items.
 */
import { notImplemented } from "@conducted/shared";
import type { ReactNode } from "react";

export interface ContextMenuProps {
	/** The element that opens the menu on right click. */
	children: ReactNode;
	/** The menu items, as <MenuItem> children shared with the dropdown version. */
	items: ReactNode;
}

export function ContextMenu(_props: ContextMenuProps): never {
	return notImplemented("APP-05");
}
