/**
 * @feature WS-08 OpenInMenu
 * Owns: The "Open in" menu in the workspace header: Finder, editors and terminals that are installed.
 * Behaviour: ui-map.md 3.10
 * Entry point embedded by another part of the app. Keep the name and props stable.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function OpenInMenu(_props: { workspaceId: WorkspaceId }): never {
	return notImplemented("WS-08");
}
