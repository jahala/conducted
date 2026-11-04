/**
 * @feature WS-08 Open-in menu item
 * Owns: one app in the Open in menu: its icon, label, and a mark when it is the default.
 * Behaviour: ui-map.md 3.10.
 * Must handle: the app icon being unavailable (a generic icon, not a broken image), a long label,
 * and "Set as default" as a secondary action.
 * Test first: choosing the item calls onOpen with the app, and "Set as default" calls onSetDefault.
 */
import { notImplemented } from "@conducted/shared";
import type { OpenInApp } from "./open-in-apps.ts";

export interface OpenInItemProps {
	app: OpenInApp;
	isDefault: boolean;
	onOpen: (app: OpenInApp) => void;
	onSetDefault: (app: OpenInApp) => void;
}

export function OpenInItem(_props: OpenInItemProps): never {
	return notImplemented("WS-08");
}
