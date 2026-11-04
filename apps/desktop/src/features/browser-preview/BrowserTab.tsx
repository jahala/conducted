/**
 * @feature RUN-04 BrowserTab
 * Owns: A center tab with an in-app browser preview of the workspace's dev server.
 * Behaviour: ui-map.md 3.2
 * Entry point embedded by another part of the app. Keep the name and props stable.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function BrowserTab(_props: { workspaceId: WorkspaceId; url: string }): never {
	return notImplemented("RUN-04");
}
